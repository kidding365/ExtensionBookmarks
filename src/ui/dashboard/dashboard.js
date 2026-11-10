/**
 * ExtensionBookmarks - Main Dashboard UI Controller
 */

import { stashService } from '../../stash/stash-service.js';
import { bookmarkManager } from '../../bookmarks/manager.js';
import { idStore } from '../../sync/id-store.js';
import { gistClient } from '../../sync/gist-client.js';
import { diffEngine } from '../../sync/diff-engine.js';
import { OneTabImporter } from '../../stash/onetab-importer.js';
import { DEFAULT_SETTINGS, formatTimeAgo, extractDomain } from '../../models/types.js';

class DashboardApp {
  constructor() {
    this.currentView = 'stored'; // 'stored' | 'bookmarks-bar' | 'other-bookmarks'
    this.currentFolderId = 'all'; // 'all' or spf_...
    this.searchQuery = '';
    this.searchPill = 'all';
    this.selectedNewFolderColor = '#ef4444';
    this.settings = { ...DEFAULT_SETTINGS };
  }

  async init() {
    await idStore.init();
    await stashService.init();

    // Load settings from storage
    const { eb_settings } = await chrome.storage.local.get('eb_settings');
    this.settings = { ...DEFAULT_SETTINGS, ...(eb_settings || {}) };

    this.bindEvents();
    await this.updateSyncUI();
    await this.refreshSidebar();
    await this.renderContent();
  }

  bindEvents() {
    // Navigation items
    document.querySelectorAll('.nav-item[data-view]').forEach(item => {
      item.addEventListener('click', (e) => {
        const view = item.dataset.view;
        const folder = item.dataset.folder || 'all';
        this.switchView(view, folder);
      });
    });

    // Add Folder button
    document.getElementById('btnAddFolder').addEventListener('click', () => {
      this.openModal('folderModal');
    });

    // Stash Window button in header
    document.getElementById('btnHeaderStashWindow').addEventListener('click', async () => {
      const folderId = (this.currentView === 'stored' && this.currentFolderId !== 'all')
        ? this.currentFolderId
        : null;
      await stashService.stashCurrentWindow(folderId);
      await this.refreshSidebar();
      await this.renderContent();
    });

    // Global Search
    const searchInput = document.getElementById('globalSearchInput');
    const btnClearSearch = document.getElementById('btnClearSearch');

    searchInput.addEventListener('input', () => {
      this.searchQuery = searchInput.value.trim().toLowerCase();
      if (this.searchQuery) {
        btnClearSearch.classList.remove('hidden');
        document.getElementById('searchPills').classList.remove('hidden');
      } else {
        btnClearSearch.classList.add('hidden');
        document.getElementById('searchPills').classList.add('hidden');
      }
      this.renderContent();
    });

    btnClearSearch.addEventListener('click', () => {
      searchInput.value = '';
      this.searchQuery = '';
      btnClearSearch.classList.add('hidden');
      document.getElementById('searchPills').classList.add('hidden');
      this.renderContent();
    });

    // Search pills
    document.querySelectorAll('.pill[data-filter]').forEach(pill => {
      pill.addEventListener('click', () => {
        document.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        this.searchPill = pill.dataset.filter;
        this.renderContent();
      });
    });

    // Sidebar Sync button
    document.getElementById('btnSidebarSync').addEventListener('click', () => {
      this.triggerSync();
    });

    // Modals open/close
    document.getElementById('btnOpenSettings').addEventListener('click', () => {
      this.populateSettingsForm();
      this.openModal('settingsModal');
    });

    document.getElementById('btnCloseSettings').addEventListener('click', () => {
      this.closeModal('settingsModal');
    });

    document.getElementById('btnOpenImportExport').addEventListener('click', () => {
      this.populateImportExportForm();
      this.openModal('importExportModal');
    });

    document.getElementById('btnCloseImportExport').addEventListener('click', () => {
      this.closeModal('importExportModal');
    });

    document.getElementById('btnCloseFolderModal').addEventListener('click', () => {
      this.closeModal('folderModal');
    });
    document.getElementById('btnCancelFolder').addEventListener('click', () => {
      this.closeModal('folderModal');
    });

    // New Folder color dots
    document.querySelectorAll('.color-dot').forEach(dot => {
      dot.addEventListener('click', () => {
        document.querySelectorAll('.color-dot').forEach(d => d.classList.remove('selected'));
        dot.classList.add('selected');
        this.selectedNewFolderColor = dot.dataset.color;
      });
    });

    // Create Folder submit
    document.getElementById('btnCreateFolder').addEventListener('click', async () => {
      const input = document.getElementById('inputFolderName');
      const name = input.value.trim();
      if (!name) return;

      await stashService.createFolder(name, this.selectedNewFolderColor);
      input.value = '';
      this.closeModal('folderModal');
      await this.refreshSidebar();
      await this.renderContent();
    });

    // Settings actions
    document.getElementById('btnTestGithub').addEventListener('click', async () => {
      const token = document.getElementById('inputGithubToken').value.trim();
      const alertBox = document.getElementById('settingsAlert');
      alertBox.className = 'alert-box';
      alertBox.classList.remove('hidden');

      if (!token) {
        alertBox.className = 'alert-box error';
        alertBox.textContent = 'Please enter a GitHub Personal Access Token.';
        return;
      }

      gistClient.setCredentials(token, '');
      try {
        const user = await gistClient.testToken();
        alertBox.className = 'alert-box success';
        alertBox.textContent = `Connected successfully as @${user.login}!`;
      } catch (err) {
        alertBox.className = 'alert-box error';
        alertBox.textContent = `Connection failed: ${err.message}`;
      }
    });

    document.getElementById('btnAutoCreateGist').addEventListener('click', async () => {
      const token = document.getElementById('inputGithubToken').value.trim();
      const alertBox = document.getElementById('settingsAlert');
      alertBox.className = 'alert-box';
      alertBox.classList.remove('hidden');

      if (!token) {
        alertBox.className = 'alert-box error';
        alertBox.textContent = 'Please enter your GitHub token first.';
        return;
      }

      try {
        gistClient.setCredentials(token, '');
        const localTree = await bookmarkManager.getLocalTree();
        const stored = {
          folders: stashService.getFolders(),
          sessions: stashService.getSessions('all')
        };
        const res = await gistClient.createGist(localTree, stored, this.settings);
        document.getElementById('inputGistId').value = res.gistId;
        alertBox.className = 'alert-box success';
        alertBox.textContent = `Private Gist created! ID: ${res.gistId}`;
      } catch (err) {
        alertBox.className = 'alert-box error';
        alertBox.textContent = `Failed to create Gist: ${err.message}`;
      }
    });

    document.getElementById('btnSaveSettings').addEventListener('click', async () => {
      this.settings.githubToken = document.getElementById('inputGithubToken').value.trim();
      this.settings.gistId = document.getElementById('inputGistId').value.trim();
      this.settings.syncBookmarksBar = document.getElementById('toggleSyncBookmarksBar').checked;
      this.settings.syncOtherBookmarks = document.getElementById('toggleSyncOtherBookmarks').checked;
      this.settings.syncStoredPages = document.getElementById('toggleSyncStoredPages').checked;
      this.settings.autoSyncIntervalMinutes = parseInt(document.getElementById('selectSyncInterval').value, 10);

      await chrome.storage.local.set({ eb_settings: this.settings });
      this.closeModal('settingsModal');
      await this.updateSyncUI();

      if (this.settings.githubToken && this.settings.gistId) {
        this.triggerSync();
      }
    });

    // Import / Export Tabs
    document.getElementById('tabBtnImport').addEventListener('click', () => {
      document.getElementById('tabBtnImport').classList.add('active');
      document.getElementById('tabBtnExport').classList.remove('active');
      document.getElementById('tabContentImport').classList.remove('hidden');
      document.getElementById('tabContentExport').classList.add('hidden');
    });

    document.getElementById('tabBtnExport').addEventListener('click', () => {
      document.getElementById('tabBtnExport').classList.add('active');
      document.getElementById('tabBtnImport').classList.remove('active');
      document.getElementById('tabContentExport').classList.remove('hidden');
      document.getElementById('tabContentImport').classList.add('hidden');
    });

    document.getElementById('btnDoImport').addEventListener('click', async () => {
      const text = document.getElementById('importTextarea').value;
      const folderId = document.getElementById('importFolderSelect').value || null;
      if (!text.trim()) return;

      const sessions = OneTabImporter.parseOneTab(text, folderId);
      if (sessions.length > 0) {
        await stashService.importSessions(sessions);
        document.getElementById('importTextarea').value = '';
        this.closeModal('importExportModal');
        await this.refreshSidebar();
        await this.renderContent();
      }
    });

    document.getElementById('btnExportOneTab').addEventListener('click', async () => {
      const sessions = stashService.getSessions('all');
      const text = OneTabImporter.exportToOneTab(sessions);
      await navigator.clipboard.writeText(text);
      alert('OneTab plain-text format copied to clipboard!');
    });

    document.getElementById('btnDownloadJsonBackup').addEventListener('click', async () => {
      const localTree = await bookmarkManager.getLocalTree();
      const backup = {
        exportedAt: new Date().toISOString(),
        version: 1,
        bookmarks: localTree,
        storedPages: {
          folders: stashService.getFolders(),
          sessions: stashService.getSessions('all')
        },
        settings: this.settings
      };

      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `extension_bookmarks_backup_${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  switchView(view, folderId = 'all') {
    this.currentView = view;
    this.currentFolderId = folderId;

    document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));

    if (view === 'stored') {
      const target = document.querySelector(`.nav-item[data-view="stored"][data-folder="${folderId}"]`);
      if (target) target.classList.add('active');
    } else {
      const target = document.querySelector(`.nav-item[data-view="${view}"]`);
      if (target) target.classList.add('active');
    }

    this.renderContent();
  }

  async refreshSidebar() {
    // 1. Group Folders list
    const folderContainer = document.getElementById('groupFoldersList');
    folderContainer.innerHTML = '';

    const folders = stashService.getFolders();
    const allSessions = stashService.getSessions('all');
    document.getElementById('allStashesCount').textContent = allSessions.length;

    for (const f of folders) {
      const count = allSessions.filter(s => s.folderId === f.id).length;
      const li = document.createElement('li');
      li.className = 'nav-item';
      li.dataset.view = 'stored';
      li.dataset.folder = f.id;
      if (this.currentView === 'stored' && this.currentFolderId === f.id) {
        li.classList.add('active');
      }

      li.innerHTML = `
        <span class="folder-color-dot" style="background: ${f.color || '#3b82f6'};"></span>
        <span class="nav-label">${f.name}</span>
        <span class="nav-badge">${count}</span>
      `;

      li.addEventListener('click', () => {
        this.switchView('stored', f.id);
      });

      folderContainer.appendChild(li);
    }

    // 2. Bookmarks counts
    const tree = await bookmarkManager.getLocalTree();
    document.getElementById('bookmarksBarCount').textContent = (tree.bookmarksBar || []).length;
    document.getElementById('otherBookmarksCount').textContent = (tree.otherBookmarks || []).length;
  }

  async updateSyncUI() {
    const dot = document.getElementById('syncDot');
    const label = document.getElementById('syncStatusLabel');
    const timeText = document.getElementById('lastSyncTime');

    if (!this.settings.githubToken || !this.settings.gistId) {
      dot.className = 'status-dot';
      label.textContent = 'Not Configured';
      timeText.textContent = 'Click settings to configure';
    } else if (this.settings.lastSyncStatus === 'syncing') {
      dot.className = 'status-dot syncing';
      label.textContent = 'Syncing...';
    } else if (this.settings.lastSyncStatus === 'error') {
      dot.className = 'status-dot error';
      label.textContent = 'Sync Error';
      timeText.textContent = this.settings.lastSyncError || 'Check settings';
    } else {
      dot.className = 'status-dot';
      label.textContent = 'Synced with Gist';
      timeText.textContent = this.settings.lastSyncTime
        ? `Last sync: ${formatTimeAgo(this.settings.lastSyncTime)}`
        : 'Ready';
    }
  }

  async triggerSync() {
    const btnSync = document.getElementById('btnSidebarSync');
    btnSync.classList.add('spinning');
    this.settings.lastSyncStatus = 'syncing';
    await this.updateSyncUI();

    chrome.runtime.sendMessage({ type: 'TRIGGER_SYNC' }, async (response) => {
      btnSync.classList.remove('spinning');
      if (response && response.success) {
        this.settings.lastSyncStatus = 'success';
        this.settings.lastSyncTime = Date.now();
        await chrome.storage.local.set({ eb_settings: this.settings });
        await this.updateSyncUI();
        await this.refreshSidebar();
        await this.renderContent();
      } else {
        this.settings.lastSyncStatus = 'error';
        this.settings.lastSyncError = response ? response.error : 'Sync failed';
        await chrome.storage.local.set({ eb_settings: this.settings });
        await this.updateSyncUI();
      }
    });
  }

  // --- Content Rendering ---

  async renderContent() {
    const container = document.getElementById('contentList');
    container.innerHTML = '';

    if (this.searchQuery) {
      await this.renderSearchResults(container);
      return;
    }

    if (this.currentView === 'stored') {
      this.renderStoredPages(container);
    } else if (this.currentView === 'bookmarks-bar') {
      await this.renderBookmarksBar(container);
    } else if (this.currentView === 'other-bookmarks') {
      await this.renderOtherBookmarks(container);
    }
  }

  renderStoredPages(container) {
    const sessions = stashService.getSessions(this.currentFolderId);
    const folders = stashService.getFolders();

    const viewHeading = document.getElementById('viewHeading');
    const viewSubheading = document.getElementById('viewSubheading');

    if (this.currentFolderId === 'all') {
      viewHeading.textContent = 'All Stashed Pages';
      viewSubheading.textContent = `${sessions.length} sessions`;
    } else {
      const folder = folders.find(f => f.id === this.currentFolderId);
      viewHeading.textContent = folder ? `Folder: ${folder.name}` : 'Stashed Pages';
      viewSubheading.textContent = `${sessions.length} sessions`;
    }

    if (sessions.length === 0) {
      container.innerHTML = `
        <div style="text-align: center; padding: 60px 20px; color: var(--text-muted);">
          <div style="font-size: 32px; margin-bottom: 12px;">📑</div>
          <h3 style="font-size: 16px; font-weight: 600; color: var(--text-main);">No tabs stashed here yet</h3>
          <p style="font-size: 13px; margin-top: 6px;">Use <strong>Alt+Shift+1</strong> or click "Stash Window" to store your open tabs.</p>
        </div>
      `;
      return;
    }

    for (const session of sessions) {
      const folder = folders.find(f => f.id === session.folderId);
      const card = document.createElement('div');
      card.className = 'session-card';

      // Header
      const header = document.createElement('div');
      header.className = 'session-header';

      const titleArea = document.createElement('div');
      titleArea.className = 'session-title-area';

      const title = document.createElement('span');
      title.className = 'session-title';
      title.textContent = session.title;
      title.title = 'Click to rename session';

      title.addEventListener('click', async () => {
        const newTitle = prompt('Rename tab session:', session.title);
        if (newTitle && newTitle.trim()) {
          await stashService.renameSession(session.id, newTitle.trim());
          this.renderContent();
        }
      });

      const meta = document.createElement('span');
      meta.className = 'session-meta-pill';
      meta.textContent = `${session.tabs.length} tabs • ${formatTimeAgo(session.createdAt)}`;

      titleArea.appendChild(title);
      titleArea.appendChild(meta);

      if (folder) {
        const badge = document.createElement('span');
        badge.className = 'session-folder-badge';
        badge.style.backgroundColor = folder.color || '#3b82f6';
        badge.textContent = folder.name;
        titleArea.appendChild(badge);
      }

      // Actions
      const actions = document.createElement('div');
      actions.className = 'session-actions';

      const btnRestoreAll = document.createElement('button');
      btnRestoreAll.className = 'card-btn primary';
      btnRestoreAll.textContent = '🚀 Restore All';
      btnRestoreAll.addEventListener('click', async () => {
        await stashService.restoreSession(session.id, false);
        await this.refreshSidebar();
        await this.renderContent();
      });

      const btnLock = document.createElement('button');
      btnLock.className = 'card-btn';
      btnLock.textContent = session.isLocked ? '🔒 Locked' : '🔓 Lock';
      btnLock.title = 'Lock session to prevent accidental deletion';
      btnLock.addEventListener('click', async () => {
        await stashService.toggleLockSession(session.id);
        this.renderContent();
      });

      const btnDelete = document.createElement('button');
      btnDelete.className = 'card-btn danger';
      btnDelete.textContent = '🗑️ Delete';
      btnDelete.addEventListener('click', async () => {
        if (!session.isLocked || confirm('This session is locked. Delete anyway?')) {
          await stashService.deleteSession(session.id);
          await this.refreshSidebar();
          await this.renderContent();
        }
      });

      actions.appendChild(btnRestoreAll);
      actions.appendChild(btnLock);
      actions.appendChild(btnDelete);

      header.appendChild(titleArea);
      header.appendChild(actions);
      card.appendChild(header);

      // Tab list
      const tabList = document.createElement('ul');
      tabList.className = 'tab-list';

      for (const tab of session.tabs || []) {
        const row = document.createElement('li');
        row.className = 'tab-row';

        const favicon = document.createElement('img');
        favicon.className = 'tab-favicon';
        favicon.src = tab.faviconUrl || `https://www.google.com/s2/favicons?sz=32&domain=${tab.domain}`;
        favicon.alt = '';

        const link = document.createElement('a');
        link.className = 'tab-link';
        link.textContent = tab.title || tab.url;
        link.href = tab.url;
        link.title = tab.url;

        link.addEventListener('click', async (e) => {
          e.preventDefault();
          await stashService.restoreTab(session.id, tab.id);
          await this.refreshSidebar();
          await this.renderContent();
        });

        const domain = document.createElement('span');
        domain.className = 'tab-domain';
        domain.textContent = tab.domain || extractDomain(tab.url);

        const btnDelTab = document.createElement('button');
        btnDelTab.className = 'tab-delete-btn';
        btnDelTab.innerHTML = '&times;';
        btnDelTab.title = 'Delete Tab';

        btnDelTab.addEventListener('click', async () => {
          await stashService.deleteTab(session.id, tab.id);
          await this.refreshSidebar();
          await this.renderContent();
        });

        row.appendChild(favicon);
        row.appendChild(link);
        row.appendChild(domain);
        row.appendChild(btnDelTab);
        tabList.appendChild(row);
      }

      card.appendChild(tabList);
      container.appendChild(card);
    }
  }

  async renderBookmarksBar(container) {
    document.getElementById('viewHeading').textContent = 'Bookmarks Bar';
    const tree = await bookmarkManager.getLocalTree();
    const items = tree.bookmarksBar || [];
    document.getElementById('viewSubheading').textContent = `${items.length} items`;
    this._renderBookmarkItems(container, items);
  }

  async renderOtherBookmarks(container) {
    document.getElementById('viewHeading').textContent = 'Other Bookmarks';
    const tree = await bookmarkManager.getLocalTree();
    const items = tree.otherBookmarks || [];
    document.getElementById('viewSubheading').textContent = `${items.length} items (incl. Mobile Bookmarks)`;
    this._renderBookmarkItems(container, items);
  }

  _renderBookmarkItems(container, items) {
    if (items.length === 0) {
      container.innerHTML = '<div style="padding: 40px; color: var(--text-muted); text-align: center;">No bookmarks found in this section.</div>';
      return;
    }

    const card = document.createElement('div');
    card.className = 'session-card';

    const tabList = document.createElement('ul');
    tabList.className = 'tab-list';

    for (const item of items) {
      if (item.type === 'folder') {
        const folderHeader = document.createElement('li');
        folderHeader.className = 'tab-row';
        folderHeader.style.backgroundColor = 'var(--bg-app)';
        folderHeader.style.fontWeight = '600';

        const icon = item.isMobileFolder ? '📱' : '📁';
        folderHeader.innerHTML = `
          <span>${icon}</span>
          <span style="flex: 1;">${item.title}</span>
          <span class="tab-domain">${(item.children || []).length} items</span>
        `;
        tabList.appendChild(folderHeader);

        // Sub-items
        for (const child of item.children || []) {
          tabList.appendChild(this._createBookmarkRow(child, true));
        }
      } else {
        tabList.appendChild(this._createBookmarkRow(item, false));
      }
    }

    card.appendChild(tabList);
    container.appendChild(card);
  }

  _createBookmarkRow(item, isIndented = false) {
    const row = document.createElement('li');
    row.className = 'tab-row';
    if (isIndented) row.style.paddingLeft = '36px';

    const domain = extractDomain(item.url);
    const favicon = document.createElement('img');
    favicon.className = 'tab-favicon';
    favicon.src = `https://www.google.com/s2/favicons?sz=32&domain=${domain}`;
    favicon.alt = '';

    const link = document.createElement('a');
    link.className = 'tab-link';
    link.textContent = item.title || item.url;
    link.href = item.url;
    link.target = '_blank';

    const domainSpan = document.createElement('span');
    domainSpan.className = 'tab-domain';
    domainSpan.textContent = domain;

    row.appendChild(favicon);
    row.appendChild(link);
    row.appendChild(domainSpan);
    return row;
  }

  async renderSearchResults(container) {
    document.getElementById('viewHeading').textContent = `Search results for "${this.searchQuery}"`;
    const query = this.searchQuery;
    const filter = this.searchPill;

    const matchedTabs = [];
    const matchedBookmarks = [];

    // Search Stored Pages
    if (filter === 'all' || filter === 'stored') {
      const sessions = stashService.getSessions('all');
      for (const session of sessions) {
        for (const tab of session.tabs || []) {
          if ((tab.title || '').toLowerCase().includes(query) || (tab.url || '').toLowerCase().includes(query)) {
            matchedTabs.push({ ...tab, sessionTitle: session.title, sessionId: session.id });
          }
        }
      }
    }

    // Search Bookmarks
    if (filter === 'all' || filter === 'bookmarks-bar' || filter === 'other-bookmarks') {
      const tree = await bookmarkManager.getLocalTree();
      const searchInTree = (list, sectionName) => {
        for (const node of list) {
          if (node.type === 'bookmark') {
            if ((node.title || '').toLowerCase().includes(query) || (node.url || '').toLowerCase().includes(query)) {
              matchedBookmarks.push({ ...node, section: sectionName });
            }
          } else if (node.children) {
            searchInTree(node.children, sectionName);
          }
        }
      };

      if (filter === 'all' || filter === 'bookmarks-bar') {
        searchInTree(tree.bookmarksBar || [], 'Bookmarks Bar');
      }
      if (filter === 'all' || filter === 'other-bookmarks') {
        searchInTree(tree.otherBookmarks || [], 'Other Bookmarks');
      }
    }

    const totalCount = matchedTabs.length + matchedBookmarks.length;
    document.getElementById('viewSubheading').textContent = `${totalCount} matches found`;

    if (totalCount === 0) {
      container.innerHTML = '<div style="padding: 40px; color: var(--text-muted); text-align: center;">No matching tabs or bookmarks found.</div>';
      return;
    }

    const card = document.createElement('div');
    card.className = 'session-card';
    const tabList = document.createElement('ul');
    tabList.className = 'tab-list';

    for (const tab of matchedTabs) {
      const row = document.createElement('li');
      row.className = 'tab-row';

      const favicon = document.createElement('img');
      favicon.className = 'tab-favicon';
      favicon.src = tab.faviconUrl || `https://www.google.com/s2/favicons?sz=32&domain=${tab.domain}`;

      const link = document.createElement('a');
      link.className = 'tab-link';
      link.textContent = tab.title || tab.url;
      link.href = tab.url;

      link.addEventListener('click', async (e) => {
        e.preventDefault();
        chrome.tabs.create({ url: tab.url });
      });

      const badge = document.createElement('span');
      badge.className = 'tab-domain';
      badge.textContent = `📑 Stored (${tab.sessionTitle})`;

      row.appendChild(favicon);
      row.appendChild(link);
      row.appendChild(badge);
      tabList.appendChild(row);
    }

    for (const bm of matchedBookmarks) {
      const row = document.createElement('li');
      row.className = 'tab-row';

      const domain = extractDomain(bm.url);
      const favicon = document.createElement('img');
      favicon.className = 'tab-favicon';
      favicon.src = `https://www.google.com/s2/favicons?sz=32&domain=${domain}`;

      const link = document.createElement('a');
      link.className = 'tab-link';
      link.textContent = bm.title || bm.url;
      link.href = bm.url;
      link.target = '_blank';

      const badge = document.createElement('span');
      badge.className = 'tab-domain';
      badge.textContent = `⭐ ${bm.section}`;

      row.appendChild(favicon);
      row.appendChild(link);
      row.appendChild(badge);
      tabList.appendChild(row);
    }

    card.appendChild(tabList);
    container.appendChild(card);
  }

  // --- Modals ---

  openModal(modalId) {
    document.getElementById(modalId).classList.remove('hidden');
  }

  closeModal(modalId) {
    document.getElementById(modalId).classList.add('hidden');
  }

  populateSettingsForm() {
    document.getElementById('inputGithubToken').value = this.settings.githubToken || '';
    document.getElementById('inputGistId').value = this.settings.gistId || '';
    document.getElementById('toggleSyncBookmarksBar').checked = this.settings.syncBookmarksBar;
    document.getElementById('toggleSyncOtherBookmarks').checked = this.settings.syncOtherBookmarks;
    document.getElementById('toggleSyncStoredPages').checked = this.settings.syncStoredPages;
    document.getElementById('selectSyncInterval').value = String(this.settings.autoSyncIntervalMinutes || 10);
    document.getElementById('settingsAlert').classList.add('hidden');
  }

  populateImportExportForm() {
    const select = document.getElementById('importFolderSelect');
    select.innerHTML = '<option value="">(None / General)</option>';
    const folders = stashService.getFolders();
    for (const f of folders) {
      const opt = document.createElement('option');
      opt.value = f.id;
      opt.textContent = f.name;
      select.appendChild(opt);
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const app = new DashboardApp();
  app.init();
});
