/**
 * ExtensionBookmarks - Diff & Sync Reconciliation Engine
 * Merges local and remote trees, performs smart deduplication,
 * enforces section toggles, and implements deletion safety guards.
 */

import { gistClient } from './gist-client.js';
import { idStore } from './id-store.js';
import { bookmarkManager } from '../bookmarks/manager.js';
import { stashService } from '../stash/stash-service.js';
import { normalizeUrl } from '../models/types.js';

export class DiffEngine {
  constructor() {
    this.isSyncing = false;
  }

  /**
   * Executes a full synchronization cycle.
   */
  async runSync(settings, options = { force: false, initialStrategy: null }) {
    if (this.isSyncing) {
      return { status: 'already-syncing' };
    }

    if (!settings.githubToken || !settings.gistId) {
      return { status: 'unconfigured' };
    }

    this.isSyncing = true;
    gistClient.setCredentials(settings.githubToken, settings.gistId);

    try {
      // 1. Fetch remote data from Gist
      const remote = await gistClient.fetchSyncData(options.force);
      if (remote.notModified && !options.force) {
        return { status: 'not-modified' };
      }

      const remoteBookmarks = remote.bookmarks || { bookmarksBar: [], otherBookmarks: [], tombstones: {} };
      const remoteStored = remote.storedPages || { folders: [], sessions: [] };

      // Merge tombstones
      idStore.mergeRemoteTombstones(remoteBookmarks.tombstones);

      // 2. Handle Bookmarks Synchronization
      const localTree = await bookmarkManager.getLocalTree();
      let updatedBookmarksPayload = null;

      const shouldSyncBar = settings.syncBookmarksBar;
      const shouldSyncOther = settings.syncOtherBookmarks;

      if (shouldSyncBar || shouldSyncOther) {
        // Initial strategy or normal merge
        if (options.initialStrategy === 'cloud-wins') {
          // Cloud wins: replace local
          await bookmarkManager.applyRemoteTrees(
            remoteBookmarks.bookmarksBar,
            remoteBookmarks.otherBookmarks,
            { syncBookmarksBar: shouldSyncBar, syncOtherBookmarks: shouldSyncOther }
          );
        } else if (options.initialStrategy === 'local-wins') {
          // Local wins: push local to cloud
          updatedBookmarksPayload = {
            bookmarksBar: shouldSyncBar ? localTree.bookmarksBar : remoteBookmarks.bookmarksBar,
            otherBookmarks: shouldSyncOther ? localTree.otherBookmarks : remoteBookmarks.otherBookmarks,
            tombstones: idStore.getTombstonesObject()
          };
        } else {
          // Normal 2-way Smart Merge
          const mergedBar = shouldSyncBar
            ? this._mergeFolderTrees(localTree.bookmarksBar, remoteBookmarks.bookmarksBar || [])
            : remoteBookmarks.bookmarksBar;

          const mergedOther = shouldSyncOther
            ? this._mergeFolderTrees(localTree.otherBookmarks, remoteBookmarks.otherBookmarks || [])
            : remoteBookmarks.otherBookmarks;

          // Apply merged tree locally
          await bookmarkManager.applyRemoteTrees(mergedBar, mergedOther, {
            syncBookmarksBar: shouldSyncBar,
            syncOtherBookmarks: shouldSyncOther
          });

          // Prepare payload for cloud
          updatedBookmarksPayload = {
            bookmarksBar: mergedBar,
            otherBookmarks: mergedOther,
            tombstones: idStore.getTombstonesObject()
          };
        }
      }

      // 3. Handle Stored Pages (OneTab) Synchronization
      let updatedStoredPayload = null;
      if (settings.syncStoredPages) {
        await stashService.init();
        const localFolders = stashService.getFolders();
        const localSessions = stashService.getSessions('all');

        if (options.initialStrategy === 'cloud-wins') {
          await stashService.setStoredPagesFromSync(remoteStored.folders, remoteStored.sessions);
        } else if (options.initialStrategy === 'local-wins') {
          updatedStoredPayload = {
            folders: localFolders,
            sessions: localSessions
          };
        } else {
          // Smart 2-way merge of stored pages
          const mergedFolders = this._mergeStoredFolders(localFolders, remoteStored.folders || []);
          const mergedSessions = this._mergeStoredSessions(localSessions, remoteStored.sessions || []);

          await stashService.setStoredPagesFromSync(mergedFolders, mergedSessions);
          updatedStoredPayload = {
            folders: mergedFolders,
            sessions: mergedSessions
          };
        }
      }

      // 4. Push updates to GitHub Gist if there are local modifications
      const updateData = {};
      if (updatedBookmarksPayload) updateData.bookmarks = updatedBookmarksPayload;
      if (updatedStoredPayload) updateData.storedPages = updatedStoredPayload;

      if (Object.keys(updateData).length > 0) {
        await gistClient.updateSyncData(updateData);
      }

      return { status: 'success', timestamp: Date.now() };
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * Merges two bookmark trees by stable ID and normalized URL.
   */
  _mergeFolderTrees(localItems = [], remoteItems = []) {
    const resultMap = new Map();
    const urlMap = new Map();

    // Index remote items first
    for (const item of remoteItems) {
      if (idStore.isTombstoned(item.id)) continue;
      resultMap.set(item.id, { ...item });
      if (item.url) urlMap.set(normalizeUrl(item.url), item.id);
    }

    // Merge local items
    for (const localItem of localItems) {
      if (idStore.isTombstoned(localItem.id)) continue;

      const normUrl = localItem.url ? normalizeUrl(localItem.url) : null;
      const matchedRemoteId = resultMap.has(localItem.id)
        ? localItem.id
        : (normUrl ? urlMap.get(normUrl) : null);

      if (matchedRemoteId) {
        const existing = resultMap.get(matchedRemoteId);
        if (localItem.type === 'folder' && existing.type === 'folder') {
          existing.children = this._mergeFolderTrees(localItem.children || [], existing.children || []);
        } else {
          // Take latest modified or local title
          existing.title = localItem.title || existing.title;
        }
      } else {
        // New item created locally
        resultMap.set(localItem.id, { ...localItem });
        if (normUrl) urlMap.set(normUrl, localItem.id);
      }
    }

    return Array.from(resultMap.values());
  }

  _mergeStoredFolders(local = [], remote = []) {
    const map = new Map();
    for (const f of remote) map.set(f.id, f);
    for (const f of local) {
      if (!map.has(f.id)) map.set(f.id, f);
    }
    return Array.from(map.values());
  }

  _mergeStoredSessions(local = [], remote = []) {
    const map = new Map();
    for (const s of remote) map.set(s.id, s);
    for (const s of local) {
      if (!map.has(s.id)) {
        map.set(s.id, s);
      } else {
        // If local has newer updates or locked status
        const remoteSession = map.get(s.id);
        if (s.isLocked) remoteSession.isLocked = true;
        if (s.title && s.title !== remoteSession.title) remoteSession.title = s.title;
      }
    }
    // Sort descending by creation date
    return Array.from(map.values()).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }
}

export const diffEngine = new DiffEngine();
