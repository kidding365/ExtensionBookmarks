/**
 * ExtensionBookmarks - Core Data Models and Utilities
 */

/**
 * Generate a cryptographically random, collision-resistant stable ID.
 * Prefix helps identify the entity type at a glance:
 * 'bm_' for bookmarks, 'fld_' for folders, 'spf_' for group folders, 'sps_' for tab sessions.
 */
export function generateId(prefix = 'bm') {
  const randomPart = (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID().replace(/-/g, '').slice(0, 16)
    : Math.random().toString(36).substring(2, 10) + Math.random().toString(36).substring(2, 10);
  return `${prefix}_${randomPart}`;
}

/**
 * Normalizes a URL for comparison and deduplication:
 * - Trims whitespace
 * - Converts domain to lowercase
 * - Strips common tracking query parameters (utm_*, fbclid, gclid, etc.)
 * - Strips redundant trailing slashes on root URLs
 * - Normalizes empty hash
 */
export function normalizeUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return '';
  const trimmed = rawUrl.trim();
  try {
    const parsed = new URL(trimmed);
    parsed.hostname = parsed.hostname.toLowerCase();
    
    // Remove common marketing/tracking parameters
    const trackingParams = [
      'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
      'fbclid', 'gclid', 'msclkid', 'mc_cid', 'mc_eid', '_ga'
    ];
    for (const param of trackingParams) {
      parsed.searchParams.delete(param);
    }
    
    // Normalize root path trailing slash (e.g. "https://example.com/" -> "https://example.com")
    let result = parsed.toString();
    if (parsed.pathname === '/' && !parsed.search && !parsed.hash) {
      result = result.replace(/\/$/, '');
    }
    return result;
  } catch (e) {
    return trimmed;
  }
}

/**
 * Extracts a friendly clean domain name for display.
 */
export function extractDomain(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, '');
  } catch (e) {
    return url;
  }
}

/**
 * Formats a relative timestamp (e.g. "5 minutes ago", "Yesterday at 3:15 PM").
 */
export function formatTimeAgo(timestamp) {
  if (!timestamp) return '';
  const now = Date.now();
  const diffMs = now - timestamp;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay === 1) {
    const d = new Date(timestamp);
    return `Yesterday at ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  }
  if (diffDay < 7) return `${diffDay}d ago`;

  const d = new Date(timestamp);
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * Default Extension Configuration
 */
export const DEFAULT_SETTINGS = {
  syncBookmarksBar: true,
  syncOtherBookmarks: true,
  syncStoredPages: true,
  autoSyncIntervalMinutes: 10,
  deletionThresholdSafety: 30,
  theme: 'system', // 'system' | 'dark' | 'light'
  githubToken: '',
  gistId: '',
  lastSyncTime: null,
  lastSyncStatus: 'idle', // 'idle' | 'syncing' | 'success' | 'error'
  lastSyncError: null
};

/**
 * Default Pre-installed Group Folders for Stored Pages
 */
export const DEFAULT_GROUP_FOLDERS = [
  { id: 'spf_youtube', name: 'YouTube', color: '#ef4444', createdAt: Date.now() },
  { id: 'spf_research', name: 'Research', color: '#3b82f6', createdAt: Date.now() },
  { id: 'spf_dev', name: 'Development', color: '#10b981', createdAt: Date.now() },
  { id: 'spf_reading', name: 'Reading List', color: '#8b5cf6', createdAt: Date.now() }
];
