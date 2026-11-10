/**
 * ExtensionBookmarks - OneTab Importer & Backup Utility
 * Compatible with OneTab plain-text export format: "URL | Title"
 */

import { generateId, normalizeUrl } from '../models/types.js';

export class OneTabImporter {
  /**
   * Parses OneTab plain text export.
   * Blank lines separate different tab batches / sessions.
   * Format per line: "URL | Title" or just "URL"
   */
  static parseOneTab(text, defaultFolderId = null) {
    if (!text || typeof text !== 'string') return [];

    const lines = text.split(/\r?\n/);
    const sessions = [];
    let currentTabs = [];

    const finalizeSession = () => {
      if (currentTabs.length === 0) return;
      const count = currentTabs.length;
      const firstDomain = currentTabs[0].domain || 'Web';
      const sessionTitle = `${firstDomain} & ${count - 1} more tabs`;

      sessions.push({
        id: generateId('sps'),
        folderId: defaultFolderId,
        title: count === 1 ? currentTabs[0].title : sessionTitle,
        createdAt: Date.now() - sessions.length * 1000, // stagger timestamps
        isLocked: false,
        tabs: currentTabs
      });
      currentTabs = [];
    };

    for (const rawLine of lines) {
      const line = rawLine.trim();

      if (!line) {
        finalizeSession();
        continue;
      }

      // Check for URL | Title
      const pipeIndex = line.indexOf('|');
      let url = '';
      let title = '';

      if (pipeIndex !== -1) {
        url = line.substring(0, pipeIndex).trim();
        title = line.substring(pipeIndex + 1).trim();
      } else {
        // Space separated fallback or bare URL
        const parts = line.split(/\s+/);
        if (parts[0].startsWith('http://') || parts[0].startsWith('https://')) {
          url = parts[0];
          title = parts.slice(1).join(' ').trim();
        } else {
          url = line;
          title = line;
        }
      }

      if (url.startsWith('http://') || url.startsWith('https://')) {
        let domain = '';
        try {
          domain = new URL(url).hostname.replace(/^www\./, '');
        } catch (e) {
          domain = '';
        }

        currentTabs.push({
          id: generateId('tab'),
          url: url,
          title: title || domain || url,
          domain: domain,
          faviconUrl: `https://www.google.com/s2/favicons?sz=32&domain=${domain}`
        });
      }
    }

    finalizeSession();
    return sessions;
  }

  /**
   * Generates OneTab-compatible plain text export.
   */
  static exportToOneTab(sessions) {
    const blocks = [];
    for (const session of sessions) {
      const lines = [];
      for (const tab of session.tabs || []) {
        lines.push(`${tab.url} | ${tab.title}`);
      }
      if (lines.length > 0) {
        blocks.push(lines.join('\n'));
      }
    }
    return blocks.join('\n\n');
  }

  /**
   * Exports full JSON backup.
   */
  static exportFullBackup(payload) {
    return JSON.stringify(payload, null, 2);
  }

  /**
   * Imports full JSON backup.
   */
  static parseFullBackup(jsonString) {
    try {
      const data = JSON.parse(jsonString);
      return { success: true, data };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }
}
