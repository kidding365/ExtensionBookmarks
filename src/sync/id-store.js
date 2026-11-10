/**
 * ExtensionBookmarks - Persistent Alphanumeric ID & Tombstone Store
 * Maps browser-specific local bookmark IDs to globally unique stable IDs (UUIDs).
 */

const STORAGE_KEY_MAP = 'eb_id_map';
const STORAGE_KEY_TOMBSTONES = 'eb_tombstones';
const TOMBSTONE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export class IdStore {
  constructor() {
    this.browserToStable = new Map();
    this.stableToBrowser = new Map();
    this.tombstones = new Map(); // stableId -> deletedTimestamp
    this.initialized = false;
  }

  async init() {
    if (this.initialized) return;
    try {
      const data = await chrome.storage.local.get([STORAGE_KEY_MAP, STORAGE_KEY_TOMBSTONES]);
      
      const storedMap = data[STORAGE_KEY_MAP] || {};
      for (const [browserId, stableId] of Object.entries(storedMap)) {
        this.browserToStable.set(String(browserId), stableId);
        this.stableToBrowser.set(stableId, String(browserId));
      }

      const storedTombstones = data[STORAGE_KEY_TOMBSTONES] || {};
      const now = Date.now();
      for (const [stableId, ts] of Object.entries(storedTombstones)) {
        if (now - ts < TOMBSTONE_MAX_AGE_MS) {
          this.tombstones.set(stableId, ts);
        }
      }
      this.initialized = true;
    } catch (e) {
      console.error('[IdStore] Init failed:', e);
      this.initialized = true;
    }
  }

  async save() {
    const mapObj = {};
    for (const [browserId, stableId] of this.browserToStable.entries()) {
      mapObj[browserId] = stableId;
    }

    const tombObj = {};
    for (const [stableId, ts] of this.tombstones.entries()) {
      tombObj[stableId] = ts;
    }

    await chrome.storage.local.set({
      [STORAGE_KEY_MAP]: mapObj,
      [STORAGE_KEY_TOMBSTONES]: tombObj
    });
  }

  getStableId(browserId) {
    return this.browserToStable.get(String(browserId)) || null;
  }

  getBrowserId(stableId) {
    return this.stableToBrowser.get(stableId) || null;
  }

  setMapping(browserId, stableId) {
    const bId = String(browserId);
    this.browserToStable.set(bId, stableId);
    this.stableToBrowser.set(stableId, bId);
    // If it was in tombstones, remove it (it is alive again)
    this.tombstones.delete(stableId);
  }

  deleteMapping(browserId) {
    const bId = String(browserId);
    const stableId = this.browserToStable.get(bId);
    if (stableId) {
      this.stableToBrowser.delete(stableId);
      this.browserToStable.delete(bId);
      this.addTombstone(stableId);
    }
  }

  addTombstone(stableId) {
    this.tombstones.set(stableId, Date.now());
  }

  isTombstoned(stableId) {
    return this.tombstones.has(stableId);
  }

  getTombstonesObject() {
    const obj = {};
    for (const [id, ts] of this.tombstones.entries()) {
      obj[id] = ts;
    }
    return obj;
  }

  mergeRemoteTombstones(remoteTombstones) {
    if (!remoteTombstones) return;
    const now = Date.now();
    for (const [id, ts] of Object.entries(remoteTombstones)) {
      if (now - ts < TOMBSTONE_MAX_AGE_MS) {
        const localTs = this.tombstones.get(id) || 0;
        if (ts > localTs) {
          this.tombstones.set(id, ts);
        }
      }
    }
  }
}

export const idStore = new IdStore();
