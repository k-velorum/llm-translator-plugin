// 翻訳結果を表示するためのポップアップ要素
let translationPopup = null;

// プラットフォーム別機能設定（デフォルト: 有効）
let featureSettings = {
  enableTwitterTranslation: true,
  enableYoutubeTranslation: true
};
const POPUP_MARGIN = 8;
const POPUP_GAP = 10;
const POPUP_MAX_WIDTH = 420;

function loadFeatureSettings(callback) {
  try {
    chrome.storage?.sync?.get?.(null, (settings) => {
      if (!settings) return;
      if (typeof settings.enableTwitterTranslation === 'boolean') featureSettings.enableTwitterTranslation = settings.enableTwitterTranslation;
      if (typeof settings.enableYoutubeTranslation === 'boolean') featureSettings.enableYoutubeTranslation = settings.enableYoutubeTranslation;
      if (typeof callback === 'function') {
        try { callback(); } catch (_) {}
      }
    });
  } catch (_) { if (typeof callback === 'function') try { callback(); } catch(__) {} }
}

// 設定変更監視（有効化/無効化を即時反映）
try {
  chrome.storage?.onChanged?.addListener?.((changes, area) => {
    if (area !== 'sync') return;
    let twitterChanged = false, youtubeChanged = false;
    if (Object.prototype.hasOwnProperty.call(changes, 'enableTwitterTranslation')) {
      featureSettings.enableTwitterTranslation = !!changes.enableTwitterTranslation.newValue;
      twitterChanged = true;
    }
    if (Object.prototype.hasOwnProperty.call(changes, 'enableYoutubeTranslation')) {
      featureSettings.enableYoutubeTranslation = !!changes.enableYoutubeTranslation.newValue;
      youtubeChanged = true;
    }
    if (twitterChanged) {
      if (!featureSettings.enableTwitterTranslation) { try { tweetObserver?.disconnect(); } catch(_) {} tweetObserver = null; document.querySelectorAll('.llm-translate-button, .llm-tweet-translation').forEach(n => n.remove()); }
      else { addTranslateButtonToTweets(); }
    }
    if (youtubeChanged) {
      if (!featureSettings.enableYoutubeTranslation) { try { ytObserver?.disconnect(); } catch(_) {} ytObserver = null; document.querySelectorAll('.llm-yt-translate-button, .llm-yt-translation').forEach(n => n.remove()); }
      else { addTranslateButtonToYouTubeComments(); }
    }
  });
} catch (_) {}

// ページ全体翻訳のノードスナップショット（取得時と適用時の不一致を防ぐ）
let pageTranslationSnapshot = { id: 0, nodes: [] };

function ensureSelectionLoadingSpinnerStyles() {
  if (document.getElementById('llm-selection-loading-spinner-style')) return;
  const styleElement = document.createElement('style');
  styleElement.id = 'llm-selection-loading-spinner-style';
  styleElement.textContent = `
    @keyframes llmSelectionLoadingSpin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }
  `;
  document.head.appendChild(styleElement);
}

// 共通ユーティリティ関数
const DOMUtils = {
  // テキストノードを取得するTreeWalkerを作成
  createTextNodeWalker(rootNode) {
    return document.createTreeWalker(rootNode, NodeFilter.SHOW_TEXT, {
      acceptNode: node => {
        if (!node.parentNode) return NodeFilter.FILTER_REJECT;
        const tag = node.parentNode.nodeName;
        if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'IFRAME'].includes(tag)) return NodeFilter.FILTER_REJECT;
        if (!node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
  },

  // TreeWalkerを使ってテキストノードを配列で取得
  getTextNodes(rootNode) {
    const walker = this.createTextNodeWalker(rootNode);
    const nodes = [];
    let node;
    while (node = walker.nextNode()) {
      nodes.push(node);
    }
    return nodes;
  },

  // テキストノードの値のみを配列で取得
  getTextValues(rootNode) {
    return this.getTextNodes(rootNode).map(node => node.nodeValue);
  }
};

// エラー検出ユーティリティ
const ErrorUtils = {
  // 翻訳エラーかどうかを判定
  isTranslationError(text) {
    return text.includes('==== 翻訳エラー ====') || text.includes('翻訳エラー');
  }
};

function canUseExtensionRuntime() {
  try {
    return !!(chrome?.runtime?.id && chrome?.runtime?.sendMessage);
  } catch (_) {
    return false;
  }
}

function safeSendMessage(payload, callback) {
  if (!canUseExtensionRuntime()) {
    if (typeof callback === 'function') {
      try { callback({ error: { message: 'Extension context invalidated' } }); } catch (_) {}
    }
    return false;
  }
  try {
    chrome.runtime.sendMessage(payload, (response) => {
      if (chrome.runtime?.lastError) {
        const message = chrome.runtime.lastError.message || 'sendMessage failed';
        console.warn('sendMessage failed:', chrome.runtime.lastError);
        if (typeof callback === 'function') {
          callback({ error: { message } });
        }
        return;
      }
      if (typeof callback === 'function') callback(response);
    });
    return true;
  } catch (e) {
    console.warn('sendMessage failed:', e);
    if (typeof callback === 'function') {
      callback({ error: { message: e?.message || 'sendMessage failed' } });
    }
    return false;
  }
}

// スタイル定義
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
    fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace',
    fontSize: '13px',
    backgroundColor: '#fff5f5',
    color: '#b42318',
    borderLeft: '3px solid #d92d20',
    paddingLeft: '10px'
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

// スタイルをエレメントに適用する関数
function applyStyles(element, styleObj) {
  Object.keys(styleObj).forEach(key => {
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

// ポップアップを削除する関数
function removePopup() {
  if (translationPopup) {
    document.body.removeChild(translationPopup);
    translationPopup = null;
    document.removeEventListener('click', closePopupOnClickOutside);
  }
}

function showLoadingPopup() {
  removePopup();
  ensureSelectionLoadingSpinnerStyles();

  const selection = window.getSelection();
  if (!selection.rangeCount) return;

  const range = selection.getRangeAt(0);
  const rect = range.getBoundingClientRect();

  translationPopup = document.createElement('div');
  translationPopup.className = 'llm-translation-popup';
  translationPopup.setAttribute('role', 'dialog');
  translationPopup.setAttribute('aria-label', '翻訳中');
  applyStyles(translationPopup, styles.popup);

  const header = document.createElement('div');
  applyStyles(header, styles.header);

  const title = document.createElement('div');
  title.textContent = '翻訳中';
  applyStyles(title, styles.title);
  header.appendChild(title);

  const content = document.createElement('div');
  applyStyles(content, styles.content);
  applyStyles(content, styles.normalContent);
  content.style.display = 'flex';
  content.style.alignItems = 'center';
  content.style.gap = '10px';
  content.style.padding = '16px 14px';

  const spinner = document.createElement('div');
  spinner.setAttribute('aria-hidden', 'true');
  spinner.style.width = '18px';
  spinner.style.height = '18px';
  spinner.style.border = '2px solid #c8d6ea';
  spinner.style.borderTopColor = '#2f6fb3';
  spinner.style.borderRadius = '50%';
  spinner.style.animation = 'llmSelectionLoadingSpin 1s linear infinite';

  const loadingText = document.createElement('span');
  loadingText.textContent = '翻訳しています...';
  loadingText.style.color = '#4b5d78';

  content.appendChild(spinner);
  content.appendChild(loadingText);

  translationPopup.appendChild(header);
  translationPopup.appendChild(content);

  document.body.appendChild(translationPopup);
  positionPopupInViewport(translationPopup, rect);
  requestAnimationFrame(() => {
    if (!translationPopup) return;
    translationPopup.style.opacity = '1';
    translationPopup.style.transform = 'translateY(0)';
  });
  document.addEventListener('click', closePopupOnClickOutside);
}

// バックグラウンドスクリプトからのメッセージを受信
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'showLoading') {
    showLoadingPopup();
    return false;
  } else if (message.action === 'showTranslation') {
    showTranslationPopup(message.translatedText);
    // sendResponse を呼ばないので false (または undefined) を返す
    return false;
  } else if (message.action === 'getSelectedText') {
    // 選択されたテキストを取得してバックグラウンドスクリプトに返す
    const selectedText = window.getSelection().toString().trim();
    sendResponse({ selectedText: selectedText });
    // sendResponse を非同期で呼ぶ可能性があるので true を返す
    return true;
  } else if (message.action === 'getPageTexts') {
    // ページ内のテキストノードを取得してバックグラウンドに返す
    const nodes = DOMUtils.getTextNodes(document.body);
    const texts = nodes.map(n => n.nodeValue);
    // スナップショットを更新（連番IDで整合性確認）
    pageTranslationSnapshot = {
      id: (pageTranslationSnapshot.id || 0) + 1,
      nodes
    };
    sendResponse({ texts, snapshotId: pageTranslationSnapshot.id });
    return true;
  } else if (message.action === 'applyPageTranslation') {
    // バックグラウンドから受け取った翻訳結果をページ内のテキストノードに適用
    const translations = message.translations;
    const { snapshotId } = message;
    let targetNodes = [];

    // 取得時と同じ順序・同じノード集合を可能な限り用いる
    if (snapshotId && snapshotId === pageTranslationSnapshot.id && Array.isArray(pageTranslationSnapshot.nodes) && pageTranslationSnapshot.nodes.length) {
      targetNodes = pageTranslationSnapshot.nodes;
    } else {
      // フォールバック: 再トラバース（動的ページで多少のズレが出る可能性あり）
      console.warn('applyPageTranslation: snapshotId が一致しないため再トラバースで適用します。');
      targetNodes = DOMUtils.getTextNodes(document.body);
    }

    const len = Math.min(targetNodes.length, translations.length);
    for (let i = 0; i < len; i++) {
      if (translations[i] !== undefined && targetNodes[i] && targetNodes[i].nodeValue !== undefined) {
        targetNodes[i].nodeValue = translations[i];
      }
    }
    return;
  } else if (message.action === 'applyPageTranslationChunk') {
    // 逐次的に小チャンクでの訳文適用（設計見直しに合わせたモード）
    const { snapshotId, offset = 0, translations = [] } = message;

    if (!snapshotId || snapshotId !== pageTranslationSnapshot.id) {
      console.warn('applyPageTranslationChunk: snapshotId 不一致のため適用をスキップします。');
      return;
    }

    const nodes = pageTranslationSnapshot.nodes || [];
    const end = Math.min(nodes.length, offset + translations.length);
    for (let i = offset, j = 0; i < end; i++, j++) {
      if (nodes[i] && nodes[i].nodeValue !== undefined && translations[j] !== undefined) {
        nodes[i].nodeValue = translations[j];
      }
    }
    return;
  } else if (message.action === 'showPageTranslationControls') {
    const { snapshotId, remainingChunks, processedItems, totalItems, totalChunks, canContinue } = message;
    showPageTranslationControls(snapshotId, remainingChunks, processedItems, totalItems, totalChunks, canContinue);
    return false;
  } else if (message.action === 'hidePageTranslationControls') {
    hidePageTranslationControls();
    return false;
  }
  // 他のメッセージタイプは処理しないので false を返す
  return false;
});

// 翻訳結果ポップアップの表示
function showTranslationPopup(translatedText) {
  // 既存のポップアップがあれば削除
  removePopup();

  // 選択範囲の位置を取得
  const selection = window.getSelection();
  if (!selection.rangeCount) return;
  
  const range = selection.getRangeAt(0);
  const rect = range.getBoundingClientRect();
  
  // ポップアップ要素の作成
  translationPopup = document.createElement('div');
  translationPopup.className = 'llm-translation-popup';
  translationPopup.setAttribute('role', 'dialog');
  translationPopup.setAttribute('aria-label', '翻訳結果');
  applyStyles(translationPopup, styles.popup);
  
  // ヘッダー部分
  const header = document.createElement('div');
  applyStyles(header, styles.header);
  
  const title = document.createElement('div');
  title.textContent = '翻訳結果';
  applyStyles(title, styles.title);
  
  const closeBtn = document.createElement('button');
  closeBtn.textContent = '×';
  closeBtn.type = 'button';
  closeBtn.setAttribute('aria-label', '閉じる');
  applyStyles(closeBtn, styles.closeBtn);
  closeBtn.onmouseenter = () => { closeBtn.style.color = '#55627a'; };
  closeBtn.onmouseleave = () => { closeBtn.style.color = styles.closeBtn.color; };
  closeBtn.onclick = removePopup;
  
  header.appendChild(title);
  header.appendChild(closeBtn);
  
  // 翻訳テキスト部分
  const content = document.createElement('div');
  applyStyles(content, styles.content);
  
  // エラーメッセージかどうかをチェック
  const isError = ErrorUtils.isTranslationError(translatedText);
  
  if (isError) {
    applyStyles(translationPopup, styles.popupError);
    applyStyles(content, styles.errorContent);
  } else {
    applyStyles(content, styles.normalContent);
  }
  
  content.textContent = translatedText;
  
  // コピーボタン
  const copyBtn = document.createElement('button');
  copyBtn.textContent = 'コピー';
  copyBtn.type = 'button';
  applyStyles(copyBtn, styles.copyBtn);
  copyBtn.onmouseenter = () => { copyBtn.style.backgroundColor = '#245a94'; };
  copyBtn.onmouseleave = () => { copyBtn.style.backgroundColor = styles.copyBtn.backgroundColor; };
  copyBtn.onclick = () => {
    navigator.clipboard.writeText(translatedText)
      .then(() => {
        const originalText = copyBtn.textContent;
        copyBtn.textContent = 'コピーしました！';
        copyBtn.style.backgroundColor = '#2e7d32';
        setTimeout(() => {
          copyBtn.textContent = originalText;
          copyBtn.style.backgroundColor = styles.copyBtn.backgroundColor;
        }, 2000);
      })
      .catch(err => {
        console.error('クリップボードへのコピーに失敗しました:', err);
      });
  };

  const actions = document.createElement('div');
  applyStyles(actions, styles.actions);
  actions.appendChild(copyBtn);

  // 要素の追加
  translationPopup.appendChild(header);
  translationPopup.appendChild(content);
  translationPopup.appendChild(actions);
  
  document.body.appendChild(translationPopup);
  positionPopupInViewport(translationPopup, rect);
  requestAnimationFrame(() => {
    if (!translationPopup) return;
    translationPopup.style.opacity = '1';
    translationPopup.style.transform = 'translateY(0)';
  });
  
  // クリック以外の場所をクリックしたらポップアップを閉じる
  document.addEventListener('click', closePopupOnClickOutside);
}

// ポップアップ外のクリックでポップアップを閉じる
function closePopupOnClickOutside(event) {
  if (translationPopup && !translationPopup.contains(event.target)) {
    removePopup();
  }
}

// 逐次翻訳の「続きを実行」UI
let pageTranslationControls = null;
let pageTranslationControlsSnapshotId = null;
// プラットフォーム監視インスタンス（無効化時の停止用）
let tweetObserver = null;
let ytObserver = null;

function getPageTranslationControlState(canContinue, remainingChunks) {
  if (remainingChunks === 0) return 'completed';
  if (!canContinue) return 'running';
  return 'waiting';
}

function renderPageTranslationStatus(statusElement, state) {
  if (!statusElement) return;
  statusElement.textContent = '';
  applyStyles(statusElement, styles.pageControlsStatus);

  if (state === 'running') {
    const spinner = document.createElement('span');
    spinner.setAttribute('aria-hidden', 'true');
    spinner.style.width = '10px';
    spinner.style.height = '10px';
    spinner.style.border = '2px solid rgba(31, 91, 149, 0.3)';
    spinner.style.borderTopColor = '#1f5b95';
    spinner.style.borderRadius = '50%';
    spinner.style.animation = 'llmSelectionLoadingSpin 0.9s linear infinite';
    spinner.style.marginRight = '6px';

    const label = document.createElement('span');
    label.textContent = '実行中';

    statusElement.appendChild(spinner);
    statusElement.appendChild(label);
    applyStyles(statusElement, styles.pageControlsStatusRunning);
    return;
  }

  if (state === 'completed') {
    statusElement.textContent = '完了';
    applyStyles(statusElement, styles.pageControlsStatusCompleted);
    return;
  }

  statusElement.textContent = '待機中';
  applyStyles(statusElement, styles.pageControlsStatusWaiting);
}

function showPageTranslationControls(snapshotId, remainingChunks, processedItems = 0, totalItems = 0, totalChunks = 0, canContinue = true) {
  ensureSelectionLoadingSpinnerStyles();

  // 既存を更新/再作成
  pageTranslationControlsSnapshotId = snapshotId;
  if (!pageTranslationControls) {
    const wrap = document.createElement('div');
    wrap.id = 'llm-page-translation-controls';
    applyStyles(wrap, styles.pageControlsWrap);

    const header = document.createElement('div');
    applyStyles(header, styles.pageControlsHeader);

    const title = document.createElement('div');
    title.textContent = 'ページ翻訳';
    applyStyles(title, styles.pageControlsTitle);

    const status = document.createElement('div');
    status.id = 'llm-page-translation-status';
    applyStyles(status, styles.pageControlsStatus);

    header.appendChild(title);
    header.appendChild(status);

    const info = document.createElement('div');
    info.id = 'llm-page-translation-info';
    applyStyles(info, styles.pageControlsInfo);

    const progress = document.createElement('div');
    progress.id = 'llm-page-translation-progress';
    applyStyles(progress, styles.pageControlsProgress);

    const row = document.createElement('div');
    applyStyles(row, styles.pageControlsRow);

    const btn = document.createElement('button');
    btn.id = 'llm-page-translation-continue';
    btn.textContent = '続きを実行';
    btn.type = 'button';
    applyStyles(btn, styles.pageControlsContinueBtn);
    btn.onclick = async () => {
      const originalText = btn.textContent;
      btn.disabled = true;
      btn.textContent = '実行中…';
      try {
        await new Promise((resolve, reject) => {
          // background がハングしてもUIが永遠に戻らないのを防ぐ
          const t = setTimeout(() => reject(new Error('continuePageTranslation timeout')), 200000);
          const sent = safeSendMessage({ action: 'continuePageTranslation', snapshotId }, (res) => {
            clearTimeout(t);
            if (res?.error) return reject(new Error(res.error.message || res.error || 'unknown error'));
            if (!res || res.ok !== true) return reject(new Error(res?.error || 'unknown error'));
            resolve();
          });
          if (!sent) {
            clearTimeout(t);
            return reject(new Error('Extension context invalidated'));
          }
        });
      } catch (e) {
        console.error('continuePageTranslation 送信失敗:', e);
        btn.disabled = false;
        btn.textContent = originalText;
      }
    };

    const stopBtn = document.createElement('button');
    stopBtn.id = 'llm-page-translation-stop';
    stopBtn.textContent = '停止';
    stopBtn.type = 'button';
    applyStyles(stopBtn, styles.pageControlsStopBtn);
    stopBtn.onclick = async () => {
      stopBtn.disabled = true;
      try {
        await new Promise((resolve, reject) => {
          const sent = safeSendMessage({ action: 'cancelPageTranslation', snapshotId }, (res) => {
            if (res?.error) return reject(new Error(res.error.message || res.error || 'unknown error'));
            resolve();
          });
          if (!sent) return reject(new Error('Extension context invalidated'));
        });
      } catch (e) {
        console.error('cancelPageTranslation 送信失敗:', e);
      } finally {
        stopBtn.disabled = false;
      }
    };

    row.appendChild(btn);
    row.appendChild(stopBtn);

    wrap.appendChild(header);
    wrap.appendChild(info);
    wrap.appendChild(progress);
    wrap.appendChild(row);
    document.body.appendChild(wrap);
    pageTranslationControls = wrap;
  }

  // 更新
  const info = pageTranslationControls.querySelector('#llm-page-translation-info');
  const progress = pageTranslationControls.querySelector('#llm-page-translation-progress');
  const status = pageTranslationControls.querySelector('#llm-page-translation-status');
  const continueBtn = pageTranslationControls.querySelector('#llm-page-translation-continue');
  const stopBtn = pageTranslationControls.querySelector('#llm-page-translation-stop');
  const percent = totalItems > 0 ? Math.floor((processedItems / totalItems) * 100) : 0;

  const state = getPageTranslationControlState(canContinue, remainingChunks);
  applyStyles(pageTranslationControls, styles.pageControlsWrap);
  if (state === 'running') applyStyles(pageTranslationControls, styles.pageControlsWrapRunning);
  if (state === 'waiting') applyStyles(pageTranslationControls, styles.pageControlsWrapWaiting);
  if (state === 'completed') applyStyles(pageTranslationControls, styles.pageControlsWrapCompleted);

  if (status) {
    renderPageTranslationStatus(status, state);
  }

  if (info) {
    info.textContent = totalChunks > 0
      ? `残り: ${remainingChunks}/${totalChunks} チャンク`
      : `残り: ${remainingChunks} チャンク`;
  }
  if (progress) {
    progress.textContent = totalItems > 0
      ? `進捗: ${percent}% (${processedItems}/${totalItems}項目)`
      : `進捗: ${percent}%`;
  }
  if (continueBtn) {
    const isCompleted = remainingChunks === 0;
    continueBtn.disabled = isCompleted || !canContinue;
    continueBtn.textContent = isCompleted ? '完了' : '続きを実行';
    applyStyles(continueBtn, styles.pageControlsContinueBtn);
    if (continueBtn.disabled) applyStyles(continueBtn, styles.pageControlsContinueBtnDisabled);
  }
  if (stopBtn) {
    stopBtn.disabled = remainingChunks === 0;
    applyStyles(stopBtn, styles.pageControlsStopBtn);
    if (stopBtn.disabled) applyStyles(stopBtn, styles.pageControlsStopBtnDisabled);
  }
}

function hidePageTranslationControls() {
  if (pageTranslationControls && pageTranslationControls.parentNode) {
    pageTranslationControls.parentNode.removeChild(pageTranslationControls);
  }
  pageTranslationControls = null;
  pageTranslationControlsSnapshotId = null;
}

// Twitter（x.com）のツイート翻訳機能
// ツイートに翻訳ボタンを追加する関数
function addTranslateButtonToTweets() {
  // Twitterのドメインかどうかをチェック
  if (!window.location.hostname.includes('twitter.com') && !window.location.hostname.includes('x.com')) {
    return;
  }
  // 機能が無効ならスキップ
  if (!featureSettings.enableTwitterTranslation) return;

  console.log('Twitter/X.comページを検出しました。翻訳ボタンを追加します。');

  // ツイート要素を見つけるためのセレクタ
  const tweetSelector = 'article[data-testid="tweet"]';

  // 既存のツイートに翻訳ボタンを追加
  document.querySelectorAll(tweetSelector).forEach(addButtonToTweet);

  // MutationObserverを使用して新しく追加されるツイートを監視
  if (tweetObserver) return;
  tweetObserver = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (mutation.addedNodes && mutation.addedNodes.length > 0) {
        mutation.addedNodes.forEach((node) => {
          // 追加されたノードがエレメントの場合
          if (node.nodeType === Node.ELEMENT_NODE) {
            // ノード自体がツイートかチェック
            if (node.matches && node.matches(tweetSelector)) {
              addButtonToTweet(node);
            }
            // ノードの子要素にツイートがあるかチェック
            const tweets = node.querySelectorAll(tweetSelector);
            tweets.forEach(addButtonToTweet);
          }
        });
      }
    });
  });

  // body全体を監視
  tweetObserver.observe(document.body, {
    childList: true,
    subtree: true
  });

  console.log('ツイート監視を開始しました');
}

// 個々のツイートに翻訳ボタンを追加する関数
function addButtonToTweet(tweetElement) {
  // 既にボタンが追加されているかチェック
  if (tweetElement.querySelector('.llm-translate-button')) {
    return;
  }

  // ツイートのテキスト部分を取得
  const tweetTextElement = tweetElement.querySelector('[data-testid="tweetText"]');
  if (!tweetTextElement) {
    return; // テキストがないツイート（画像のみなど）はスキップ
  }

  // ツイートのアクションバーを取得（リツイート、いいねなどのボタンがある部分）
  const actionBar = tweetElement.querySelector('[role="group"]');
  if (!actionBar) {
    return;
  }

  // スピナーのスタイルを定義
  const spinnerStyle = `
    @keyframes rotate {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }
    .spinner {
      animation: rotate 1.5s linear infinite;
      display: none;
    }
  `;
  
  // スタイル要素を作成して追加（まだ追加されていない場合のみ）
  if (!document.querySelector('#llm-translator-styles')) {
    const styleElement = document.createElement('style');
    styleElement.id = 'llm-translator-styles';
    styleElement.textContent = spinnerStyle;
    document.head.appendChild(styleElement);
  }

  // 翻訳ボタンを作成
  const translateButton = document.createElement('div');
  translateButton.className = 'llm-translate-button';
  translateButton.style.display = 'flex';
  translateButton.style.alignItems = 'center';
  translateButton.style.cursor = 'pointer';
  translateButton.style.color = 'rgb(83, 100, 113)';
  translateButton.style.padding = '0 12px';
  translateButton.style.fontSize = '13px';
  translateButton.setAttribute('role', 'button');
  translateButton.setAttribute('aria-label', '日本語翻訳');
  
  // 通常アイコン（「あ」の文字を使用した独自デザイン）とローディングスピナーを含むHTML
  translateButton.innerHTML = `
    <div style="display: flex; align-items: center;">
      <svg class="translate-icon" viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
        <path d="M 3,6 A 5,5 0 0 1 8,1 L 16,1 A 5,5 0 0 1 21,6 L 21,14 A 5,5 0 0 1 16,19 L 14,19 L 12,23 L 10,19 L 8,19 A 5,5 0 0 1 3,14 Z" fill="#f8f8f8" stroke="#555" stroke-width="1"/>
        <text x="12" y="13.5" text-anchor="middle" font-family="sans-serif" font-size="10" font-weight="bold" fill="#555">JP</text>
      </svg>
      <svg class="spinner" viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
        <path d="M12,4V2A10,10 0 0,0 2,12H4A8,8 0 0,1 12,4Z"/>
      </svg>
    </div>
  `;

  // 翻訳アイコンとスピナーの要素を取得
  const translateIcon = translateButton.querySelector('.translate-icon');
  const spinner = translateButton.querySelector('.spinner');

  // 翻訳ボタンのクリックイベント
  translateButton.addEventListener('click', () => {
    // ツイート本文と引用ツイートのテキスト要素を取得
    const tweetTextElements = tweetElement.querySelectorAll('[data-testid="tweetText"]');
    // 既に翻訳結果が表示されている場合は削除
    const anyExisting = Array.from(tweetTextElements).some(el => {
      const next = el.nextSibling;
      return next && next.classList && next.classList.contains('llm-tweet-translation');
    });
    if (anyExisting) {
      tweetTextElements.forEach(el => {
        const next = el.nextSibling;
        if (next && next.classList && next.classList.contains('llm-tweet-translation')) {
          next.remove();
        }
      });
      translateButton.style.color = 'rgb(83, 100, 113)';
      return;
    }
    // ローディング状態を表示
    translateButton.style.color = '#1DA1F2';
    translateIcon.style.display = 'none';
    spinner.style.display = 'block';
    // 翻訳リクエストを一括送信
    let pending = tweetTextElements.length;
    tweetTextElements.forEach(el => {
      const text = el.textContent;
      safeSendMessage({ action: 'translateTweet', text }, (response) => {
        const err = response?.error;
        const message = err?.message || (typeof err === 'string' ? err : null);
        const translatedText = message
          ? `翻訳エラー: ${message}`
          : (response?.translatedText ?? '翻訳エラー: 拡張機能との通信に失敗しました');
        showTweetTranslation(tweetElement, el, translatedText);
        pending -= 1;
        if (pending === 0) {
          translateButton.style.color = 'rgb(83, 100, 113)';
          translateIcon.style.display = 'block';
          spinner.style.display = 'none';
        }
      });
    });
  });

  // アクションバーに翻訳ボタンを追加
  actionBar.appendChild(translateButton);
}

// ツイートの下に翻訳結果を表示する関数
function showTweetTranslation(tweetElement, tweetTextElement, translatedText) {
  // 既にこのツイートの翻訳結果が表示されている場合は削除
  const next = tweetTextElement.nextSibling;
  if (next && next.classList && next.classList.contains('llm-tweet-translation')) {
    next.remove();
  }

  // 翻訳結果の要素を作成
  const translationElement = document.createElement('div');
  translationElement.className = 'llm-tweet-translation';
  applyStyles(translationElement, styles.tweetTranslation);

  // エラーメッセージかどうかをチェック
  if (ErrorUtils.isTranslationError(translatedText)) {
    applyStyles(translationElement, styles.tweetTranslationError);
  }

  translationElement.textContent = translatedText;

  // ツイートのテキスト要素の後に翻訳結果を挿入
  tweetTextElement.parentNode.insertBefore(translationElement, tweetTextElement.nextSibling);
}

// ページ読み込み完了時に実行
document.addEventListener('DOMContentLoaded', () => {
  loadFeatureSettings(() => {
    addTranslateButtonToTweets();
    addTranslateButtonToYouTubeComments();
  });
});

// すでにDOMが読み込まれている場合のために即時実行も行う
if (document.readyState === 'interactive' || document.readyState === 'complete') {
  loadFeatureSettings(() => {
    addTranslateButtonToTweets();
    addTranslateButtonToYouTubeComments();
  });
}

// =============================
// YouTube コメント翻訳ボタン
// =============================

function addTranslateButtonToYouTubeComments() {
  if (!/\.youtube\.com$/.test(window.location.hostname)) return;
  // 機能が無効ならスキップ
  if (!featureSettings.enableYoutubeTranslation) return;

  const commentTextSelector = 'ytd-comment-view-model #content-text, ytd-comment-renderer #content-text';

  // スタイル（スピナー）を一度だけ追加
  const spinnerStyle = `
    @keyframes rotate { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
    .spinner { animation: rotate 1.5s linear infinite; display: none; }
  `;
  if (!document.querySelector('#llm-translator-styles')) {
    const styleElement = document.createElement('style');
    styleElement.id = 'llm-translator-styles';
    styleElement.textContent = spinnerStyle;
    document.head.appendChild(styleElement);
  }
  // YouTubeのコメント折りたたみによる高さ制限を回避するためのスタイル（1回だけ追加）
  if (!document.querySelector('#llm-yt-translation-styles')) {
    const styleElement = document.createElement('style');
    styleElement.id = 'llm-yt-translation-styles';
    styleElement.textContent = `
      /* 翻訳枠は高さ制限なしで表示 */
      .llm-yt-translation { max-height: none !important; overflow: visible !important; display: block; white-space: pre-wrap; }
    `;
    document.head.appendChild(styleElement);
  }

  // 既存コメントにボタンを付与
  document.querySelectorAll(commentTextSelector).forEach(addButtonToYouTubeComment);

  // 動的に追加されるコメントも監視
  if (ytObserver) return;
  ytObserver = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of m.addedNodes || []) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        if (node.matches && node.matches(commentTextSelector)) {
          addButtonToYouTubeComment(node);
        } else {
          const targets = node.querySelectorAll?.(commentTextSelector);
          targets && targets.forEach(addButtonToYouTubeComment);
        }
      }
    }
  });
  ytObserver.observe(document.body, { childList: true, subtree: true });
}

function addButtonToYouTubeComment(contentTextEl) {
  // 二重追加防止
  if (!contentTextEl || contentTextEl.parentElement?.querySelector('.llm-yt-translate-button')) return;

  // ボタン要素（Twitterと同じアイコンを使用）
  const btn = document.createElement('div');
  btn.className = 'llm-yt-translate-button';
  btn.style.display = 'inline-flex';
  btn.style.alignItems = 'center';
  btn.style.cursor = 'pointer';
  btn.style.color = 'rgb(83, 100, 113)';
  btn.style.paddingLeft = '6px';
  btn.style.userSelect = 'none';
  btn.style.verticalAlign = 'middle';
  btn.setAttribute('role', 'button');
  btn.setAttribute('aria-label', '日本語翻訳');
  btn.innerHTML = `
    <svg class="translate-icon" viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
      <path d="M 3,6 A 5,5 0 0 1 8,1 L 16,1 A 5,5 0 0 1 21,6 L 21,14 A 5,5 0 0 1 16,19 L 14,19 L 12,23 L 10,19 L 8,19 A 5,5 0 0 1 3,14 Z" fill="#f8f8f8" stroke="#555" stroke-width="1"/>
      <text x="12" y="13.5" text-anchor="middle" font-family="sans-serif" font-size="9" font-weight="bold" fill="#555">JP</text>
    </svg>
    <svg class="spinner" viewBox="0 0 24 24" width="16" height="16" fill="currentColor" style="margin-left:4px;">
      <path d="M12,4V2A10,10 0 0,0 2,12H4A8,8 0 0,1 12,4Z"/>
    </svg>
  `;

  const translateIcon = btn.querySelector('.translate-icon');
  const spinner = btn.querySelector('.spinner');

  // 挿入位置: コメント本文直後（ボタンはアイコンのみ）
  contentTextEl.insertAdjacentElement('afterend', btn);

  btn.addEventListener('click', () => {
    // コメント全体を囲う最上位のコメント要素を基準にトグル判定する
    const container = contentTextEl.closest('ytd-comment-view-model, ytd-comment-renderer') || contentTextEl.parentElement;
    const existing = container?.querySelector('.llm-yt-translation');
    if (existing) {
      existing.remove();
      // トグル解除: ボタンの見た目を初期化
      btn.style.color = 'rgb(83, 100, 113)';
      translateIcon.style.display = 'inline-block';
      spinner.style.display = 'none';
      return;
    }

    // ローディング表示
    btn.style.color = '#1DA1F2';
    translateIcon.style.display = 'none';
    spinner.style.display = 'inline-block';

    const text = contentTextEl.textContent || '';
    safeSendMessage({ action: 'translateTweet', text }, (response) => {
      const err = response?.error;
      const message = err?.message || (typeof err === 'string' ? err : null);
      const translatedText = message
        ? `翻訳エラー: ${message}`
        : (response?.translatedText ?? '翻訳エラー: 拡張機能との通信に失敗しました');
      showYouTubeCommentTranslation(contentTextEl, translatedText);
      btn.style.color = 'rgb(83, 100, 113)';
      translateIcon.style.display = 'inline-block';
      spinner.style.display = 'none';
    });
  });
}

function showYouTubeCommentTranslation(contentTextEl, translatedText) {
  // 既存を削除してから表示（コメント単位で1つだけ）
  const container = contentTextEl.closest('ytd-comment-view-model, ytd-comment-renderer') || contentTextEl.parentElement || contentTextEl;
  const prev = container.querySelector('.llm-yt-translation');
  if (prev) prev.remove();

  const wrap = document.createElement('div');
  wrap.className = 'llm-yt-translation';
  wrap.style.marginTop = '6px';
  wrap.style.padding = '8px 10px';
  wrap.style.background = '#f2f5f9';
  wrap.style.borderRadius = '8px';
  wrap.style.fontSize = '13px';
  wrap.style.color = '#0f0f0f';
  wrap.style.whiteSpace = 'pre-wrap';
  wrap.style.wordBreak = 'break-word';
  // 高さ制限をかけない
  wrap.style.maxHeight = 'none';
  wrap.style.overflow = 'visible';

  const isErr = ErrorUtils.isTranslationError(translatedText);
  if (isErr) {
    wrap.style.background = '#fff0f0';
    wrap.style.color = '#b00020';
    wrap.style.fontFamily = 'monospace';
  }

  wrap.textContent = translatedText;

  // YouTubeのコメント本文はytd-expander配下で折りたたまれていることがあるので、
  // その直後（expanderの外側）に挿入して高さ制限の影響を受けないようにする。
  const expander = contentTextEl.closest('ytd-expander');
  if (expander && expander.parentElement) {
    expander.insertAdjacentElement('afterend', wrap);
  } else {
    // フォールバック: 元要素の直後
    contentTextEl.insertAdjacentElement('afterend', wrap);
  }
}

// (重複していたYouTubeの即時実行は、全体の初期化に統合済み)
