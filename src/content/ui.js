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
    border: '1px solid #dce3ed',
    borderRadius: '12px',
    borderTop: '3px solid #2f6fb3',
    padding: '0',
    boxShadow: '0 12px 32px rgba(27, 43, 66, 0.16), 0 2px 6px rgba(27, 43, 66, 0.08)',
    width: '420px',
    maxWidth: '420px',
    maxHeight: '360px',
    overflowY: 'auto',
    fontSize: '13px',
    fontFamily: '"Hiragino Sans", "Noto Sans JP", "Yu Gothic UI", "Meiryo", sans-serif',
    color: '#223047',
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
    padding: '10px 14px',
    backgroundColor: '#f6f8fb',
    borderBottom: '1px solid #e6ebf2',
    borderRadius: '9px 9px 0 0'
  },
  title: {
    fontWeight: '700',
    fontSize: '12px',
    color: '#45546b',
    letterSpacing: '0.01em',
    textTransform: 'uppercase'
  },
  closeBtn: {
    border: 'none',
    background: 'none',
    cursor: 'pointer',
    fontSize: '18px',
    padding: '0',
    width: '28px',
    height: '28px',
    borderRadius: '6px',
    flexShrink: '0',
    color: '#7b8aa4',
    lineHeight: '1'
  },
  content: {
    margin: '0',
    whiteSpace: 'pre-wrap',
    wordBreak: 'normal',
    overflowWrap: 'anywhere',
    lineBreak: 'strict',
    padding: '16px'
  },
  normalContent: {
    color: '#1b2431',
    backgroundColor: 'transparent',
    border: 'none',
    margin: '0',
    borderRadius: '0',
    fontFamily: 'inherit'
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
    padding: '0 14px 14px',
    gap: '8px'
  },
  copyBtn: {
    padding: '7px 12px',
    minHeight: '34px',
    backgroundColor: '#eef3f9',
    border: '1px solid #d3dfec',
    borderRadius: '8px',
    cursor: 'pointer',
    color: '#365779',
    fontSize: '12px',
    fontFamily: 'inherit',
    fontWeight: '600',
    lineHeight: '1.4',
    transition: 'background-color 140ms ease'
  },
  pageControlsWrap: {
    position: 'fixed',
    right: '16px',
    bottom: '16px',
    zIndex: '100000',
    border: '1px solid #dce3ed',
    borderRadius: '12px',
    boxShadow: '0 12px 32px rgba(27, 43, 66, 0.16)',
    padding: '16px',
    width: '320px',
    maxWidth: 'calc(100vw - 32px)',
    fontFamily: '"Hiragino Sans", "Noto Sans JP", "Yu Gothic UI", "Meiryo", sans-serif',
    fontSize: '13px',
    color: '#1b2431',
    boxSizing: 'border-box',
    lineHeight: '1.65',
    overflowWrap: 'anywhere',
    maxHeight: 'calc(100vh - 32px)',
    overflowY: 'auto',
    transition: 'background-color 140ms ease, border-color 140ms ease, box-shadow 140ms ease'
  },
  pageControlsWrapRunning: {
    background: '#ffffff',
    borderColor: '#dce3ed'
  },
  pageControlsWrapWaiting: {
    background: '#fffdf8',
    borderColor: '#ead8b4'
  },
  pageControlsWrapCompleted: {
    background: '#f5fbf7',
    borderColor: '#cde8d6'
  },
  pageControlsHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '8px'
  },
  pageControlsTitle: {
    fontSize: '13px',
    letterSpacing: '0.01em',
    textTransform: 'uppercase',
    color: '#223047',
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
    marginBottom: '12px',
    whiteSpace: 'pre-line',
    textWrap: 'pretty'
  },
  pageControlsProgress: {
    fontSize: '12px',
    color: '#2d3d54',
    marginBottom: '10px'
  },
  pageControlsRow: {
    display: 'flex',
    gap: '8px',
    flexWrap: 'wrap',
    marginTop: '12px'
  },
  pageControlsContinueBtn: {
    padding: '8px 12px',
    minHeight: '34px',
    fontFamily: 'inherit',
    lineHeight: '1.4',
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
    padding: '8px 12px',
    minHeight: '34px',
    fontFamily: 'inherit',
    lineHeight: '1.4',
    borderRadius: '8px',
    border: '1px solid #d3dfec',
    background: '#f5f7fa',
    color: '#45546b',
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
    padding: '12px 14px',
    backgroundColor: '#f0f5fc',
    border: '1px solid #dce6f2',
    borderRadius: '8px',
    fontSize: '13px',
    color: '#223047',
    whiteSpace: 'pre-wrap',
    overflowWrap: 'anywhere',
    lineBreak: 'strict',
    lineHeight: '1.7'
  },
  tweetTranslationError: {
    backgroundColor: '#fff5f5',
    borderColor: '#f0d0d3',
    color: '#a52c32'
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
  applyStyles(title, { display: 'block', fontSize: '13px', fontWeight: '700', lineHeight: '1.5' });
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
    applyStyles(summary, { cursor: 'pointer', fontSize: '12px', color: '#627188', lineHeight: '1.6' });
    const body = document.createElement('div');
    body.textContent = detail;
    applyStyles(body, { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: '12px',
      lineHeight: '1.6', marginTop: '8px', maxHeight: '180px', overflowY: 'auto', color: '#627188' });
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
