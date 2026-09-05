(() => {
  'use strict';

let translationPopup = null;

const POPUP_MARGIN = 8;
const POPUP_GAP = 10;
const POPUP_MAX_WIDTH = 420;
const SHARED_SPINNER_STYLE_ID = 'llm-translator-styles';

// 拡張がページへ注入する UI のルートセレクタ。ページ翻訳のスナップショットに
// これらが混入すると、再実行時に拡張自身のラベル（「ページ翻訳」「停止」等）が
// 翻訳・上書きされてパネルが破壊されるため、キャプチャ時に除外する。
const EXTENSION_UI_SELECTOR = '[data-llmt-ui]';

// ページの CSP で <style> 注入が拒否されるサイトでも回転するよう、
// CSS keyframes ではなく Web Animations API でアニメーションさせる
function createLoadingSpinner({
  size = 18,
  borderWidth = 2,
  trackColor = '#c8d6ea',
  color = '#2f6fb3',
  durationMs = 1000
} = {}) {
  const spinner = document.createElement('span');
  spinner.setAttribute('aria-hidden', 'true');
  Object.assign(spinner.style, {
    display: 'inline-block',
    flex: 'none',
    width: `${size}px`,
    height: `${size}px`,
    border: `${borderWidth}px solid ${trackColor}`,
    borderTopColor: color,
    borderRadius: '50%',
    boxSizing: 'border-box'
  });
  spinner.animate(
    [{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }],
    { duration: durationMs, iterations: Infinity }
  );
  return spinner;
}

function ensureEmbeddedTranslationSpinnerStyles() {
  if (document.getElementById(SHARED_SPINNER_STYLE_ID)) return;
  const styleElement = document.createElement('style');
  styleElement.id = SHARED_SPINNER_STYLE_ID;
  styleElement.textContent = `
    @keyframes rotate {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }
    .spinner {
      animation: rotate 1.5s linear infinite;
      display: none;
    }
  `;
  document.head.appendChild(styleElement);
}

// 共通ユーティリティ関数
const DOMUtils = {
  createTextNodeWalker(rootNode, { excludeExtensionUi = false } = {}) {
    return document.createTreeWalker(rootNode, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => {
        if (!node.parentNode) return NodeFilter.FILTER_REJECT;
        const tag = node.parentNode.nodeName;
        if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'IFRAME'].includes(tag)) return NodeFilter.FILTER_REJECT;
        if (!node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        if (excludeExtensionUi && node.parentElement?.closest(EXTENSION_UI_SELECTOR)) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    });
  },

  getTextNodes(rootNode, options) {
    const walker = this.createTextNodeWalker(rootNode, options);
    const nodes = [];
    let node;
    while (node = walker.nextNode()) {
      nodes.push(node);
    }
    return nodes;
  },

  getTextValues(rootNode) {
    return this.getTextNodes(rootNode).map((node) => node.nodeValue);
  }
};

const ErrorUtils = {
  isTranslationError(text) {
    return text.includes('==== 翻訳エラー ====') || text.includes('翻訳エラー');
  }
};

const styles = {
  popup: {
    position: 'absolute',
    zIndex: '10000',
    backgroundColor: '#ffffff',
    border: 'none',
    borderRadius: '12px',
    borderTop: '3px solid #2f6fb3',
    padding: '0',
    boxShadow: '0 10px 30px rgba(16, 24, 40, 0.22), 0 2px 8px rgba(16, 24, 40, 0.15)',
    maxWidth: '420px',
    maxHeight: '360px',
    overflowY: 'auto',
    fontSize: '14px',
    fontFamily: '"Hiragino Sans", "Noto Sans JP", "Yu Gothic UI", "Meiryo", sans-serif',
    color: '#1b2431',
    boxSizing: 'border-box',
    lineHeight: '1.7',
    opacity: '0',
    transform: 'translateY(6px)',
    transition: 'opacity 140ms ease, transform 180ms ease'
  },
  popupError: {
    borderTop: '3px solid #c62828'
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '10px 14px 8px',
    backgroundColor: '#f3f6fb',
    borderBottom: '1px solid #e3e8f2',
    borderRadius: '9px 9px 0 0'
  },
  title: {
    fontWeight: '700',
    fontSize: '11px',
    color: '#5b6a82',
    letterSpacing: '0.08em',
    textTransform: 'uppercase'
  },
  closeBtn: {
    border: 'none',
    background: 'none',
    cursor: 'pointer',
    fontSize: '18px',
    padding: '0 2px',
    color: '#7b8aa4',
    lineHeight: '1'
  },
  content: {
    margin: '0',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    padding: '12px 14px'
  },
  normalContent: {
    color: '#1b2431',
    backgroundColor: 'transparent'
  },
  errorContent: {
    fontFamily: 'inherit',
    fontSize: '13px',
    backgroundColor: '#fff5f5',
    color: '#b42318',
    border: '1px solid #f3d1d1',
    borderRadius: '8px',
    margin: '12px 14px',
    padding: '12px'
  },
  actions: {
    display: 'flex',
    justifyContent: 'flex-start',
    padding: '0 14px 12px'
  },
  copyBtn: {
    padding: '6px 14px',
    backgroundColor: '#2f6fb3',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    color: '#ffffff',
    fontSize: '13px',
    fontFamily: 'inherit',
    transition: 'background-color 140ms ease'
  },
  pageControlsWrap: {
    position: 'fixed',
    right: '16px',
    bottom: '16px',
    zIndex: '100000',
    border: '2px solid #ff9800',
    borderRadius: '12px',
    boxShadow: '0 14px 30px rgba(16, 24, 40, 0.22), 0 3px 10px rgba(16, 24, 40, 0.15)',
    padding: '12px 12px 10px',
    minWidth: '260px',
    maxWidth: '340px',
    fontFamily: '"Hiragino Sans", "Noto Sans JP", "Yu Gothic UI", "Meiryo", sans-serif',
    fontSize: '13px',
    color: '#1b2431',
    boxSizing: 'border-box',
    lineHeight: '1.45',
    backdropFilter: 'blur(8px)',
    transition: 'background-color 140ms ease, border-color 140ms ease, box-shadow 140ms ease'
  },
  pageControlsWrapRunning: {
    background: '#e9f4ff',
    borderColor: '#2f6fb3'
  },
  pageControlsWrapWaiting: {
    background: '#fff4e8',
    borderColor: '#f08a24'
  },
  pageControlsWrapCompleted: {
    background: '#ebf8ef',
    borderColor: '#2e7d32'
  },
  pageControlsHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '8px'
  },
  pageControlsTitle: {
    fontSize: '11px',
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    color: '#55627a',
    fontWeight: '700'
  },
  pageControlsStatus: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '999px',
    padding: '2px 8px',
    fontSize: '11px',
    fontWeight: '700'
  },
  pageControlsStatusRunning: {
    background: '#d6ebff',
    color: '#1f5b95'
  },
  pageControlsStatusWaiting: {
    background: '#ffe7cc',
    color: '#8b4a12'
  },
  pageControlsStatusCompleted: {
    background: '#d7f0df',
    color: '#22662b'
  },
  pageControlsInfo: {
    fontSize: '12px',
    color: '#2d3d54',
    marginBottom: '4px'
  },
  pageControlsProgress: {
    fontSize: '12px',
    color: '#2d3d54',
    marginBottom: '10px'
  },
  pageControlsRow: {
    display: 'flex',
    gap: '8px'
  },
  pageControlsContinueBtn: {
    padding: '6px 11px',
    borderRadius: '8px',
    border: '1px solid #2f6fb3',
    background: '#2f6fb3',
    color: '#ffffff',
    fontSize: '12px',
    fontWeight: '700',
    cursor: 'pointer',
    transition: 'opacity 120ms ease, background-color 120ms ease'
  },
  pageControlsContinueBtnDisabled: {
    opacity: '0.6',
    cursor: 'default'
  },
  pageControlsStopBtn: {
    padding: '6px 11px',
    borderRadius: '8px',
    border: '1px solid #b42318',
    background: '#fff1f1',
    color: '#b42318',
    fontSize: '12px',
    fontWeight: '700',
    cursor: 'pointer',
    transition: 'opacity 120ms ease'
  },
  pageControlsStopBtnDisabled: {
    opacity: '0.6',
    cursor: 'default'
  },
  tweetTranslation: {
    marginTop: '8px',
    padding: '8px 12px',
    backgroundColor: '#46627e',
    borderRadius: '8px',
    fontSize: '14px',
    color: '#FFF',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    lineHeight: '1.4'
  },
  tweetTranslationError: {
    backgroundColor: '#fff0f0',
    color: '#d32f2f'
  }
};

function applyStyles(element, styleObj) {
  Object.keys(styleObj).forEach((key) => {
    element.style[key] = styleObj[key];
  });
}

function clamp(value, min, max) {
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}

function positionPopupInViewport(popup, anchorRect) {
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
  const maxWidth = Math.min(POPUP_MAX_WIDTH, Math.max(0, viewportWidth - (POPUP_MARGIN * 2)));
  const maxHeight = Math.max(120, viewportHeight - (POPUP_MARGIN * 2));

  popup.style.maxWidth = `${maxWidth}px`;
  popup.style.maxHeight = `${maxHeight}px`;
  popup.style.overflowY = 'auto';
  popup.style.visibility = 'hidden';

  const popupRect = popup.getBoundingClientRect();
  const anchorLeft = Number.isFinite(anchorRect?.left) ? anchorRect.left : POPUP_MARGIN;
  const anchorTop = Number.isFinite(anchorRect?.top) ? anchorRect.top : POPUP_MARGIN;
  const anchorBottom = Number.isFinite(anchorRect?.bottom) ? anchorRect.bottom : anchorTop;
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
}

function applyTranslationTextState(element, text, isError, normalStyle = {}, errorStyle = {}) {
  if (!element) return;
  applyStyles(element, normalStyle);
  if (isError) {
    applyStyles(element, errorStyle);
    renderTranslationError(element, text);
    return;
  }
  element.removeAttribute('role');
  element.textContent = text;
}

// 通常表示は復旧案内に絞り、API本文やスタックは必要時だけ開けるようにする。
// 非ストリーミング経路も使うため、既存のエラー文字列をここで表示用に分ける。
function renderTranslationError(element, text) {
  const detail = String(text || '').replace(/^翻訳エラー:\s*/, '').trim();
  const guidance = detail.split('\n').find((line) =>
    !/^API Error:|^\s*at\s/.test(line) && /確認してください|再読み込み|再試行|短くしてください|小さくしてください/.test(line)
  ) || '翻訳を完了できませんでした。拡張の設定と接続先を確認してください。';
  element.textContent = '';
  element.setAttribute('role', 'alert');
  element.style.fontFamily = 'inherit';
  const title = document.createElement('strong');
  title.textContent = '翻訳できませんでした';
  title.style.display = 'block';
  const description = document.createElement('div');
  description.textContent = guidance;
  applyStyles(description, {
    marginTop: '6px',
    color: '#4b3540',
    whiteSpace: 'normal',
    lineHeight: '1.65',
    textWrap: 'pretty',
    lineBreak: 'strict'
  });
  element.append(title, description);

  if (/再読み込み/.test(guidance)) {
    const reload = document.createElement('button');
    reload.type = 'button';
    reload.textContent = 'ページを再読み込み';
    applyStyles(reload, { ...styles.copyBtn, marginTop: '8px' });
    reload.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      window.location.reload();
    });
    element.append(reload);
  }
  if (detail && detail !== guidance) {
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = 'エラーの詳細';
    summary.style.cursor = 'pointer';
    const body = document.createElement('div');
    body.textContent = detail;
    body.style.whiteSpace = 'pre-wrap';
    details.style.marginTop = '8px';
    details.append(summary, body);
    element.append(details);
  }
}

function extractTranslatedTextFromResponse(response) {
  const err = response?.error;
  const message = err?.message || (typeof err === 'string' ? err : null);
  return message
    ? `翻訳エラー: ${message}`
    : (response?.translatedText ?? '翻訳エラー: 拡張機能との通信に失敗しました');
}

window.LLMT = window.LLMT || {};
window.LLMT.ui = {
  createLoadingSpinner,
  ensureEmbeddedTranslationSpinnerStyles,
  DOMUtils,
  ErrorUtils,
  styles,
  applyStyles,
  positionPopupInViewport,
  applyTranslationTextState,
  renderTranslationError,
  extractTranslatedTextFromResponse
};
Object.assign(window, {
  translationPopup,
  createLoadingSpinner,
  ensureEmbeddedTranslationSpinnerStyles,
  DOMUtils,
  ErrorUtils,
  styles,
  applyStyles,
  positionPopupInViewport,
  applyTranslationTextState,
  renderTranslationError,
  extractTranslatedTextFromResponse
});
})();
