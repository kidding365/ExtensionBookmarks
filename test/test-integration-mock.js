/**
 * ExtensionBookmarks - End-to-End Mock Integration Test
 * Simulates the Chrome Extension APIs and validates popup, dashboard, and background operations.
 */

import assert from 'assert';
import { generateId, DEFAULT_SETTINGS, DEFAULT_GROUP_FOLDERS } from '../src/models/types.js';
import { stashService } from '../src/stash/stash-service.js';
import { idStore } from '../src/sync/id-store.js';
import { normalizer } from '../src/bookmarks/normalizer.js';
import { bookmarkManager } from '../src/bookmarks/manager.js';
import { diffEngine } from '../src/sync/diff-engine.js';
import { OneTabImporter } from '../src/stash/onetab-importer.js';

// Setup Mock Chrome Environment
const storageMemory = {};
const mockBookmarks = [
  {
    id: '0',
    title: '',
    children: [
      {
        id: '1',
        title: 'Bookmarks bar',
        children: [
          { id: '11', title: 'GitHub', url: 'https://github.com' },
          { id: '12', title: 'YouTube', url: 'https://youtube.com' }
        ]
      },
      {
        id: '2',
        title: 'Other bookmarks',
        children: [
          { id: '21', title: 'Docs', url: 'https://developer.mozilla.org' }
        ]
      },
      {
        id: '3',
        title: 'Mobile bookmarks',
        children: [
          { id: '31', title: 'Mobile News', url: 'https://news.ycombinator.com' }
        ]
      }
    ]
  }
];

let mockOpenTabs = [
  { id: 101, windowId: 1, active: true, title: 'GitHub Repo', url: 'https://github.com/kidding365/ExtensionBookmarks' },
  { id: 102, windowId: 1, active: false, title: 'Google Search', url: 'https://google.com' },
  { id: 103, windowId: 1, active: false, title: 'Hacker News', url: 'https://news.ycombinator.com' }
];

global.chrome = {
  runtime: {
    id: 'mock_extension_id',
    getURL: (path) => `chrome-extension://mock_extension_id/${path}`
  },
  storage: {
    local: {
      get: async (keys) => {
        if (typeof keys === 'string') keys = [keys];
        const res = {};
        for (const k of keys) {
          if (storageMemory[k] !== undefined) res[k] = storageMemory[k];
        }
        return res;
      },
      set: async (items) => {
        Object.assign(storageMemory, items);
      }
    }
  },
  tabs: {
    query: async (queryInfo) => {
      let result = [...mockOpenTabs];
      if (queryInfo.active !== undefined) {
        result = result.filter(t => t.active === queryInfo.active);
      }
      return result;
    },
    create: async ({ url, windowId }) => {
      const newTab = { id: Math.floor(Math.random() * 1000) + 200, windowId: windowId || 1, active: true, url, title: url };
      mockOpenTabs.push(newTab);
      return newTab;
    },
    remove: async (tabIds) => {
      if (!Array.isArray(tabIds)) tabIds = [tabIds];
      mockOpenTabs = mockOpenTabs.filter(t => !tabIds.includes(t.id));
    }
  },
  bookmarks: {
    getTree: async () => mockBookmarks,
    getSubTree: async (id) => {
      function findNode(nodes, targetId) {
        for (const n of nodes) {
          if (n.id === targetId) return n;
          if (n.children) {
            const found = findNode(n.children, targetId);
            if (found) return found;
          }
        }
        return null;
      }
      const node = findNode(mockBookmarks, id);
      return node ? [node] : [];
    },
    create: async ({ parentId, title, url }) => {
      const newNode = { id: 'bm_' + Date.now(), title, url, parentId };
      return newNode;
    },
    update: async (id, changes) => {
      return { id, ...changes };
    },
    remove: async (id) => true,
    removeTree: async (id) => true
  }
};

async function runIntegrationTests() {
  console.log('--- Running Mock Integration Verification ---');

  // 1. Test Stash Service init & current window stash
  await idStore.init();
  await stashService.init();

  assert.strictEqual(stashService.getFolders().length, DEFAULT_GROUP_FOLDERS.length);
  console.log('  ✓ StashService initialized with default group folders');

  const stashRes = await stashService.stashCurrentWindow(null);
  assert.strictEqual(stashRes.count, 3, 'Should stash all 3 open tabs');
  assert.strictEqual(stashService.getSessions('all').length, 1, 'Should have 1 session created');
  assert.strictEqual(stashService.getSessions('all')[0].tabs.length, 3, 'Session should contain 3 tabs');
  console.log('  ✓ stashCurrentWindow captured tabs and created session');

  // Verify dashboard tab was opened and stashed tabs closed
  assert(mockOpenTabs.some(t => t.url.includes('dashboard.html')), 'Dashboard tab should be open');
  console.log('  ✓ Dashboard tab opened in the target window');

  // 2. Test Stash Active Tab
  const newActiveTab = { id: 301, windowId: 1, active: true, title: 'Vite Guide', url: 'https://vitejs.dev' };
  mockOpenTabs.push(newActiveTab);
  const activeRes = await stashService.stashActiveTab('spf_dev');
  assert(activeRes, 'Active tab should be stashed');
  assert.strictEqual(activeRes.folderId, 'spf_dev', 'Should be placed in spf_dev folder');
  assert(!mockOpenTabs.some(t => t.id === 301), 'Original active tab should be removed');
  console.log('  ✓ stashActiveTab stashed single tab into assigned folder');

  // 3. Test Bookmark Normalizer & Mobile Bookmarks Nesting
  const normalized = await normalizer.exportNormalizedTree();
  assert(normalized.bookmarksBar.length > 0, 'Bookmarks Bar should have normalized items');
  assert(normalized.otherBookmarks.length > 0, 'Other Bookmarks should have items');

  const mobileFolder = normalized.otherBookmarks.find(i => i.isMobileFolder || i.title === 'Mobile Bookmarks');
  assert(mobileFolder, 'Mobile Bookmarks should be nested under Other Bookmarks');
  assert.strictEqual(mobileFolder.children.length, 1, 'Mobile Bookmarks should have its 1 child');
  assert.strictEqual(mobileFolder.children[0].title, 'Mobile News');
  console.log('  ✓ Mobile Bookmarks nested seamlessly under Other Bookmarks');

  // 4. Test Session Lock & Restore
  const sessions = stashService.getSessions('all');
  const sessionId = sessions[0].id;
  await stashService.toggleLockSession(sessionId);
  assert.strictEqual(stashService.getSessions('all')[0].isLocked, true, 'Session should be locked');

  // Restore locked session (should NOT delete on restore)
  await stashService.restoreSession(sessionId);
  assert.strictEqual(stashService.getSessions('all').length, 2, 'Locked session should not be deleted on restore');
  console.log('  ✓ Session locking protects tabs from accidental deletion');

  // 5. Test OneTab Export and Import roundtrip
  const exportedOneTab = OneTabImporter.exportToOneTab(stashService.getSessions('all'));
  assert(exportedOneTab.includes('https://github.com/kidding365/ExtensionBookmarks'));
  const reimported = OneTabImporter.parseOneTab(exportedOneTab, 'spf_research');
  assert.strictEqual(reimported.length, 2, 'Should reimport 2 sessions');
  console.log('  ✓ OneTab text format import & export verified');

  console.log('\nAll mock integration tests passed successfully!');
}

runIntegrationTests().catch(err => {
  console.error('Integration test failed:', err);
  process.exit(1);
});
