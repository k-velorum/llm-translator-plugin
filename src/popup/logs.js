import { showStatus } from './status.js';

function storageLocalGet(key) {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get(key, (data) => resolve(data || {}));
    } catch {
      resolve({});
    }
  });
}

function storageLocalSet(obj) {
  return new Promise((resolve, reject) => {
    try {
      chrome.storage.local.set(obj, () => {
        if (chrome.runtime.lastError) return reject(chrome.runtime.lastError);
        resolve();
      });
    } catch (error) {
      reject(error);
    }
  });
}

export async function refreshLogs({ logView }) {
  if (!logView) return;
  const key = 'pageTranslationLogs';
  const data = await storageLocalGet(key);
  const arr = Array.isArray(data[key]) ? data[key] : [];

  if (!arr.length) {
    logView.textContent = 'ログはまだありません。';
    return;
  }

  const lines = arr
    .slice()
    .reverse()
    .map((entry) => {
      const ts = new Date(entry.ts || Date.now()).toLocaleString();
      const lvl = (entry.level || 'info').toUpperCase();
      const meta = [entry.provider, entry.model].filter(Boolean).join(' ');
      const msg = entry.message ? ` - ${entry.message}` : '';
      const details = [];
      if (typeof entry.chunkIndex === 'number') details.push(`chunk=${entry.chunkIndex}`);
      if (typeof entry.items === 'number') details.push(`items=${entry.items}`);
      if (typeof entry.len === 'number') details.push(`len=${entry.len}`);
      if (typeof entry.ms === 'number') details.push(`ms=${entry.ms}`);
      if (typeof entry.timeoutMs === 'number') details.push(`timeoutMs=${entry.timeoutMs}`);
      if (typeof entry.processedItems === 'number' && typeof entry.totalItems === 'number') {
        details.push(`progress=${entry.processedItems}/${entry.totalItems}`);
      }
      const detailsStr = details.length ? ` (${details.join(', ')})` : '';
      return `[${ts}] [${lvl}] ${entry.event || entry.type || 'log'}${meta ? ' ' + meta : ''}${detailsStr}${msg}`;
    });

  logView.textContent = lines.join('\n');
}

export function bindLogHandlers({ logClearButton, logStatus, logView }) {
  if (logClearButton) {
    logClearButton.addEventListener('click', async () => {
      try {
        await storageLocalSet({ pageTranslationLogs: [] });
        if (logView) logView.textContent = 'ログをクリアしました。';
        if (logStatus) showStatus(logStatus, 'ログをクリアしました', true);
      } catch (error) {
        console.error('ログクリア失敗:', error);
        if (logStatus) showStatus(logStatus, `ログクリア失敗: ${error.message || error}`, false);
      }
    });
  }

  document.querySelectorAll('.tab[data-tab="log"]').forEach((tab) => {
    tab.addEventListener('click', () => refreshLogs({ logView }));
  });
}
