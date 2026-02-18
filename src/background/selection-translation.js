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
        const POPUP_MARGIN = 8;
        const POPUP_GAP = 10;
        const POPUP_MAX_WIDTH = 420;
        const clamp = (value, min, max) => {
          if (max < min) return min;
          return Math.min(Math.max(value, min), max);
        };

        const old = document.querySelector('.llm-translation-popup-fallback');
        if (old && old.parentNode) old.parentNode.removeChild(old);

        const selection = window.getSelection();
        const hasRange = selection && selection.rangeCount > 0;
        const range = hasRange ? selection.getRangeAt(0) : null;
        const rect = range ? range.getBoundingClientRect() : { left: 24, bottom: 24 };
        const isError = typeof text === 'string' && (text.includes('==== 翻訳エラー ====') || text.includes('翻訳エラー'));

        const popup = document.createElement('div');
        popup.className = 'llm-translation-popup-fallback';
        Object.assign(popup.style, {
          position: 'absolute',
          zIndex: '2147483647',
          background: '#ffffff',
          border: 'none',
          borderTop: isError ? '3px solid #c62828' : '3px solid #2f6fb3',
          borderRadius: '12px',
          padding: '0',
          boxShadow: '0 10px 30px rgba(16, 24, 40, 0.22), 0 2px 8px rgba(16, 24, 40, 0.15)',
          maxWidth: '420px',
          maxHeight: '360px',
          overflowY: 'auto',
          fontSize: '14px',
          color: '#1b2431',
          fontFamily: '"Hiragino Sans", "Noto Sans JP", "Yu Gothic UI", "Meiryo", sans-serif',
          lineHeight: '1.7',
          boxSizing: 'border-box',
          left: `${window.scrollX + POPUP_MARGIN}px`,
          top: `${window.scrollY + POPUP_MARGIN}px`,
          visibility: 'hidden',
          opacity: '0',
          transform: 'translateY(6px)',
          transition: 'opacity 140ms ease, transform 180ms ease'
        });

        const header = document.createElement('div');
        header.textContent = '翻訳結果';
        Object.assign(header.style, {
          fontWeight: '700',
          fontSize: '11px',
          color: '#5b6a82',
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          padding: '10px 14px 8px',
          backgroundColor: '#f3f6fb',
          borderBottom: '1px solid #e3e8f2',
          borderRadius: '9px 9px 0 0'
        });

        const body = document.createElement('div');
        Object.assign(body.style, {
          margin: '0',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          padding: '12px 14px',
          background: isError ? '#fff5f5' : 'transparent',
          color: isError ? '#b42318' : '#1b2431'
        });
        if (isError) {
          body.style.borderLeft = '3px solid #d92d20';
          body.style.paddingLeft = '10px';
          body.style.fontFamily = '"SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace';
          body.style.fontSize = '13px';
        }
        body.textContent = text;

        const row = document.createElement('div');
        Object.assign(row.style, { display: 'flex', gap: '8px', padding: '0 14px 12px' });

        const copy = document.createElement('button');
        copy.textContent = 'コピー';
        copy.type = 'button';
        Object.assign(copy.style, {
          cursor: 'pointer',
          padding: '6px 14px',
          backgroundColor: '#2f6fb3',
          border: 'none',
          borderRadius: '8px',
          color: '#ffffff',
          fontFamily: 'inherit',
          fontSize: '13px',
          transition: 'background-color 140ms ease'
        });
        copy.onmouseenter = () => { copy.style.backgroundColor = '#245a94'; };
        copy.onmouseleave = () => { copy.style.backgroundColor = '#2f6fb3'; };
        copy.onclick = async () => {
          try {
            await navigator.clipboard.writeText(text);
            copy.textContent = 'コピーしました';
            copy.style.backgroundColor = '#2e7d32';
            setTimeout(() => (copy.textContent = 'コピー'), 1500);
            setTimeout(() => (copy.style.backgroundColor = '#2f6fb3'), 1500);
          } catch (_) {
            // no-op
          }
        };

        const close = document.createElement('button');
        close.textContent = '閉じる';
        close.type = 'button';
        Object.assign(close.style, {
          cursor: 'pointer',
          padding: '6px 14px',
          backgroundColor: '#ffffff',
          border: '1px solid #cbd5e1',
          borderRadius: '8px',
          color: '#55627a',
          fontFamily: 'inherit',
          fontSize: '13px'
        });
        close.onmouseenter = () => { close.style.backgroundColor = '#f8fafc'; };
        close.onmouseleave = () => { close.style.backgroundColor = '#ffffff'; };
        close.onclick = () => popup.remove();

        row.appendChild(copy);
        row.appendChild(close);

        popup.appendChild(header);
        popup.appendChild(body);
        popup.appendChild(row);
        document.body.appendChild(popup);

        const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
        const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
        const maxWidth = Math.min(POPUP_MAX_WIDTH, Math.max(0, viewportWidth - (POPUP_MARGIN * 2)));
        const maxHeight = Math.max(120, viewportHeight - (POPUP_MARGIN * 2));
        popup.style.maxWidth = `${maxWidth}px`;
        popup.style.maxHeight = `${maxHeight}px`;
        popup.style.overflowY = 'auto';

        const popupRect = popup.getBoundingClientRect();
        const anchorLeft = Number.isFinite(rect.left) ? rect.left : POPUP_MARGIN;
        const anchorTop = Number.isFinite(rect.top) ? rect.top : POPUP_MARGIN;
        const anchorBottom = Number.isFinite(rect.bottom) ? rect.bottom : anchorTop;
        const preferredBelowTop = anchorBottom + POPUP_GAP;
        const preferredAboveTop = anchorTop - POPUP_GAP - popupRect.height;

        let top;
        if (preferredBelowTop + popupRect.height <= viewportHeight - POPUP_MARGIN) {
          top = preferredBelowTop;
        } else if (preferredAboveTop >= POPUP_MARGIN) {
          top = preferredAboveTop;
        } else {
          top = clamp(preferredBelowTop, POPUP_MARGIN, viewportHeight - popupRect.height - POPUP_MARGIN);
        }

        const left = clamp(anchorLeft, POPUP_MARGIN, viewportWidth - popupRect.width - POPUP_MARGIN);
        popup.style.left = `${window.scrollX + left}px`;
        popup.style.top = `${window.scrollY + top}px`;
        popup.style.visibility = 'visible';
        requestAnimationFrame(() => {
          popup.style.opacity = '1';
          popup.style.transform = 'translateY(0)';
        });

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
