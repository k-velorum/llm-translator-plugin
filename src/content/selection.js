function getSelectionAnchorRect() {
  const selection = window.getSelection();
  if (!selection?.rangeCount) return null;
  return selection.getRangeAt(0).getBoundingClientRect();
}

function createSelectionPopup({
  titleText,
  bodyText,
  isError = false,
  requestId = '',
  loading = false
}) {
  removePopup();

  const rect = getSelectionAnchorRect();
  if (!rect) return null;

  translationPopup = document.createElement('div');
  translationPopup.className = 'llm-translation-popup';
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
  content.textContent = bodyText;

  const copyBtn = document.createElement('button');
  copyBtn.textContent = 'コピー';
  copyBtn.type = 'button';
  applyStyles(copyBtn, styles.copyBtn);
  copyBtn.disabled = !bodyText || loading;
  copyBtn.style.opacity = copyBtn.disabled ? '0.65' : '1';
  copyBtn.onmouseenter = () => { copyBtn.style.backgroundColor = '#245a94'; };
  copyBtn.onmouseleave = () => { copyBtn.style.backgroundColor = styles.copyBtn.backgroundColor; };
  copyBtn.onclick = () => {
    const text = translationPopup?.__renderedText || '';
    navigator.clipboard.writeText(text)
      .then(() => {
        const originalText = copyBtn.textContent;
        copyBtn.textContent = 'コピーしました！';
        copyBtn.style.backgroundColor = '#2e7d32';
        setTimeout(() => {
          copyBtn.textContent = originalText;
          copyBtn.style.backgroundColor = styles.copyBtn.backgroundColor;
        }, 2000);
      })
      .catch((error) => {
        console.error('クリップボードへのコピーに失敗しました:', error);
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
  content.textContent = text || (isCompleted ? '' : '翻訳しています...');
  copyBtn.disabled = !text;
  copyBtn.style.opacity = copyBtn.disabled ? '0.65' : '1';

  if (isError) {
    applyStyles(translationPopup, styles.popupError);
    applyStyles(content, styles.errorContent);
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

function showLoadingPopup() {
  removePopup();
  ensureSelectionLoadingSpinnerStyles();

  const selection = window.getSelection();
  if (!selection.rangeCount) return;

  const rect = selection.getRangeAt(0).getBoundingClientRect();

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

function showTranslationPopup(translatedText) {
  createSelectionPopup({
    titleText: '翻訳結果',
    bodyText: translatedText,
    isError: ErrorUtils.isTranslationError(translatedText)
  });
}

function closePopupOnClickOutside(event) {
  if (translationPopup && !translationPopup.contains(event.target)) {
    removePopup();
  }
}
