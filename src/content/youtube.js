(() => {
  'use strict';

function ensureYouTubeTranslationStyles() {
  if (document.querySelector('#llm-yt-translation-styles')) return;
  const styleElement = document.createElement('style');
  styleElement.id = 'llm-yt-translation-styles';
  styleElement.textContent = `
    .llm-yt-translation { max-height: none !important; overflow: visible !important; display: block; white-space: pre-wrap; }
  `;
  document.head.appendChild(styleElement);
}

function ensureYouTubeTranslationElement(contentTextEl) {
  const container = contentTextEl.closest('ytd-comment-view-model, ytd-comment-renderer') || contentTextEl.parentElement || contentTextEl;
  const prev = container.querySelector('.llm-yt-translation');
  if (prev) return prev;

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
  wrap.style.maxHeight = 'none';
  wrap.style.overflow = 'visible';

  const expander = contentTextEl.closest('ytd-expander');
  if (expander && expander.parentElement) {
    expander.insertAdjacentElement('afterend', wrap);
  } else {
    contentTextEl.insertAdjacentElement('afterend', wrap);
  }
  return wrap;
}

function renderYouTubeTranslationElement(element, translatedText, isError) {
  element.style.background = isError ? '#fff0f0' : '#f2f5f9';
  element.style.color = isError ? '#b00020' : '#0f0f0f';
  element.style.fontFamily = isError ? 'monospace' : '';
  element.textContent = translatedText;
}

function addTranslateButtonToYouTubeComments() {
  if (!/\.youtube\.com$/.test(window.location.hostname)) return;
  if (!featureSettings.enableYoutubeTranslation) return;

  const commentTextSelector = 'ytd-comment-view-model #content-text, ytd-comment-renderer #content-text';

  ensureEmbeddedTranslationSpinnerStyles();
  ensureYouTubeTranslationStyles();

  window.youtubeObserverController = window.youtubeObserverController || window.createObserverController({
    selector: commentTextSelector,
    onElement: addButtonToYouTubeComment,
    isEnabled: () => featureSettings.enableYoutubeTranslation
  });
  window.youtubeObserverController.start();
}

function addButtonToYouTubeComment(contentTextEl) {
  if (!contentTextEl || contentTextEl.parentElement?.querySelector('.llm-yt-translate-button')) return;

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
      <path d="M12,4V2A10,10 0 0,0 2,12H4A8,8 0 0 1 12,4Z"/>
    </svg>
  `;

  const translateIcon = btn.querySelector('.translate-icon');
  const spinner = btn.querySelector('.spinner');

  contentTextEl.insertAdjacentElement('afterend', btn);

  btn.addEventListener('click', () => {
    const container = contentTextEl.closest('ytd-comment-view-model, ytd-comment-renderer') || contentTextEl.parentElement;
    const existing = container?.querySelector('.llm-yt-translation');
    if (existing) {
      const activeSession = findStreamSessionByElement('youtube', existing);
      if (activeSession) {
        cancelTranslationStream(activeSession.requestId);
        cancelLocalStreamSession(activeSession.requestId);
      }
      existing.remove();
      btn.style.color = 'rgb(83, 100, 113)';
      translateIcon.style.display = 'inline-block';
      spinner.style.display = 'none';
      return;
    }

    btn.style.color = '#1DA1F2';
    translateIcon.style.display = 'none';
    spinner.style.display = 'inline-block';

    const text = contentTextEl.textContent || '';
    const onFinally = () => {
      btn.style.color = 'rgb(83, 100, 113)';
      translateIcon.style.display = 'inline-block';
      spinner.style.display = 'none';
    };

    const useStreaming = providerSupportsStreaming();
    if (useStreaming) {
      const element = ensureYouTubeTranslationElement(contentTextEl);
      element.textContent = '翻訳しています...';
      const { promise } = startEmbeddedTranslationStream({
        kind: 'youtube',
        text,
        element,
        meta: { platform: 'youtube' },
        render: (currentText, { isError = false } = {}) => {
          renderYouTubeTranslationElement(element, currentText, isError);
        }
      });
      promise
        .catch((error) => {
          if (error?.message === 'cancelled') {
            return;
          }
          showYouTubeCommentTranslation(contentTextEl, `翻訳エラー: ${error?.message || 'unknown error'}`);
        })
        .finally(onFinally);
      return;
    }

    safeSendMessage({ action: 'translateEmbeddedText', text }, (response) => {
      showYouTubeCommentTranslation(contentTextEl, extractTranslatedTextFromResponse(response));
      onFinally();
    });
  });
}

function showYouTubeCommentTranslation(contentTextEl, translatedText) {
  const wrap = ensureYouTubeTranslationElement(contentTextEl);
  const isError = ErrorUtils.isTranslationError(translatedText);
  renderYouTubeTranslationElement(wrap, translatedText, isError);
}

window.LLMT = window.LLMT || {};
window.LLMT.youtube = {
  addTranslateButtonToYouTubeComments
};
Object.assign(window, window.LLMT.youtube);
})();
