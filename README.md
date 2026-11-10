# ExtensionBookmarks

Unified cross-browser bookmarks sync and OneTab-style tab manager powered by private GitHub Gist.

## 🌟 Key Features

- **3 Distinct Sync Sections with Independent Toggles**:
  - ⭐ **Bookmarks Bar**: Your native browser bookmarks toolbar.
  - 📁 **Other Bookmarks**: Reference archives (with `📱 Mobile Bookmarks` normalized neatly inside).
  - 📑 **Stored Pages (OneTab)**: High-speed tab stashing, grouping, and search.
- **Group Folders for Stored Pages**:
  - Beyond flat tab dumps, categorize your sessions into custom Group Folders (e.g., *YouTube*, *Dev*, *Research*, *Shopping*) with color tags.
- **Free, Universal Cloud Sync**:
  - Powered by a **Private GitHub Gist** (100% free, unlimited, version-controlled).
  - Operates across **Google Chrome**, **Mozilla Firefox**, **Microsoft Edge**, and **Brave**.
- **Mobile Bridgehead**:
  - Desktop Chrome routes bookmarks to/from **Android Chrome** via Google Account Sync.
  - Desktop Firefox routes bookmarks to/from **Android Firefox** via Mozilla Sync.
  - No mobile extension required!
- **Robust Sync Engine**:
  - **Stable UUIDs**: Renames and edits update in-place without deleting and re-creating.
  - **Tombstones**: Deleted bookmarks stay deleted across all devices without resurrecting.
  - **Loop / Echo Suppression**: The extension ignores its own programmatic bookmark writes.
  - **3-File Gist Partition**: `bookmarks.json`, `stored_pages.json`, and `settings.json` prevent GitHub 1MB truncation and keep updates lightning fast.
  - **Local-First & Offline**: Stashes save instantly with 0 ms latency; sync queues until online.
- **OneTab Migration**:
  - 1-click plain text import/export (`URL | Title` format) so you never lose your existing backlog.

---

## 🚀 Quick Start (Development & Installation)

### 1. Build the Extension
```bash
npm install
npm run build
```
This bundles the project into a clean, standalone `./dist/` directory.

### 2. Run the Test Suite
```bash
npm test
```

### 3. Load in Browsers

#### Google Chrome / Microsoft Edge / Brave:
1. Open `chrome://extensions` (or `edge://extensions`).
2. Toggle on **Developer mode** (top right switch).
3. Click **Load unpacked** and select the `dist` folder:
   `c:\Users\Derp\Downloads\ExtensionBookmarks\dist`

#### Mozilla Firefox:
1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on...**.
3. Select `dist/manifest.json`.

---

## ⌨️ Keyboard Shortcuts

| Shortcut | Action |
| :--- | :--- |
| `Alt + Shift + 1` | Stash all tabs in current window into Stored Pages |
| `Alt + Shift + 2` | Stash current active tab |
| `Alt + Shift + B` | Open ExtensionBookmarks Dashboard |

---

## 📖 Architecture & Design Spec
Full technical specifications and data schemas are documented in [docs/extension_architecture.md](docs/extension_architecture.md).
