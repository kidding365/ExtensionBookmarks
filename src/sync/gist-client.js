/**
 * ExtensionBookmarks - GitHub Gist API Client
 * Securely reads and writes the 3 partitioned sync files with ETag caching and truncation handling.
 */

const GIST_API_BASE = 'https://api.github.com/gists';
const FILE_BOOKMARKS = 'bookmarks.json';
const FILE_STORED_PAGES = 'stored_pages.json';
const FILE_SETTINGS = 'settings.json';

export class GistClient {
  constructor(token = '', gistId = '') {
    this.token = token;
    this.gistId = gistId;
    this.cachedETag = null;
  }

  setCredentials(token, gistId) {
    this.token = token;
    this.gistId = gistId;
    this.cachedETag = null;
  }

  _getHeaders(includeETag = false) {
    const headers = {
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    };
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token.trim()}`;
    }
    if (includeETag && this.cachedETag) {
      headers['If-None-Match'] = this.cachedETag;
    }
    return headers;
  }

  /**
   * Tests token validity and returns user identity.
   */
  async testToken() {
    if (!this.token) throw new Error('Personal Access Token is missing.');
    const res = await fetch('https://api.github.com/user', {
      headers: this._getHeaders()
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || `GitHub Auth failed (${res.status})`);
    }
    const data = await res.json();
    return { login: data.login, name: data.name };
  }

  /**
   * Creates a brand new private Gist for ExtensionBookmarks.
   */
  async createGist(initialBookmarks, initialStoredPages, initialSettings) {
    if (!this.token) throw new Error('Personal Access Token is required to create a Gist.');

    const payload = {
      description: 'ExtensionBookmarks Sync Store (Automated private backup)',
      public: false,
      files: {
        [FILE_BOOKMARKS]: {
          content: JSON.stringify(initialBookmarks || { bookmarksBar: [], otherBookmarks: [] }, null, 2)
        },
        [FILE_STORED_PAGES]: {
          content: JSON.stringify(initialStoredPages || { folders: [], sessions: [] }, null, 2)
        },
        [FILE_SETTINGS]: {
          content: JSON.stringify(initialSettings || {}, null, 2)
        }
      }
    };

    const res = await fetch(GIST_API_BASE, {
      method: 'POST',
      headers: {
        ...this._getHeaders(),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || `Failed to create Gist (${res.status})`);
    }

    const data = await res.json();
    this.gistId = data.id;
    this.cachedETag = res.headers.get('ETag');
    return { gistId: data.id, htmlUrl: data.html_url };
  }

  /**
   * Fetches the sync files from the Gist.
   * Returns { notModified: true } if ETag matches.
   */
  async fetchSyncData(forceBypassCache = false) {
    if (!this.gistId) throw new Error('Gist ID is not configured.');

    const res = await fetch(`${GIST_API_BASE}/${this.gistId}`, {
      headers: this._getHeaders(!forceBypassCache)
    });

    if (res.status === 304) {
      return { notModified: true };
    }

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || `Failed to read Gist (${res.status})`);
    }

    this.cachedETag = res.headers.get('ETag');
    const gist = await res.json();
    const files = gist.files || {};

    // Helper to get content, falling back to raw_url if GitHub truncated > 1MB
    const getFileContent = async (fileObj) => {
      if (!fileObj) return null;
      if (fileObj.truncated && fileObj.raw_url) {
        const rawRes = await fetch(fileObj.raw_url);
        if (rawRes.ok) return await rawRes.json();
      }
      if (fileObj.content) {
        try {
          return JSON.parse(fileObj.content);
        } catch (e) {
          console.error('[GistClient] JSON parse error:', e);
          return null;
        }
      }
      return null;
    };

    const bookmarks = await getFileContent(files[FILE_BOOKMARKS]);
    const storedPages = await getFileContent(files[FILE_STORED_PAGES]);
    const settings = await getFileContent(files[FILE_SETTINGS]);

    return {
      notModified: false,
      updatedAt: gist.updated_at,
      bookmarks,
      storedPages,
      settings
    };
  }

  /**
   * Updates only the modified files in the Gist.
   */
  async updateSyncData({ bookmarks, storedPages, settings }) {
    if (!this.gistId) throw new Error('Gist ID is not configured.');

    const filesPayload = {};

    if (bookmarks !== undefined) {
      filesPayload[FILE_BOOKMARKS] = {
        content: JSON.stringify(bookmarks, null, 2)
      };
    }
    if (storedPages !== undefined) {
      filesPayload[FILE_STORED_PAGES] = {
        content: JSON.stringify(storedPages, null, 2)
      };
    }
    if (settings !== undefined) {
      filesPayload[FILE_SETTINGS] = {
        content: JSON.stringify(settings, null, 2)
      };
    }

    const res = await fetch(`${GIST_API_BASE}/${this.gistId}`, {
      method: 'PATCH',
      headers: {
        ...this._getHeaders(),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ files: filesPayload })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || `Failed to update Gist (${res.status})`);
    }

    this.cachedETag = res.headers.get('ETag');
    return { success: true };
  }
}

export const gistClient = new GistClient();
