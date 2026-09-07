(() => {
  'use strict';

function getSelectionAnchorRect() {
  const selection = window.getSelection();
  if (!selection?.rangeCount) return null;
  return selection.getRangeAt(0).getBoundingClientRect();
}

let lastImageContext = null;
const MAX_MESSAGE_IMAGE_BYTES = 2 * 1024 * 1024;
const CONTENT_IMAGE_FETCH_TIMEOUT_MS = 30000;

function serializeRect(rect) {
  if (!rect) return null;
  return {
    left: rect.left,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    width: rect.width,
    height: rect.height
  };
}

function normalizeUrlForComparison(url) {
  try {
    return new URL(url, window.location.href).href;
  } catch {
    return url || '';
  }
}

function getImageElementFromNode(node) {
  if (!node) return null;
  if (node instanceof HTMLImageElement) return node;
  return node.closest?.('img') || null;
}

function rememberImageContextFromEvent(event) {
  const imageElement = getImageElementFromNode(event.target);
  if (!imageElement) return;
  const srcUrl = imageElement.currentSrc || imageElement.src;
  if (!srcUrl) return;
  lastImageContext = {
    srcUrl: normalizeUrlForComparison(srcUrl),
    rect: serializeRect(imageElement.getBoundingClientRect()),
    updatedAt: Date.now(),
    element: imageElement
  };
}

document.addEventListener('contextmenu', rememberImageContextFromEvent, true);

function findImageAnchorRect(srcUrl) {
  const normalizedSrcUrl = normalizeUrlForComparison(srcUrl);
  if (
    lastImageContext
    && lastImageContext.srcUrl === normalizedSrcUrl
    && Date.now() - lastImageContext.updatedAt < 15000
  ) {
    return lastImageContext.rect;
  }

  const imageElement = Array.from(document.images).find((img) => {
    const candidateUrl = img.currentSrc || img.src;
    return candidateUrl && normalizeUrlForComparison(candidateUrl) === normalizedSrcUrl;
  });
  return imageElement ? serializeRect(imageElement.getBoundingClientRect()) : null;
}

function findImageElement(srcUrl) {
  const normalizedSrcUrl = normalizeUrlForComparison(srcUrl);
  if (
    lastImageContext
    && lastImageContext.srcUrl === normalizedSrcUrl
    && lastImageContext.element instanceof HTMLImageElement
    && lastImageContext.element.isConnected
  ) {
    return lastImageContext.element;
  }
  return Array.from(document.images).find((img) => {
    const candidateUrl = img.currentSrc || img.src;
    return candidateUrl && normalizeUrlForComparison(candidateUrl) === normalizedSrcUrl;
  }) || null;
}

function readBlobAsDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(reader.error || new Error('blob の data URL 変換に失敗しました'));
    reader.readAsDataURL(blob);
  });
}

function inferImageMimeTypeFromUrl(url) {
  const normalizedUrl = normalizeUrlForComparison(url).toLowerCase();
  if (normalizedUrl.endsWith('.png')) return 'image/png';
  if (normalizedUrl.endsWith('.jpg') || normalizedUrl.endsWith('.jpeg')) return 'image/jpeg';
  if (normalizedUrl.endsWith('.webp')) return 'image/webp';
  if (normalizedUrl.endsWith('.gif')) return 'image/gif';
  if (normalizedUrl.endsWith('.svg')) return 'image/svg+xml';
  if (normalizedUrl.endsWith('.bmp')) return 'image/bmp';
  if (normalizedUrl.endsWith('.avif')) return 'image/avif';
  return '';
}

async function resolveImageDataUrl(srcUrl) {
  const imageElement = findImageElement(srcUrl);
  if (!imageElement) {
    throw new Error('対象画像の要素を特定できませんでした');
  }

  const targetUrl = imageElement.currentSrc || imageElement.src || srcUrl;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), CONTENT_IMAGE_FETCH_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(targetUrl, {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store',
      signal: controller.signal
    });
  } catch (error) {
    throw new Error(`画像取得に失敗しました (${error?.message || String(error)})`);
  } finally {
    clearTimeout(timeoutId);
  }
  if (!response.ok) {
    throw new Error(`画像取得に失敗しました (${response.status} ${response.statusText})`);
  }
  const blob = await response.blob();
  const mimeType = blob.type || inferImageMimeTypeFromUrl(targetUrl);
  if (!mimeType.startsWith('image/')) {
    throw new Error(`画像ではないレスポンスです: ${mimeType || 'unknown'}`);
  }
  const normalizedBlob = blob.type ? blob : new Blob([blob], { type: mimeType });
  if (normalizedBlob.size > MAX_MESSAGE_IMAGE_BYTES) {
    throw new Error(`content script フォールバック上限を超えています (${Math.ceil(normalizedBlob.size / 1024 / 1024)}MB > 2MB)`);
  }
  // runtime messaging で背景へ返すため、content 側のフォールバック経路はサイズを厳しく抑える。
  return readBlobAsDataUrl(normalizedBlob);
}

function resolvePopupAnchorRect(anchorRect) {
  if (anchorRect && Number.isFinite(anchorRect.left) && Number.isFinite(anchorRect.top)) {
    return anchorRect;
  }
  return getSelectionAnchorRect() || {
    left: 16,
    top: 16,
    right: 16,
    bottom: 16,
    width: 0,
    height: 0
  };
}

function appendSelectionNotice(popup, notice) {
  if (!notice) return;
  const note = document.createElement('div');
  note.textContent = notice;
  applyStyles(note, { fontSize: '12px', lineHeight: '1.6', color: '#627188',
    margin: '0', padding: '12px 16px 0', overflowWrap: 'anywhere', textAlign: 'left' });
  popup.appendChild(note);
}

function createSelectionPopup({
  titleText,
  bodyText,
  isError = false,
  requestId = '',
  loading = false,
  anchorRect = null,
  notice = ''
}) {
  removePopup();

  const rect = resolvePopupAnchorRect(anchorRect);

  translationPopup = document.createElement('div');
  translationPopup.className = 'llm-translation-popup';
  translationPopup.dataset.llmtUi = '';
  translationPopup.setAttribute('role', 'dialog');
  translationPopup.setAttribute('aria-label', titleText || '翻訳結果');
  translationPopup.dataset.requestId = requestId || '';
  applyStyles(translationPopup, styles.popup);

  const header = document.createElement('div');
  applyStyles(header, styles.header);

  const title = document.createElement('div');
  title.textContent = titleText;
  applyStyles(title, styles.title);

  const closeBtn = document.createElement('button');
  closeBtn.textContent = '×';
  closeBtn.type = 'button';
  closeBtn.setAttribute('aria-label', '閉じる');
  applyStyles(closeBtn, styles.closeBtn);
  closeBtn.onmouseenter = () => { closeBtn.style.color = '#55627a'; };
  closeBtn.onmouseleave = () => { closeBtn.style.color = styles.closeBtn.color; };
  closeBtn.onclick = () => removePopup();

  header.appendChild(title);
  header.appendChild(closeBtn);

  const content = document.createElement('div');
  applyStyles(content, styles.content);
  applyStyles(content, isError ? styles.errorContent : styles.normalContent);
  if (loading) {
    // streaming 初回応答が遅い provider でも進行中だと分かるよう、スピナーを並べる
    applyStyles(content, { display: 'flex', alignItems: 'center', gap: '10px' });
    const loadingLabel = document.createElement('span');
    loadingLabel.textContent = bodyText;
    content.appendChild(createLoadingSpinner());
    content.appendChild(loadingLabel);
  } else if (isError) {
    window.LLMT.ui.renderTranslationError(content, bodyText);
  } else {
    content.textContent = bodyText;
  }

  const copyBtn = document.createElement('button');
  copyBtn.textContent = isError ? 'エラー詳細をコピー' : 'コピー';
  copyBtn.type = 'button';
  applyStyles(copyBtn, styles.copyBtn);
  copyBtn.disabled = !bodyText || loading;
  copyBtn.style.opacity = copyBtn.disabled ? '0.65' : '1';
  copyBtn.onmouseenter = () => { copyBtn.style.backgroundColor = '#e1eaf5'; };
  copyBtn.onmouseleave = () => { copyBtn.style.backgroundColor = styles.copyBtn.backgroundColor; };
  copyBtn.onclick = () => {
    const text = translationPopup?.__renderedText || '';
    navigator.clipboard.writeText(text)
      .then(() => {
        const originalText = copyBtn.textContent;
        copyBtn.textContent = 'コピーしました！';
        copyBtn.style.backgroundColor = '#dcefe2';
        setTimeout(() => {
          copyBtn.textContent = originalText;
          copyBtn.style.backgroundColor = styles.copyBtn.backgroundColor;
        }, 2000);
      })
      .catch((error) => {
        console.info('クリップボードへのコピーに失敗しました:', error);
        copyBtn.textContent = 'コピーできませんでした。再試行';
      });
  };

  const actions = document.createElement('div');
  applyStyles(actions, styles.actions);
  actions.appendChild(copyBtn);

  if (isError) {
    applyStyles(translationPopup, styles.popupError);
  }

  translationPopup.__contentEl = content;
  translationPopup.__titleEl = title;
  translationPopup.__copyBtn = copyBtn;
  translationPopup.__renderedText = bodyText;

  translationPopup.appendChild(header);
  appendSelectionNotice(translationPopup, notice);
  translationPopup.appendChild(content);
  translationPopup.appendChild(actions);

  document.body.appendChild(translationPopup);
  positionPopupInViewport(translationPopup, rect);
  requestAnimationFrame(() => {
    if (!translationPopup) return;
    translationPopup.style.opacity = '1';
    translationPopup.style.transform = 'translateY(0)';
  });
  document.addEventListener('click', closePopupOnClickOutside);
  return translationPopup;
}

function prepareSelectionTranslationStream() {
  const requestId = createTranslationRequestId('selection');
  const session = registerStreamSession(requestId, {
    kind: 'selection',
    state: 'running',
    withPromise: false,
    render: (text, { isError = false, isCompleted = false } = {}) => {
      updateSelectionStreamPopup(requestId, text, { isError, isCompleted });
    }
  });

  const popup = showSelectionStreamPopup(requestId);
  if (!popup) {
    discardStreamSession(requestId);
    return '';
  }

  return session.requestId;
}

function showSelectionStreamPopup(requestId) {
  return createSelectionPopup({
    titleText: '翻訳中',
    bodyText: '翻訳しています...',
    requestId,
    loading: true
  });
}

function updateSelectionStreamPopup(requestId, text, { isError = false, isCompleted = false } = {}) {
  if (!translationPopup || translationPopup.dataset.requestId !== requestId) return;
  const content = translationPopup.__contentEl;
  const title = translationPopup.__titleEl;
  const copyBtn = translationPopup.__copyBtn;
  if (!content || !title || !copyBtn) return;

  title.textContent = isError ? '翻訳エラー' : (isCompleted ? '翻訳結果' : '翻訳中');
  translationPopup.__renderedText = text;
  // textContent 代入で loading 中のスピナーごと消えるため、flex レイアウトも通常表示へ戻す
  applyStyles(content, { display: '', alignItems: '', gap: '' });
  content.textContent = text || (isCompleted ? '' : '翻訳しています...');
  copyBtn.disabled = !text;
  copyBtn.style.opacity = copyBtn.disabled ? '0.65' : '1';

  if (isError) {
    applyStyles(translationPopup, styles.popupError);
    applyStyles(content, styles.errorContent);
    window.LLMT.ui.renderTranslationError(content, text);
    copyBtn.textContent = 'エラー詳細をコピー';
  } else {
    applyStyles(content, styles.normalContent);
    translationPopup.style.borderTop = styles.popup.borderTop;
  }
}

function removePopup({ suppressCancel = false } = {}) {
  if (!translationPopup) return;
  const requestId = translationPopup.dataset?.requestId || '';
  if (!suppressCancel && requestId && streamViewSessions.has(requestId)) {
    cancelTranslationStream(requestId);
    cancelLocalStreamSession(requestId);
  }
  document.body.removeChild(translationPopup);
  translationPopup = null;
  document.removeEventListener('click', closePopupOnClickOutside);
}

function showLoadingPopup(anchorRect = null) {
  removePopup();
  const rect = resolvePopupAnchorRect(anchorRect);

  translationPopup = document.createElement('div');
  translationPopup.className = 'llm-translation-popup';
  translationPopup.dataset.llmtUi = '';
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

  const spinner = createLoadingSpinner();

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

function showTranslationPopup(translatedText, anchorRect = null, notice = '') {
  createSelectionPopup({
    titleText: ErrorUtils.isTranslationError(translatedText) ? '翻訳エラー' : '翻訳結果',
    bodyText: translatedText,
    isError: ErrorUtils.isTranslationError(translatedText),
    anchorRect,
    notice
  });
}

function showSelectionSummary(text) {
  if (typeof text !== 'string' || !text.trim()) return;
  const anchorRect = resolvePopupAnchorRect(null);
  const popup = createSelectionPopup({ titleText: '要約中', bodyText: '要約しています...', loading: true, anchorRect });
  const content = popup.__contentEl;
  const actions = popup.lastElementChild;
  applyStyles(actions, { flexWrap: 'wrap', gap: '8px', position: 'sticky', bottom: '0', backgroundColor: '#fff' });
  content.setAttribute('aria-live', 'polite');
  let currentSummary = '';
  let busy = false;
  let lastAdjustment = 'initial';
  const buttons = [];
  const status = document.createElement('div');
  status.setAttribute('role', 'status');
  applyStyles(status, { padding: '0 16px 12px', fontSize: '12px', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' });
  popup.insertBefore(status, actions);

  function addButton(label, adjustment) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    applyStyles(button, styles.copyBtn);
    button.onclick = () => run(adjustment || lastAdjustment);
    actions.appendChild(button);
    buttons.push(button);
    return button;
  }
  addButton('短く', 'shorter');
  addButton('長く', 'longer');
  const retry = addButton('再試行');
  retry.hidden = true;

  function updateButtons() {
    buttons.forEach(button => {
      button.disabled = busy || (button !== retry && !currentSummary);
      button.style.opacity = button.disabled ? '0.5' : '1';
    });
    popup.__copyBtn.disabled = busy || !currentSummary;
    popup.__copyBtn.style.opacity = popup.__copyBtn.disabled ? '0.5' : '1';
  }

  async function run(adjustment) {
    if (busy || translationPopup !== popup) return;
    busy = true;
    lastAdjustment = adjustment;
    retry.hidden = true;
    popup.__titleEl.textContent = currentSummary ? '要約を調整中' : '要約中';
    popup.setAttribute('aria-label', popup.__titleEl.textContent);
    popup.setAttribute('aria-busy', 'true');
    status.textContent = currentSummary ? '要約を調整しています...' : '';
    updateButtons();
    const result = await window.LLMT.streaming.requestSelectionSummary({
      text, currentSummary, adjustment, popup,
      render: value => {
        if (translationPopup !== popup) return;
        applyStyles(content, { display: '', alignItems: '', gap: '' });
        content.textContent = value;
        positionPopupInViewport(popup, anchorRect);
      }
    });
    // 閉じた画面や別の選択結果を、遅れて届いた応答で上書きしない。
    if (translationPopup !== popup) return;
    busy = false;
    popup.setAttribute('aria-busy', 'false');
    applyStyles(content, { display: '', alignItems: '', gap: '' });
    if (result.ok && result.data.summary) {
      currentSummary = result.data.summary;
      popup.__renderedText = currentSummary;
      content.textContent = currentSummary;
      status.textContent = '';
      popup.__titleEl.textContent = '要約結果';
    } else {
      content.textContent = currentSummary;
      popup.__titleEl.textContent = currentSummary ? '要約結果' : '要約エラー';
      status.textContent = result.error?.message || '要約を取得できませんでした。もう一度お試しください。';
      retry.hidden = false;
    }
    popup.setAttribute('aria-label', popup.__titleEl.textContent);
    updateButtons();
    positionPopupInViewport(popup, anchorRect);
  }
  run('initial');
}

function resolveImageAnchorRect(srcUrl) {
  return findImageAnchorRect(srcUrl);
}

function closePopupOnClickOutside(event) {
  if (translationPopup && !translationPopup.contains(event.target)) {
    removePopup();
  }
}

window.LLMT = window.LLMT || {};
window.LLMT.selection = {
  getSelectionAnchorRect,
  showSelectionSummary,
  rememberImageContextFromEvent,
  resolveImageDataUrl,
  prepareSelectionTranslationStream,
  showLoadingPopup,
  showTranslationPopup,
  resolveImageAnchorRect,
  removePopup
};
Object.assign(window, window.LLMT.selection);
})();
