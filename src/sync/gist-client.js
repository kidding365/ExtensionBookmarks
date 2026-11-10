/**
 * ExtensionBookmarks - Unified GitHub Sync Client
 * Supports BOTH:
 * 1. GitHub Repository Sync (via dedicated 'sync-data' branch) - Ideal for Fine-Grained PATs (github_pat_...)
 * 2. GitHub Gist Sync - For Classic PATs (ghp_...)
 */

const GIST_API_BASE = 'https://api.github.com/gists';
const REPO_API_BASE = 'https://api.github.com/repos';

const FILE_BOOKMARKS = 'bookmarks.json';
const FILE_STORED_PAGES = 'stored_pages.json';
const FILE_SETTINGS = 'settings.json';
const DEFAULT_BRANCH = 'sync-data';

export class GistClient {
  constructor(token = '', gistId = '', repo = '', branch = DEFAULT_BRANCH) {
    this.token = token;
    this.gistId = gistId;
    this.repo = repo;
    this.branch = branch;
    this.cachedETag = null;
    this.fileShas = new Map(); // path -> SHA (required for GitHub Contents update)
  }

  setCredentials(token, gistId, repo = '', branch = DEFAULT_BRANCH) {
    this.token = token.trim();
    this.gistId = (gistId || '').trim();
    this.repo = (repo || '').trim();
    this.branch = (branch || DEFAULT_BRANCH).trim();
    this.cachedETag = null;
  }

  get isRepoMode() {
    return this.token.startsWith('github_pat_') || (!this.gistId && !!this.repo);
  }

  _getHeaders(includeETag = false) {
    const headers = {
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    };
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }
    if (includeETag && this.cachedETag) {
      headers['If-None-Match'] = this.cachedETag;
    }
    return headers;
  }

  /**
   * Tests token validity and returns user identity + suggested mode.
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
    const isPat = this.token.startsWith('github_pat_');
    return {
      login: data.login,
      name: data.name,
      suggestedMode: isPat ? 'repo' : 'gist',
      defaultRepo: `${data.login}/ExtensionBookmarks`
    };
  }

  /**
   * Creates or ensures the sync-data branch exists in the repository.
   */
  async initRepoBranch(repoFullName = this.repo) {
    if (!repoFullName) throw new Error('Repository name (owner/repo) is required.');
    this.repo = repoFullName;

    // Check if branch already exists
    const checkRes = await fetch(`${REPO_API_BASE}/${repoFullName}/git/ref/heads/${this.branch}`, {
      headers: this._getHeaders()
    });

    if (checkRes.ok) {
      return { success: true, branch: this.branch };
    }

    // Branch doesn't exist, get default branch ref (e.g. main)
    const repoInfoRes = await fetch(`${REPO_API_BASE}/${repoFullName}`, {
      headers: this._getHeaders()
    });
    if (!repoInfoRes.ok) {
      throw new Error(`Repository ${repoFullName} not found or inaccessible.`);
    }
    const repoInfo = await repoInfoRes.json();
    const defaultBranch = repoInfo.default_branch || 'main';

    const mainRefRes = await fetch(`${REPO_API_BASE}/${repoFullName}/git/ref/heads/${defaultBranch}`, {
      headers: this._getHeaders()
    });
    if (!mainRefRes.ok) {
      throw new Error(`Default branch ${defaultBranch} not found.`);
    }
    const mainRef = await mainRefRes.json();
    const baseSha = mainRef.object.sha;

    // Create sync-data branch
    const createBranchRes = await fetch(`${REPO_API_BASE}/${repoFullName}/git/refs`, {
      method: 'POST',
      headers: {
        ...this._getHeaders(),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        ref: `refs/heads/${this.branch}`,
        sha: baseSha
      })
    });

    if (!createBranchRes.ok) {
      const err = await createBranchRes.json().catch(() => ({}));
      throw new Error(err.message || `Failed to create branch ${this.branch}`);
    }

    return { success: true, branch: this.branch };
  }

  /**
   * Creates a brand new private Gist for ExtensionBookmarks (Classic PAT mode).
   */
  async createGist(initialBookmarks, initialStoredPages, initialSettings) {
    if (!this.token) throw new Error('Personal Access Token is required.');

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
   * Fetches sync data (automatically routes between Repo mode and Gist mode).
   */
  async fetchSyncData(forceBypassCache = false) {
    if (this.isRepoMode) {
      return this._fetchRepoSyncData();
    } else {
      return this._fetchGistSyncData(forceBypassCache);
    }
  }

  async _fetchRepoSyncData() {
    if (!this.repo) throw new Error('Repository is not configured.');

    const fetchFile = async (filename) => {
      const path = `sync_store/${filename}`;
      const url = `${REPO_API_BASE}/${this.repo}/contents/${path}?ref=${this.branch}`;
      const res = await fetch(url, { headers: this._getHeaders() });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`Failed to read ${filename} (${res.status})`);

      const data = await res.json();
      this.fileShas.set(path, data.sha);

      if (data.content) {
        // Base64 decode
        const binary = atob(data.content.replace(/\s/g, ''));
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const decoded = new TextDecoder().decode(bytes);
        return JSON.parse(decoded);
      }
      return null;
    };

    const bookmarks = await fetchFile(FILE_BOOKMARKS);
    const storedPages = await fetchFile(FILE_STORED_PAGES);
    const settings = await fetchFile(FILE_SETTINGS);

    return {
      notModified: false,
      bookmarks,
      storedPages,
      settings
    };
  }

  async _fetchGistSyncData(forceBypassCache) {
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
   * Updates sync data (automatically routes between Repo mode and Gist mode).
   */
  async updateSyncData({ bookmarks, storedPages, settings }) {
    if (this.isRepoMode) {
      return this._updateRepoSyncData({ bookmarks, storedPages, settings });
    } else {
      return this._updateGistSyncData({ bookmarks, storedPages, settings });
    }
  }

  async _updateRepoSyncData({ bookmarks, storedPages, settings }) {
    if (!this.repo) throw new Error('Repository is not configured.');

    const writeFile = async (filename, contentObj) => {
      if (contentObj === undefined) return;
      const path = `sync_store/${filename}`;
      const jsonStr = JSON.stringify(contentObj, null, 2);
      const bytes = new TextEncoder().encode(jsonStr);
      let binary = '';
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      const base64 = btoa(binary);

      const body = {
        message: `Sync ${filename}`,
        content: base64,
        branch: this.branch
      };

      const existingSha = this.fileShas.get(path);
      if (existingSha) {
        body.sha = existingSha;
      }

      const res = await fetch(`${REPO_API_BASE}/${this.repo}/contents/${path}`, {
        method: 'PUT',
        headers: {
          ...this._getHeaders(),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || `Failed to update ${filename} (${res.status})`);
      }

      const data = await res.json();
      this.fileShas.set(path, data.content.sha);
    };

    if (bookmarks !== undefined) await writeFile(FILE_BOOKMARKS, bookmarks);
    if (storedPages !== undefined) await writeFile(FILE_STORED_PAGES, storedPages);
    if (settings !== undefined) await writeFile(FILE_SETTINGS, settings);

    return { success: true };
  }

  async _updateGistSyncData({ bookmarks, storedPages, settings }) {
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
