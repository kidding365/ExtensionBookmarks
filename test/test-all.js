/**
 * ExtensionBookmarks - Comprehensive Test Suite
 */

import assert from 'assert';
import { generateId, normalizeUrl, extractDomain, formatTimeAgo, DEFAULT_GROUP_FOLDERS } from '../src/models/types.js';
import { OneTabImporter } from '../src/stash/onetab-importer.js';
import { IdStore } from '../src/sync/id-store.js';
import { DiffEngine } from '../src/sync/diff-engine.js';

console.log('--- Running ExtensionBookmarks Test Suite ---');

let passed = 0;
let failed = 0;

function it(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}:`, err.message);
    failed++;
  }
}

async function itAsync(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}:`, err.message);
    failed++;
  }
}

// 1. Models & Utilities
it('generateId produces valid prefixed IDs', () => {
  const bmId = generateId('bm');
  const fldId = generateId('fld');
  const spsId = generateId('sps');

  assert(bmId.startsWith('bm_'), 'Bookmark ID should start with bm_');
  assert(fldId.startsWith('fld_'), 'Folder ID should start with fld_');
  assert(spsId.startsWith('sps_'), 'Session ID should start with sps_');
  assert.notStrictEqual(generateId('bm'), generateId('bm'), 'Generated IDs must be unique');
});

it('normalizeUrl cleans tracking params and trailing slashes', () => {
  const dirty = 'https://Example.COM/path/?utm_source=twitter&utm_medium=social&fbclid=12345#section';
  const clean = normalizeUrl(dirty);
  assert.strictEqual(clean, 'https://example.com/path/#section');

  const rootTrailing = 'https://GitHub.com/';
  assert.strictEqual(normalizeUrl(rootTrailing), 'https://github.com');
});

it('extractDomain returns clean domain names', () => {
  assert.strictEqual(extractDomain('https://www.youtube.com/watch?v=123'), 'youtube.com');
  assert.strictEqual(extractDomain('https://docs.github.com/en/rest'), 'docs.github.com');
});

it('formatTimeAgo handles recent and older dates', () => {
  assert.strictEqual(formatTimeAgo(Date.now() - 10000), 'Just now');
  assert.strictEqual(formatTimeAgo(Date.now() - 5 * 60 * 1000), '5m ago');
  assert.strictEqual(formatTimeAgo(Date.now() - 2 * 3600 * 1000), '2h ago');
});

// 2. OneTab Importer & Exporter
it('OneTabImporter parses OneTab text with groups', () => {
  const text = `
https://youtube.com | YouTube
https://github.com | GitHub

https://news.ycombinator.com | Hacker News
https://reddit.com/r/programming | Programming Reddit
  `.trim();

  const sessions = OneTabImporter.parseOneTab(text);
  assert.strictEqual(sessions.length, 2, 'Should create 2 separate sessions separated by blank line');
  assert.strictEqual(sessions[0].tabs.length, 2, 'First session should have 2 tabs');
  assert.strictEqual(sessions[0].tabs[0].url, 'https://youtube.com');
  assert.strictEqual(sessions[0].tabs[0].title, 'YouTube');
  assert.strictEqual(sessions[1].tabs.length, 2, 'Second session should have 2 tabs');
  assert.strictEqual(sessions[1].tabs[0].domain, 'news.ycombinator.com');
});

it('OneTabImporter exports back to OneTab text format', () => {
  const sessions = [
    {
      tabs: [
        { url: 'https://react.dev', title: 'React Documentation' },
        { url: 'https://vitejs.dev', title: 'Vite' }
      ]
    },
    {
      tabs: [
        { url: 'https://google.com', title: 'Google' }
      ]
    }
  ];

  const exported = OneTabImporter.exportToOneTab(sessions);
  assert(exported.includes('https://react.dev | React Documentation'));
  assert(exported.includes('\n\nhttps://google.com | Google'));
});

// 3. IdStore & Tombstones
it('IdStore handles bidirectional mapping and tombstones', () => {
  const store = new IdStore();
  store.initialized = true;

  store.setMapping('15', 'bm_stable_123');
  assert.strictEqual(store.getStableId('15'), 'bm_stable_123');
  assert.strictEqual(store.getBrowserId('bm_stable_123'), '15');

  // Delete mapping -> adds tombstone
  store.deleteMapping('15');
  assert.strictEqual(store.getStableId('15'), null);
  assert.strictEqual(store.getBrowserId('bm_stable_123'), null);
  assert.strictEqual(store.isTombstoned('bm_stable_123'), true);

  // Merge remote tombstones
  store.mergeRemoteTombstones({ 'bm_remote_deleted': Date.now() });
  assert.strictEqual(store.isTombstoned('bm_remote_deleted'), true);
});

// 4. Diff & Tree Merging
it('DiffEngine _mergeFolderTrees combines bookmarks and prevents URL duplication', () => {
  const diffEngine = new DiffEngine();

  const local = [
    { id: 'bm_local_1', type: 'bookmark', title: 'GitHub', url: 'https://github.com/' },
    { id: 'bm_local_2', type: 'bookmark', title: 'Local Only', url: 'https://local.dev' }
  ];

  const remote = [
    { id: 'bm_remote_1', type: 'bookmark', title: 'GitHub Official', url: 'https://github.com' },
    { id: 'bm_remote_2', type: 'bookmark', title: 'Remote Only', url: 'https://remote.dev' }
  ];

  const merged = diffEngine._mergeFolderTrees(local, remote);

  // Merged tree should have 3 items total (GitHub merged, Local Only, Remote Only)
  assert.strictEqual(merged.length, 3, 'Matching URLs should merge without duplicate');

  const githubItem = merged.find(i => normalizeUrl(i.url) === 'https://github.com');
  assert(githubItem, 'GitHub item should exist in merged tree');
  assert(merged.some(i => i.title === 'Local Only'), 'Local Only should be preserved');
  assert(merged.some(i => i.title === 'Remote Only'), 'Remote Only should be preserved');
});

it('DiffEngine _mergeStoredSessions merges tab sessions correctly', () => {
  const diffEngine = new DiffEngine();

  const local = [
    { id: 'sps_1', title: 'Session 1 (Local Renamed)', createdAt: 1000, isLocked: true, tabs: [] },
    { id: 'sps_2', title: 'Session 2 Local', createdAt: 2000, isLocked: false, tabs: [] }
  ];

  const remote = [
    { id: 'sps_1', title: 'Session 1 Original', createdAt: 1000, isLocked: false, tabs: [] },
    { id: 'sps_3', title: 'Session 3 Remote', createdAt: 3000, isLocked: false, tabs: [] }
  ];

  const merged = diffEngine._mergeStoredSessions(local, remote);
  assert.strictEqual(merged.length, 3, 'Should have 3 unique sessions');

  const sps1 = merged.find(s => s.id === 'sps_1');
  assert.strictEqual(sps1.title, 'Session 1 (Local Renamed)', 'Local rename should take precedence');
  assert.strictEqual(sps1.isLocked, true, 'Locked status should be preserved');
  assert.strictEqual(merged[0].id, 'sps_3', 'Sessions should be sorted descending by createdAt');
});

console.log(`\nTests finished: ${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
