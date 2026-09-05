import { showStatus } from './status.js';
import { log } from '../shared/logger.js';

function storageLocalGet(key) {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get(key, (data) => {
        // lastErrorを読み、ログ取得失敗がChromeの未処理エラーにならないようにする。
        if (chrome.runtime.lastError) return resolve({});
        resolve(data || {});
      });
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
      const error = entry.meta?.error || entry.meta;
      const reason = error?.message && error.message !== entry.message ? `: ${error.message}` : '';
      const msg = entry.message ? ` - ${entry.message}${reason}` : '';
      const status = error?.status ? ` [HTTP ${error.status}]` : '';
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
      return `[${ts}] [${lvl}] ${entry.event || entry.type || 'log'}${meta ? ' ' + meta : ''}${detailsStr}${status}${msg}`;
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
        log.error('popup.logs', 'ログクリア失敗', { error });
        if (logStatus) showStatus(logStatus, `ログクリア失敗: ${error.message || error}`, false);
      }
    });
  }

  document.querySelectorAll('.tab[data-tab="log"]').forEach((tab) => {
    tab.addEventListener('click', () => refreshLogs({ logView }));
  });
}
