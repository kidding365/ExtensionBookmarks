/**
 * ExtensionBookmarks - Stash Service (Stored Pages & Group Folders)
 * Captures, groups, and organizes tab sessions with local-first instant persistence.
 */

import { generateId, DEFAULT_GROUP_FOLDERS, extractDomain } from '../models/types.js';

const KEY_FOLDERS = 'eb_stored_folders';
const KEY_SESSIONS = 'eb_stored_sessions';

export class StashService {
  constructor() {
    this.folders = [];
    this.sessions = [];
    this.initialized = false;
  }

  async init() {
    if (this.initialized) return;
    const data = await chrome.storage.local.get([KEY_FOLDERS, KEY_SESSIONS]);

    this.folders = data[KEY_FOLDERS] || DEFAULT_GROUP_FOLDERS;
    this.sessions = data[KEY_SESSIONS] || [];
    this.initialized = true;
  }

  async _save() {
    await chrome.storage.local.set({
      [KEY_FOLDERS]: this.folders,
      [KEY_SESSIONS]: this.sessions
    });
  }

  // --- Folder Management ---

  getFolders() {
    return [...this.folders];
  }

  async createFolder(name, color = '#3b82f6') {
    await this.init();
    const folder = {
      id: generateId('spf'),
      name: name.trim(),
      color,
      createdAt: Date.now()
    };
    this.folders.push(folder);
    await this._save();
    return folder;
  }

  async deleteFolder(folderId) {
    await this.init();
    this.folders = this.folders.filter(f => f.id !== folderId);
    // Unassign sessions in this folder
    for (const session of this.sessions) {
      if (session.folderId === folderId) {
        session.folderId = null;
      }
    }
    await this._save();
  }

  async renameFolder(folderId, newName, newColor) {
    await this.init();
    const folder = this.folders.find(f => f.id === folderId);
    if (folder) {
      if (newName) folder.name = newName.trim();
      if (newColor) folder.color = newColor;
      await this._save();
    }
  }

  // --- Session Management ---

  getSessions(filterFolderId = null) {
    if (!filterFolderId || filterFolderId === 'all') {
      return [...this.sessions];
    }
    return this.sessions.filter(s => s.folderId === filterFolderId);
  }

  /**
   * Stashes all open tabs in current window into a new session batch.
   */
  async stashCurrentWindow(targetFolderId = null, customTitle = null) {
    await this.init();
    const tabs = await chrome.tabs.query({ currentWindow: true });

    // Filter out internal and invalid tabs
    const validTabs = tabs.filter(tab => {
      const url = tab.url || '';
      return (
        url.startsWith('http://') ||
        url.startsWith('https://') ||
        url.startsWith('file://')
      ) && !url.includes(chrome.runtime.id);
    });

    if (validTabs.length === 0) {
      return { count: 0 };
    }

    const tabItems = validTabs.map(t => {
      const domain = extractDomain(t.url);
      return {
        id: generateId('tab'),
        title: t.title || domain || t.url,
        url: t.url,
        domain,
        faviconUrl: t.favIconUrl || `https://www.google.com/s2/favicons?sz=32&domain=${domain}`
      };
    });

    const defaultTitle = customTitle || (
      tabItems.length === 1
        ? tabItems[0].title
        : `${tabItems[0].domain} & ${tabItems.length - 1} tabs`
    );

    const newSession = {
      id: generateId('sps'),
      folderId: targetFolderId,
      title: defaultTitle,
      createdAt: Date.now(),
      isLocked: false,
      tabs: tabItems
    };

    // Prepend to top of sessions list
    this.sessions.unshift(newSession);
    await this._save();

    // Open dashboard before closing window tabs so window doesn't close completely
    const dashboardUrl = chrome.runtime.getURL('src/ui/dashboard/dashboard.html');
    await chrome.tabs.create({ url: dashboardUrl });

    // Close the original stashed tabs
    const tabIdsToClose = validTabs.map(t => t.id).filter(Boolean);
    if (tabIdsToClose.length > 0) {
      await chrome.tabs.remove(tabIdsToClose);
    }

    return { count: tabItems.length, session: newSession };
  }

  /**
   * Stashes only the active tab in current window.
   */
  async stashActiveTab(targetFolderId = null) {
    await this.init();
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url || (!tab.url.startsWith('http') && !tab.url.startsWith('file'))) {
      return null;
    }

    const domain = extractDomain(tab.url);
    const tabItem = {
      id: generateId('tab'),
      title: tab.title || domain || tab.url,
      url: tab.url,
      domain,
      faviconUrl: tab.favIconUrl || `https://www.google.com/s2/favicons?sz=32&domain=${domain}`
    };

    const newSession = {
      id: generateId('sps'),
      folderId: targetFolderId,
      title: tabItem.title,
      createdAt: Date.now(),
      isLocked: false,
      tabs: [tabItem]
    };

    this.sessions.unshift(newSession);
    await this._save();

    await chrome.tabs.remove(tab.id);
    return newSession;
  }

  async restoreSession(sessionId, inNewWindow = false) {
    await this.init();
    const session = this.sessions.find(s => s.id === sessionId);
    if (!session || !session.tabs || session.tabs.length === 0) return;

    const urls = session.tabs.map(t => t.url);

    if (inNewWindow) {
      await chrome.windows.create({ url: urls });
    } else {
      for (const url of urls) {
        await chrome.tabs.create({ url, active: false });
      }
    }

    // If session is not locked, delete it on restore (classic OneTab behavior)
    if (!session.isLocked) {
      await this.deleteSession(sessionId);
    }
  }

  async restoreTab(sessionId, tabId, keepInSession = false) {
    await this.init();
    const session = this.sessions.find(s => s.id === sessionId);
    if (!session) return;

    const tab = (session.tabs || []).find(t => t.id === tabId);
    if (!tab) return;

    await chrome.tabs.create({ url: tab.url, active: true });

    if (!keepInSession && !session.isLocked) {
      await this.deleteTab(sessionId, tabId);
    }
  }

  async deleteSession(sessionId) {
    await this.init();
    this.sessions = this.sessions.filter(s => s.id !== sessionId);
    await this._save();
  }

  async deleteTab(sessionId, tabId) {
    await this.init();
    const session = this.sessions.find(s => s.id === sessionId);
    if (!session) return;

    session.tabs = (session.tabs || []).filter(t => t.id !== tabId);
    if (session.tabs.length === 0) {
      await this.deleteSession(sessionId);
    } else {
      await this._save();
    }
  }

  async renameSession(sessionId, newTitle) {
    await this.init();
    const session = this.sessions.find(s => s.id === sessionId);
    if (session && newTitle) {
      session.title = newTitle.trim();
      await this._save();
    }
  }

  async toggleLockSession(sessionId) {
    await this.init();
    const session = this.sessions.find(s => s.id === sessionId);
    if (session) {
      session.isLocked = !session.isLocked;
      await this._save();
      return session.isLocked;
    }
    return false;
  }

  async moveSessionToFolder(sessionId, folderId) {
    await this.init();
    const session = this.sessions.find(s => s.id === sessionId);
    if (session) {
      session.folderId = folderId || null;
      await this._save();
    }
  }

  async importSessions(sessions) {
    await this.init();
    this.sessions = [...sessions, ...this.sessions];
    await this._save();
  }

  /**
   * Replaces local stored pages payload directly from sync.
   */
  async setStoredPagesFromSync(folders, sessions) {
    this.folders = folders || DEFAULT_GROUP_FOLDERS;
    this.sessions = sessions || [];
    await this._save();
  }
}

export const stashService = new StashService();
