/**
 * ExtensionBookmarks - Bookmark Manager
 * Manages local browser bookmark mutations with sequential execution,
 * loop-suppression locks, and stable ID reconciliation.
 */

import { normalizer } from './normalizer.js';
import { idStore } from '../sync/id-store.js';
import { generateId, normalizeUrl } from '../models/types.js';

export class BookmarkManager {
  constructor() {
    this.isApplyingSync = false;
    this.actionQueue = Promise.resolve();
  }

  enqueue(actionFn) {
    this.actionQueue = this.actionQueue.then(actionFn).catch(err => {
      console.error('[BookmarkManager] Queue action error:', err);
    });
    return this.actionQueue;
  }

  async getLocalTree() {
    return normalizer.exportNormalizedTree();
  }

  /**
   * Applies remote bookmark trees onto the local browser bookmarks.
   * Respects section sync toggles.
   */
  async applyRemoteTrees(remoteBar, remoteOther, toggles = { syncBookmarksBar: true, syncOtherBookmarks: true }) {
    await idStore.init();
    const roots = await normalizer.detectRoots();

    this.isApplyingSync = true;
    try {
      if (toggles.syncBookmarksBar && remoteBar && roots.bookmarksBar) {
        await this._syncFolderContents(roots.bookmarksBar, remoteBar);
      }

      if (toggles.syncOtherBookmarks && remoteOther && roots.otherBookmarks) {
        // Find if remote has Mobile Bookmarks
        const nonMobileRemote = [];
        let mobileRemote = null;

        for (const item of remoteOther) {
          if (item.isMobileFolder || item.title === 'Mobile Bookmarks') {
            mobileRemote = item;
          } else {
            nonMobileRemote.push(item);
          }
        }

        // Sync standard Other Bookmarks
        await this._syncFolderContents(roots.otherBookmarks, nonMobileRemote);

        // Sync Mobile Bookmarks
        if (mobileRemote) {
          if (roots.mobileBookmarks) {
            // Browser has a dedicated native mobile bookmarks root (e.g. Chrome ID 3)
            await this._syncFolderContents(roots.mobileBookmarks, mobileRemote.children || []);
          } else {
            // Find or create 'Mobile Bookmarks' subfolder inside Other Bookmarks
            const [otherNode] = await chrome.bookmarks.getSubTree(roots.otherBookmarks);
            const existingFolder = (otherNode.children || []).find(
              c => !c.url && (c.title === 'Mobile Bookmarks' || idStore.getStableId(c.id) === mobileRemote.id)
            );

            let localFolderId;
            if (existingFolder) {
              localFolderId = existingFolder.id;
              idStore.setMapping(localFolderId, mobileRemote.id);
            } else {
              const created = await chrome.bookmarks.create({
                parentId: roots.otherBookmarks,
                title: 'Mobile Bookmarks'
              });
              localFolderId = created.id;
              idStore.setMapping(localFolderId, mobileRemote.id);
            }

            await this._syncFolderContents(localFolderId, mobileRemote.children || []);
          }
        }
      }

      await idStore.save();
    } finally {
      // Small cooldown to ensure all browser onCreated/onChanged events are flushed
      setTimeout(() => {
        this.isApplyingSync = false;
      }, 500);
    }
  }

  async _syncFolderContents(parentBrowserId, remoteItems) {
    const [parentNode] = await chrome.bookmarks.getSubTree(parentBrowserId);
    const localChildren = parentNode.children || [];

    // Map existing local children by their stable ID (or normalized URL as fallback)
    const localByStableId = new Map();
    const localByUrl = new Map();

    for (const child of localChildren) {
      const stableId = idStore.getStableId(child.id);
      if (stableId) {
        localByStableId.set(stableId, child);
      }
      if (child.url) {
        const norm = normalizeUrl(child.url);
        localByUrl.set(norm, child);
      }
    }

    // Process remote items
    const remoteSeenLocalIds = new Set();

    for (let i = 0; i < remoteItems.length; i++) {
      const remoteItem = remoteItems[i];

      // Check if item is tombstoned
      if (idStore.isTombstoned(remoteItem.id)) {
        continue;
      }

      let existingLocal = localByStableId.get(remoteItem.id);

      // Smart URL deduplication if not matched by ID
      if (!existingLocal && remoteItem.url) {
        const norm = normalizeUrl(remoteItem.url);
        existingLocal = localByUrl.get(norm);
        if (existingLocal) {
          // Align them to use the same stable ID
          idStore.setMapping(existingLocal.id, remoteItem.id);
          localByStableId.set(remoteItem.id, existingLocal);
        }
      }

      if (existingLocal) {
        remoteSeenLocalIds.add(existingLocal.id);

        // Update in-place if title or URL changed
        const titleChanged = existingLocal.title !== remoteItem.title;
        const urlChanged = remoteItem.url && existingLocal.url !== remoteItem.url;

        if (titleChanged || urlChanged) {
          const updateObj = { title: remoteItem.title };
          if (remoteItem.url) updateObj.url = remoteItem.url;
          await chrome.bookmarks.update(existingLocal.id, updateObj);
        }

        // Recurse into folders
        if (remoteItem.type === 'folder' && remoteItem.children) {
          await this._syncFolderContents(existingLocal.id, remoteItem.children);
        }
      } else {
        // Create new item locally
        if (remoteItem.type === 'folder') {
          const created = await chrome.bookmarks.create({
            parentId: parentBrowserId,
            title: remoteItem.title,
            index: i
          });
          idStore.setMapping(created.id, remoteItem.id);
          remoteSeenLocalIds.add(created.id);

          if (remoteItem.children && remoteItem.children.length > 0) {
            await this._syncFolderContents(created.id, remoteItem.children);
          }
        } else if (remoteItem.url) {
          const created = await chrome.bookmarks.create({
            parentId: parentBrowserId,
            title: remoteItem.title,
            url: remoteItem.url,
            index: i
          });
          idStore.setMapping(created.id, remoteItem.id);
          remoteSeenLocalIds.add(created.id);
        }
      }
    }

    // Handle deletions: if a local item is explicitly marked in remote tombstones
    for (const child of localChildren) {
      const stableId = idStore.getStableId(child.id);
      if (stableId && idStore.isTombstoned(stableId)) {
        try {
          if (child.children) {
            await chrome.bookmarks.removeTree(child.id);
          } else {
            await chrome.bookmarks.remove(child.id);
          }
          idStore.deleteMapping(child.id);
        } catch (e) {
          console.warn('[BookmarkManager] Could not delete item:', child.id, e);
        }
      }
    }
  }
}

export const bookmarkManager = new BookmarkManager();
