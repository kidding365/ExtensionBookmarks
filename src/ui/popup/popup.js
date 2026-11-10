/**
 * ExtensionBookmarks - Popup UI Script
 */

import { stashService } from '../../stash/stash-service.js';
import { bookmarkManager } from '../../bookmarks/manager.js';
import { DEFAULT_SETTINGS, extractDomain } from '../../models/types.js';

document.addEventListener('DOMContentLoaded', async () => {
  const btnStashWindow = document.getElementById('btnStashWindow');
  const btnStashWindowText = document.getElementById('btnStashWindowText');
  const btnStashTab = document.getElementById('btnStashTab');
  const targetFolderSelect = document.getElementById('targetFolderSelect');
  const quickSearchInput = document.getElementById('quickSearchInput');
  const quickSearchResults = document.getElementById('quickSearchResults');
  const btnOpenDashboard = document.getElementById('btnOpenDashboard');
  const btnQuickSync = document.getElementById('btnQuickSync');
  const syncStatusBadge = document.getElementById('syncStatusBadge');
  const syncStatusText = document.getElementById('syncStatusText');

  // Initialize stash service
  await stashService.init();

  // Populate folder select dropdown
  const folders = stashService.getFolders();
  for (const f of folders) {
    const opt = document.createElement('option');
    opt.value = f.id;
    opt.textContent = `📁 ${f.name}`;
    targetFolderSelect.appendChild(opt);
  }

  // Update window tabs count on button
  chrome.tabs.query({ currentWindow: true }, (tabs) => {
    const validCount = tabs.filter(t => t.url && t.url.startsWith('http') && !t.url.includes(chrome.runtime.id)).length;
    if (validCount > 0) {
      btnStashWindowText.textContent = `Stash Window (${validCount} tabs)`;
    }
  });

  // Load sync status
  const { eb_settings } = await chrome.storage.local.get('eb_settings');
  const settings = { ...DEFAULT_SETTINGS, ...(eb_settings || {}) };
  if (!settings.githubToken || !settings.gistId) {
    syncStatusBadge.className = 'sync-badge';
    syncStatusText.textContent = 'Setup Sync';
  }

  // Stash Window action
  btnStashWindow.addEventListener('click', async () => {
    const folderId = targetFolderSelect.value || null;
    btnStashWindow.disabled = true;
    btnStashWindowText.textContent = 'Stashing...';

    chrome.runtime.sendMessage({ type: 'STASH_WINDOW', folderId }, () => {
      window.close();
    });
  });

  // Stash Tab action
  btnStashTab.addEventListener('click', async () => {
    const folderId = targetFolderSelect.value || null;
    btnStashTab.disabled = true;

    chrome.runtime.sendMessage({ type: 'STASH_TAB', folderId }, () => {
      window.close();
    });
  });

  // Open Dashboard
  btnOpenDashboard.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'OPEN_DASHBOARD' }, () => {
      window.close();
    });
  });

  // Quick Sync
  btnQuickSync.addEventListener('click', async () => {
    syncStatusBadge.className = 'sync-badge syncing';
    syncStatusText.textContent = 'Syncing...';

    chrome.runtime.sendMessage({ type: 'TRIGGER_SYNC' }, (response) => {
      if (response && response.success) {
        syncStatusBadge.className = 'sync-badge';
        syncStatusText.textContent = 'Synced';
      } else {
        syncStatusBadge.className = 'sync-badge error';
        syncStatusText.textContent = 'Error';
      }
    });
  });

  // Quick Search across both Stored Pages and Bookmarks
  let searchDebounce = null;
  quickSearchInput.addEventListener('input', () => {
    clearTimeout(searchDebounce);
    const query = quickSearchInput.value.trim().toLowerCase();

    if (!query) {
      quickSearchResults.classList.add('hidden');
      quickSearchResults.innerHTML = '';
      return;
    }

    searchDebounce = setTimeout(async () => {
      const results = [];

      // Search Stored Pages
      const sessions = stashService.getSessions('all');
      for (const session of sessions) {
        for (const tab of session.tabs || []) {
          if ((tab.title || '').toLowerCase().includes(query) || (tab.url || '').toLowerCase().includes(query)) {
            results.push({
              title: tab.title,
              url: tab.url,
              domain: tab.domain || extractDomain(tab.url),
              type: 'stored'
            });
            if (results.length >= 8) break;
          }
        }
        if (results.length >= 8) break;
      }

      // Search Bookmarks
      if (results.length < 8) {
        const bookmarks = await chrome.bookmarks.search(query);
        for (const bm of bookmarks) {
          if (bm.url && !results.some(r => r.url === bm.url)) {
            results.push({
              title: bm.title,
              url: bm.url,
              domain: extractDomain(bm.url),
              type: 'bookmark'
            });
            if (results.length >= 8) break;
          }
        }
      }

      renderSearchResults(results);
    }, 150);
  });

  function renderSearchResults(results) {
    if (results.length === 0) {
      quickSearchResults.innerHTML = '<div style="padding: 8px; color: var(--text-muted); text-align: center;">No matches found</div>';
      quickSearchResults.classList.remove('hidden');
      return;
    }

    quickSearchResults.innerHTML = '';
    for (const item of results) {
      const a = document.createElement('a');
      a.className = 'search-result-item';
      a.href = item.url;
      a.target = '_blank';

      const favicon = document.createElement('img');
      favicon.className = 'result-favicon';
      favicon.src = `https://www.google.com/s2/favicons?sz=32&domain=${item.domain}`;
      favicon.alt = '';

      const info = document.createElement('div');
      info.className = 'result-info';

      const title = document.createElement('span');
      title.className = 'result-title';
      title.textContent = item.title || item.url;

      const domain = document.createElement('span');
      domain.className = 'result-domain';
      domain.textContent = `${item.type === 'stored' ? '📑 Stored' : '⭐ Bookmark'} • ${item.domain}`;

      info.appendChild(title);
      info.appendChild(domain);
      a.appendChild(favicon);
      a.appendChild(info);

      a.addEventListener('click', (e) => {
        e.preventDefault();
        chrome.tabs.create({ url: item.url });
        window.close();
      });

      quickSearchResults.appendChild(a);
    }

    quickSearchResults.classList.remove('hidden');
  }
});
