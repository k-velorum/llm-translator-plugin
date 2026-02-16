import { loadSettings } from './settings.js';
import { translateText, formatErrorDetails } from './api.js';
import { appendLog, getProviderMeta } from './logging.js';

async function sendToContentScript(tabId, translatedText) {
  await chrome.tabs.sendMessage(tabId, { action: 'showTranslation', translatedText });
}

async function injectFallbackPopup(tabId, translatedText) {
  await chrome.scripting.executeScript({
    target: { tabId },
    func: (text) => {
      try {
        const old = document.querySelector('.llm-translation-popup-fallback');
        if (old && old.parentNode) old.parentNode.removeChild(old);

        const selection = window.getSelection();
        const hasRange = selection && selection.rangeCount > 0;
        const range = hasRange ? selection.getRangeAt(0) : null;
        const rect = range ? range.getBoundingClientRect() : { left: 24, bottom: 24 };

        const popup = document.createElement('div');
        popup.className = 'llm-translation-popup-fallback';
        Object.assign(popup.style, {
          position: 'absolute',
          zIndex: '2147483647',
          background: 'white',
          border: '1px solid #ccc',
          borderRadius: '6px',
          padding: '10px',
          boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
          maxWidth: '420px',
          maxHeight: '320px',
          overflowY: 'auto',
          fontSize: '14px',
          color: '#333',
          left: `${window.scrollX + (rect.left || 24)}px`,
          top: `${window.scrollY + (rect.bottom ? rect.bottom + 10 : 24)}px`
        });

        const header = document.createElement('div');
        header.textContent = 'LLM翻訳結果 (fallback)';
        Object.assign(header.style, { fontWeight: 'bold', marginBottom: '6px' });

        const body = document.createElement('div');
        Object.assign(body.style, {
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          background: '#f8f8f8',
          padding: '8px',
          borderRadius: '4px'
        });
        body.textContent = text;

        const row = document.createElement('div');
        Object.assign(row.style, { display: 'flex', gap: '8px', marginTop: '8px' });

        const copy = document.createElement('button');
        copy.textContent = 'コピー';
        Object.assign(copy.style, { cursor: 'pointer' });
        copy.onclick = async () => {
          try {
            await navigator.clipboard.writeText(text);
            copy.textContent = 'コピーしました';
            setTimeout(() => (copy.textContent = 'コピー'), 1500);
          } catch (_) {
            // no-op
          }
        };

        const close = document.createElement('button');
        close.textContent = '閉じる';
        Object.assign(close.style, { cursor: 'pointer' });
        close.onclick = () => popup.remove();

        row.appendChild(copy);
        row.appendChild(close);

        popup.appendChild(header);
        popup.appendChild(body);
        popup.appendChild(row);
        document.body.appendChild(popup);

        const onDocClick = (ev) => {
          if (!popup.contains(ev.target)) {
            popup.remove();
            document.removeEventListener('click', onDocClick, true);
          }
        };
        setTimeout(() => document.addEventListener('click', onDocClick, true), 0);
      } catch (e) {
        console.error('fallback popup injection error', e);
      }
    },
    args: [translatedText]
  });
}

async function openInNewTab(translatedText) {
  const dataUrl = 'data:text/plain;charset=utf-8,' + encodeURIComponent(translatedText);
  await chrome.tabs.create({ url: dataUrl, index: undefined, active: true });
}

export async function translateAndNotify(tabId, text) {
  const settings = await loadSettings();
  let translatedText;

  try {
    translatedText = await translateText(text, settings);
  } catch (error) {
    console.error('翻訳処理中のエラー:', error);
    await appendLog({
      level: 'error',
      type: 'translate',
      event: 'selection_failed',
      ...getProviderMeta(settings),
      tabId,
      message: error?.message || String(error)
    });
    translatedText = formatErrorDetails(error, settings);
  }

  try {
    await sendToContentScript(tabId, translatedText);
    return;
  } catch (sendMessageError) {
    console.warn('コンテンツスクリプトへの送信に失敗:', sendMessageError);
  }

  try {
    await injectFallbackPopup(tabId, translatedText);
    return;
  } catch (injectErr) {
    console.warn('fallback ポップアップ注入に失敗:', injectErr);
  }

  try {
    await openInNewTab(translatedText);
  } catch (openErr) {
    console.error('翻訳結果の表示に完全に失敗しました:', openErr);
  }
}
