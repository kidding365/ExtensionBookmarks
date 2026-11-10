/**
 * ExtensionBookmarks - Browser Root Normalizer
 * Handles Chromium vs Firefox differences, normalizes root folders,
 * and nests Mobile Bookmarks neatly under Other Bookmarks.
 */

import { generateId, normalizeUrl } from '../models/types.js';
import { idStore } from '../sync/id-store.js';

export class BookmarkNormalizer {
  constructor() {
    this.isFirefox = false;
    this.rootsDetected = false;
    this.rootIds = {
      bookmarksBar: null,
      otherBookmarks: null,
      mobileBookmarks: null,
      bookmarksMenu: null
    };
  }

  async detectRoots() {
    if (this.rootsDetected) return this.rootIds;

    const [rootNode] = await chrome.bookmarks.getTree();
    const children = rootNode.children || [];

    // Check if Firefox ID scheme
    const isFx = children.some(c => c.id === 'toolbar_____' || c.id === 'unfiled_____');
    this.isFirefox = isFx;

    if (isFx) {
      for (const node of children) {
        if (node.id === 'toolbar_____') this.rootIds.bookmarksBar = node.id;
        else if (node.id === 'unfiled_____') this.rootIds.otherBookmarks = node.id;
        else if (node.id === 'mobile______') this.rootIds.mobileBookmarks = node.id;
        else if (node.id === 'menu________') this.rootIds.bookmarksMenu = node.id;
      }
    } else {
      // Chromium scheme (Chrome, Edge, Brave, Opera)
      for (const node of children) {
        const titleLower = (node.title || '').toLowerCase();
        if (node.id === '1' || titleLower.includes('bar') || titleLower.includes('toolbar')) {
          this.rootIds.bookmarksBar = node.id;
        } else if (node.id === '2' || titleLower.includes('other')) {
          this.rootIds.otherBookmarks = node.id;
        } else if (node.id === '3' || titleLower.includes('mobile')) {
          this.rootIds.mobileBookmarks = node.id;
        }
      }
      // Fallbacks if IDs differ
      if (!this.rootIds.bookmarksBar && children.length > 0) this.rootIds.bookmarksBar = children[0].id;
      if (!this.rootIds.otherBookmarks && children.length > 1) this.rootIds.otherBookmarks = children[1].id;
      if (!this.rootIds.mobileBookmarks && children.length > 2) this.rootIds.mobileBookmarks = children[2].id;
    }

    this.rootsDetected = true;
    return this.rootIds;
  }

  /**
   * Reads and converts local browser bookmark trees into normalized trees with stable IDs.
   * Mobile Bookmarks is nested as a designated child folder inside Other Bookmarks.
   */
  async exportNormalizedTree() {
    await idStore.init();
    await this.detectRoots();

    const [root] = await chrome.bookmarks.getTree();
    const children = root.children || [];

    const barNode = children.find(c => c.id === this.rootIds.bookmarksBar);
    const otherNode = children.find(c => c.id === this.rootIds.otherBookmarks);
    const mobileNode = children.find(c => c.id === this.rootIds.mobileBookmarks);

    const bookmarksBar = barNode ? this._normalizeFolderChildren(barNode.children || []) : [];
    const otherBookmarks = otherNode ? this._normalizeFolderChildren(otherNode.children || []) : [];

    // If native Mobile Bookmarks exists as a sibling root, embed it as a folder inside otherBookmarks
    if (mobileNode && (mobileNode.children || []).length > 0) {
      let mobileStableId = idStore.getStableId(mobileNode.id);
      if (!mobileStableId) {
        mobileStableId = 'fld_mobile_root';
        idStore.setMapping(mobileNode.id, mobileStableId);
      }

      const normalizedMobileFolder = {
        id: mobileStableId,
        type: 'folder',
        title: 'Mobile Bookmarks',
        isMobileFolder: true,
        dateAdded: mobileNode.dateAdded || Date.now(),
        children: this._normalizeFolderChildren(mobileNode.children || [])
      };

      // Ensure it is present in otherBookmarks without duplicating
      const existingIdx = otherBookmarks.findIndex(item => item.isMobileFolder || item.title === 'Mobile Bookmarks');
      if (existingIdx >= 0) {
        otherBookmarks[existingIdx] = normalizedMobileFolder;
      } else {
        otherBookmarks.unshift(normalizedMobileFolder);
      }
    }

    await idStore.save();
    return { bookmarksBar, otherBookmarks };
  }

  _normalizeFolderChildren(children) {
    const list = [];
    for (const node of children) {
      if (node.url) {
        // Bookmark item
        let stableId = idStore.getStableId(node.id);
        if (!stableId) {
          stableId = generateId('bm');
          idStore.setMapping(node.id, stableId);
        }
        list.push({
          id: stableId,
          type: 'bookmark',
          title: node.title || 'Untitled Bookmark',
          url: node.url,
          dateAdded: node.dateAdded || Date.now(),
          dateModified: node.dateGroupModified || Date.now()
        });
      } else if (node.children) {
        // Subfolder
        let stableId = idStore.getStableId(node.id);
        if (!stableId) {
          stableId = generateId('fld');
          idStore.setMapping(node.id, stableId);
        }
        list.push({
          id: stableId,
          type: 'folder',
          title: node.title || 'New Folder',
          dateAdded: node.dateAdded || Date.now(),
          children: this._normalizeFolderChildren(node.children)
        });
      }
    }
    return list;
  }
}

export const normalizer = new BookmarkNormalizer();
