import assert from 'assert';
import { gistClient } from '../src/sync/gist-client.js';

async function run() {
  const token = process.env.GITHUB_TOKEN || process.argv[2];
  if (!token) {
    console.log('Skipping live GitHub test: GITHUB_TOKEN not set.');
    return;
  }
  const repo = process.env.GITHUB_REPO || 'kidding365/ExtensionBookmarks';

  console.log('Testing GitHub Sync Client with live API...');
  gistClient.setCredentials(token, '', repo, 'sync-data');

  // 1. Test token
  console.log('1. Testing token identity...');
  const user = await gistClient.testToken();
  console.log(`   Connected as @${user.login} (Mode: ${user.suggestedMode})`);
  assert.strictEqual(user.login, 'kidding365');

  // 2. Test reading sync data
  console.log('2. Reading sync data from branch sync-data...');
  const data = await gistClient.fetchSyncData();
  console.log('   Fetch completed. Data structure:', Object.keys(data));

  // 3. Test writing sample sync data
  console.log('3. Writing sample sync data to branch sync-data...');
  const sampleBookmarks = {
    version: 1,
    lastModified: Date.now(),
    bookmarksBar: [
      { id: 'bm_test_1', type: 'bookmark', title: 'GitHub', url: 'https://github.com' }
    ],
    otherBookmarks: [
      {
        id: 'fld_mobile_root',
        type: 'folder',
        title: 'Mobile Bookmarks',
        isMobileFolder: true,
        children: [
          { id: 'bm_test_mobile_1', type: 'bookmark', title: 'Android Chrome Test', url: 'https://google.com' }
        ]
      }
    ]
  };

  const sampleStored = {
    version: 1,
    folders: [
      { id: 'spf_youtube', name: 'YouTube', color: '#ef4444', createdAt: Date.now() }
    ],
    sessions: [
      {
        id: 'sps_live_test',
        folderId: 'spf_youtube',
        title: 'Live Test Session',
        createdAt: Date.now(),
        isLocked: false,
        tabs: [
          { id: 'tab_1', title: 'YouTube Test', url: 'https://youtube.com', domain: 'youtube.com' }
        ]
      }
    ]
  };

  await gistClient.updateSyncData({
    bookmarks: sampleBookmarks,
    storedPages: sampleStored,
    settings: { syncBookmarksBar: true, syncOtherBookmarks: true, syncStoredPages: true }
  });
  console.log('   Sync update pushed to GitHub successfully!');

  // 4. Verify round-trip read
  console.log('4. Verifying round-trip read...');
  const roundtrip = await gistClient.fetchSyncData(true);
  assert(roundtrip.bookmarks, 'Bookmarks must exist in roundtrip');
  assert.strictEqual(roundtrip.bookmarks.bookmarksBar[0].title, 'GitHub');
  assert.strictEqual(roundtrip.bookmarks.otherBookmarks[0].title, 'Mobile Bookmarks');
  assert.strictEqual(roundtrip.storedPages.sessions[0].title, 'Live Test Session');
  console.log('   Round-trip verification PASSED! Data matches perfectly.');

  console.log('\n--- All Live GitHub Sync Integration Tests PASSED! ---');
}

run().catch(err => {
  console.error('Integration test failed:', err);
  process.exit(1);
});
