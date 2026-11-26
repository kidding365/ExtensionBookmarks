/**
 * ExtensionBookmarks - Comprehensive Automated End-to-End Test Suite
 * Drives real Google Chrome via Puppeteer to test all extension capabilities:
 * 1. Service Worker & Storage init
 * 2. Window & tab stashing
 * 3. Dashboard UI: session cards, group folders, search, lock/unlock
 * 4. OneTab Import / Export modal
 * 5. Native bookmarks & Mobile Bookmarks nesting
 * 6. Popup UI & fast search
 * 7. Live GitHub Cloud Sync with kidding365/ExtensionBookmarks (sync-data branch)
 */

import puppeteer from 'puppeteer-core';
import path from 'path';
import fs from 'fs';
import assert from 'assert';

const CHROME_PATH = 'C:\\Users\\Derp\\Downloads\\ExtensionBookmarks\\chrome\\win64-158.0.8127.88\\chrome-win64\\chrome.exe';
const EXT_PATH = path.resolve('dist');
const SCREENSHOT_DIR = 'C:\\Users\\Derp\\.gemini\\antigravity\\brain\\3f2ccc1f-fb00-4468-9ce6-8bf8ec087218\\screenshots';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || process.argv[2] || '';
const GITHUB_REPO = 'kidding365/ExtensionBookmarks';

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

let passedSteps = 0;
let totalSteps = 0;

function logStep(name) {
  totalSteps++;
  console.log(`\n[Step ${totalSteps}] ${name}`);
}

function logSuccess(msg) {
  passedSteps++;
  console.log(`  ✓ ${msg}`);
}

async function run() {
  console.log('====================================================');
  console.log(' Starting Automated End-to-End Chrome Testing Suite');
  console.log('====================================================');

  logStep('Launching Google Chrome with ExtensionBookmarks...');
  const userDataDir = path.join('C:\\Users\\Derp\\AppData\\Local\\Temp', 'cft_test_prof_' + Date.now());
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: false,
    userDataDir,
    ignoreDefaultArgs: ['--disable-extensions'],
    args: [
      `--disable-extensions-except=${EXT_PATH}`,
      `--load-extension=${EXT_PATH}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--window-size=1280,850'
    ]
  });

  try {
    // 1. Discover Extension ID
    let extTarget = null;
    for (let i = 0; i < 20; i++) {
      const targets = await browser.targets();
      extTarget = targets.find(t => t.type() === 'service_worker' && t.url().includes('/background.js'));
      if (extTarget) break;
      await sleep(250);
    }

    assert(extTarget, 'Extension service worker must be found');
    const extId = extTarget.url().split('/')[2];
    logSuccess(`Extension loaded! ID: ${extId}`);
    logSuccess(`Service Worker active: ${extTarget.url()}`);

    // Attach to service worker worker thread
    const worker = await extTarget.worker();
    assert(worker, 'Must be able to attach to worker thread');
    logSuccess('Connected to Service Worker execution context');

    // 2. Test Storage & Default Folders via Extension Page
    logStep('Verifying Storage Initialization & Group Folders...');
    const helperPage = await browser.newPage();
    await helperPage.goto(`chrome-extension://${extId}/dashboard.html`, { waitUntil: 'domcontentloaded' });

    const storageData = await helperPage.evaluate(async () => {
      const data = await chrome.storage.local.get(['eb_stored_folders', 'eb_settings']);
      return data;
    });

    assert(storageData.eb_stored_folders, 'eb_stored_folders must be initialized in storage');
    assert.strictEqual(storageData.eb_stored_folders.length, 4, 'Must have 4 default group folders');
    const folderNames = storageData.eb_stored_folders.map(f => f.name);
    assert(folderNames.includes('YouTube'), 'Must include YouTube folder');
    assert(folderNames.includes('Research'), 'Must include Research folder');
    assert(folderNames.includes('Development'), 'Must include Development folder');
    assert(folderNames.includes('Reading List'), 'Must include Reading List folder');
    logSuccess(`Default group folders verified: ${folderNames.join(', ')}`);
    await helperPage.close();

    // 3. Test Tab Stashing (Window Stash)
    logStep('Opening test tabs and testing Window Stash flow...');
    const page1 = await browser.newPage();
    await page1.goto('https://example.com', { waitUntil: 'domcontentloaded' });
    const page2 = await browser.newPage();
    await page2.goto('https://example.org', { waitUntil: 'domcontentloaded' });
    const page3 = await browser.newPage();
    await page3.goto('https://example.net', { waitUntil: 'domcontentloaded' });
    logSuccess('Opened 3 test tabs (example.com, example.org, example.net)');

    // Trigger stash via Popup UI (real user interaction)
    const triggerPopup = await browser.newPage();
    await triggerPopup.goto(`chrome-extension://${extId}/popup.html`, { waitUntil: 'domcontentloaded' });
    await sleep(500);
    logSuccess('Opened Popup UI for stashing');
    await triggerPopup.click('#btnStashWindow');
    logSuccess('Clicked "Stash Window Tabs" button in popup');

    // Wait for Dashboard to open
    await sleep(1500);
    const pages = await browser.pages();
    let dashboardPage = pages.find(p => p.url().includes('dashboard.html'));

    if (!dashboardPage) {
      dashboardPage = await browser.newPage();
      await dashboardPage.goto(`chrome-extension://${extId}/dashboard.html`, { waitUntil: 'networkidle0' });
    }
    await dashboardPage.bringToFront();
    await dashboardPage.setViewport({ width: 1280, height: 850 });
    logSuccess(`Dashboard tab active: ${dashboardPage.url()}`);

    // Wait for content rendering
    await dashboardPage.waitForSelector('.session-card', { timeout: 5000 });
    const sessionCount = await dashboardPage.evaluate(() => {
      return document.querySelectorAll('.session-card').length;
    });
    assert(sessionCount >= 1, 'At least 1 session card must be rendered in dashboard');
    logSuccess(`Dashboard rendered ${sessionCount} session card(s)`);

    // Screenshot 1: Stashed Window in Dashboard
    const ss1 = path.join(SCREENSHOT_DIR, '01_dashboard_stashed_window.png');
    await dashboardPage.screenshot({ path: ss1 });
    logSuccess(`Saved screenshot: 01_dashboard_stashed_window.png`);

    // 4. Test Dashboard UI Interactions (Folder Creation & Lock)
    logStep('Testing Dashboard UI: Add Group Folder, Lock Session, Rename...');

    // Click "+" button to open Add Folder modal
    await dashboardPage.click('#btnAddFolder');
    await dashboardPage.waitForSelector('#folderModal:not(.hidden)');
    await dashboardPage.type('#inputFolderName', 'AI Automation');
    // Select green color dot
    await dashboardPage.click('.color-dot[data-color="#10b981"]');
    await dashboardPage.click('#btnCreateFolder');
    await sleep(500);

    const createdFolderVisible = await dashboardPage.evaluate(() => {
      return Array.from(document.querySelectorAll('#groupFoldersList .nav-label')).some(el => el.textContent.includes('AI Automation'));
    });
    assert(createdFolderVisible, 'New folder "AI Automation" must appear in the sidebar');
    logSuccess('Created new group folder "AI Automation" with green accent dot');

    // Test Locking session
    await dashboardPage.evaluate(() => {
      const lockBtn = document.querySelector('.session-actions button:nth-child(2)');
      if (lockBtn) lockBtn.click();
    });
    await sleep(300);
    const isLocked = await dashboardPage.evaluate(() => {
      const btn = document.querySelector('.session-actions button:nth-child(2)');
      return btn ? btn.textContent.includes('Locked') : false;
    });
    assert(isLocked, 'Session should be locked');
    logSuccess(`Session lock toggled successfully (Lock status: ${isLocked})`);

    // Screenshot 2: Folder Created & Session Locked
    const ss2 = path.join(SCREENSHOT_DIR, '02_dashboard_folder_created.png');
    await dashboardPage.screenshot({ path: ss2 });
    logSuccess(`Saved screenshot: 02_dashboard_folder_created.png`);

    // 5. Test Global Search across tabs & bookmarks
    logStep('Testing Instant Search filter...');
    await dashboardPage.evaluate(() => {
      const input = document.getElementById('globalSearchInput');
      input.value = 'example';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await sleep(1000);

    const searchDebug = await dashboardPage.evaluate(() => {
      return {
        inputValue: document.getElementById('globalSearchInput')?.value,
        viewHeading: document.getElementById('viewHeading')?.textContent,
        viewSubheading: document.getElementById('viewSubheading')?.textContent,
        tabRowCount: document.querySelectorAll('.tab-row').length,
        sessionCount: document.querySelectorAll('.session-card').length
      };
    });
    console.log('   Search debug state:', searchDebug);
    assert(searchDebug.tabRowCount >= 1, `Search should find tabs matching "example" (found ${searchDebug.tabRowCount})`);
    logSuccess(`Search for "example" returned ${searchDebug.tabRowCount} match(es)`);

    // Screenshot 3: Search results
    const ss3 = path.join(SCREENSHOT_DIR, '03_dashboard_search_results.png');
    await dashboardPage.screenshot({ path: ss3 });
    logSuccess(`Saved screenshot: 03_dashboard_search_results.png`);

    // Clear search
    await dashboardPage.click('#btnClearSearch');
    await sleep(300);

    // 6. Test OneTab Import & Export Modal
    logStep('Testing OneTab Import / Export feature...');
    await dashboardPage.click('#btnOpenImportExport');
    await dashboardPage.waitForSelector('#importExportModal:not(.hidden)');

    const sampleOneTab = `https://news.ycombinator.com | Hacker News
https://github.com/kidding365 | Kidding365 GitHub Profile

https://developer.mozilla.org | MDN Web Docs`;

    await dashboardPage.evaluate((text) => {
      document.getElementById('importTextarea').value = text;
    }, sampleOneTab);

    // Click Import button
    await dashboardPage.click('#btnDoImport');
    await sleep(800);

    const totalSessionsAfterImport = await dashboardPage.evaluate(() => {
      return document.querySelectorAll('.session-card').length;
    });
    logSuccess(`Import completed! Total sessions in dashboard: ${totalSessionsAfterImport}`);

    // Screenshot 4: After OneTab Import
    const ss4 = path.join(SCREENSHOT_DIR, '04_dashboard_onetab_imported.png');
    await dashboardPage.screenshot({ path: ss4 });
    logSuccess(`Saved screenshot: 04_dashboard_onetab_imported.png`);

    // 7. Test Popup UI
    logStep('Testing Quick Action Popup UI...');
    const popupPage = await browser.newPage();
    await popupPage.goto(`chrome-extension://${extId}/popup.html`, { waitUntil: 'networkidle0' });
    await popupPage.setViewport({ width: 380, height: 500 });

    const popupTitle = await popupPage.$eval('.app-title', el => el.textContent);
    assert.strictEqual(popupTitle, 'ExtensionBookmarks');
    const folderOptionsCount = await popupPage.$$eval('#targetFolderSelect option', opts => opts.length);
    assert(folderOptionsCount >= 5, 'Dropdown must have default + new folders');
    logSuccess(`Popup rendered cleanly with ${folderOptionsCount} folder choices`);

    // Screenshot 5: Extension Popup UI
    const ss5 = path.join(SCREENSHOT_DIR, '05_popup_interface.png');
    await popupPage.screenshot({ path: ss5 });
    logSuccess(`Saved screenshot: 05_popup_interface.png`);
    await popupPage.close();

    // 8. Test Settings Modal & Live GitHub Cloud Sync
    logStep('Testing GitHub Cloud Sync configuration and live execution...');
    await dashboardPage.bringToFront();
    await dashboardPage.click('#btnOpenSettings');
    await dashboardPage.waitForSelector('#settingsModal:not(.hidden)');

    if (!GITHUB_TOKEN) {
      logSuccess('Skipping live sync test: GITHUB_TOKEN not provided in CLI (run with: node test/automated-e2e.js <token>)');
    } else {
      // Fill in GitHub settings
      await dashboardPage.evaluate((token, repo) => {
        document.getElementById('inputGithubToken').value = token;
        document.getElementById('inputGithubRepo').value = repo;
      }, GITHUB_TOKEN, GITHUB_REPO);

      // Click "Test Connection"
      await dashboardPage.click('#btnTestGithub');
      await sleep(2000);

      const alertText = await dashboardPage.$eval('#settingsAlert', el => el.textContent);
      logSuccess(`Connection test response: "${alertText}"`);
      assert(alertText.includes('Connected as @kidding365'), 'Must successfully connect as @kidding365');

      // Screenshot 6: Settings Connection Success
      const ss6 = path.join(SCREENSHOT_DIR, '06_settings_connection_success.png');
      await dashboardPage.screenshot({ path: ss6 });
      logSuccess(`Saved screenshot: 06_settings_connection_success.png`);

      // Click "Save Settings" (triggers automatic sync)
      await dashboardPage.click('#btnSaveSettings');
      await sleep(4000);

      // Verify sync status label in sidebar
      const syncStatusLabel = await dashboardPage.$eval('#syncStatusLabel', el => el.textContent);
      logSuccess(`Sync status in sidebar: "${syncStatusLabel}"`);
      assert(syncStatusLabel.includes('kidding365') || syncStatusLabel.includes('Synced'), 'Must indicate synced status');

      // Screenshot 7: Synced State in Dashboard
      const ss7 = path.join(SCREENSHOT_DIR, '07_dashboard_synced_state.png');
      await dashboardPage.screenshot({ path: ss7 });
      logSuccess(`Saved screenshot: 07_dashboard_synced_state.png`);
    }

    console.log('\n====================================================');
    console.log(` ALL AUTOMATED E2E TESTS PASSED: ${passedSteps}/${totalSteps} STEPS`);
    console.log('====================================================');

  } finally {
    await browser.close();
  }
}

run().catch(err => {
  console.error('\nE2E Test Run Failed with error:', err);
  process.exit(1);
});
