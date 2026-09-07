(() => {
  'use strict';

const TWEET_TRANSLATION_CACHE_MAX_ENTRIES = 300;
const tweetTranslationCache = new Map();
let tweetTranslationCacheScope = 0;

function hashStringForCache(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return (hash >>> 0).toString(36);
}

function normalizeTweetTranslationCacheKey(text) {
  if (typeof text !== 'string') return '';
  let normalized = text;
  try {
    normalized = normalized.normalize('NFC');
  } catch {
    // ignore normalization errors and keep original
  }
  return normalized.replace(/\s+/g, ' ').trim();
}

// キャッシュはこのページ限り。設定変更ごとに世代を進め、古い応答を再利用しない。
function initializeTweetTranslationCacheScope() {
  updateTweetTranslationCacheScopeFromChanges();
}

function updateTweetTranslationCacheScopeFromChanges() {
  tweetTranslationCacheScope += 1;
  tweetTranslationCache.clear();
}

function setTweetTranslationCache(key, translatedText) {
  if (!key || typeof translatedText !== 'string') return;
  if (tweetTranslationCache.has(key)) {
    tweetTranslationCache.delete(key);
  }
  tweetTranslationCache.set(key, translatedText);
  if (tweetTranslationCache.size > TWEET_TRANSLATION_CACHE_MAX_ENTRIES) {
    const oldestKey = tweetTranslationCache.keys().next().value;
    if (oldestKey !== undefined) {
      tweetTranslationCache.delete(oldestKey);
    }
  }
}

function extractTweetIdFromHref(href) {
  if (typeof href !== 'string') return '';
  const match = href.match(/\/status\/(\d+)/);
  return match ? match[1] : '';
}

function collectTweetIdsInElement(rootElement) {
  if (!(rootElement instanceof Element)) return [];
  const ids = new Set();
  rootElement.querySelectorAll('a[href*="/status/"]').forEach((anchor) => {
    const id = extractTweetIdFromHref(anchor.getAttribute('href') || anchor.href || '');
    if (id) ids.add(id);
  });
  return Array.from(ids);
}

function resolveTweetIdForTextElement(tweetElement, tweetTextElement) {
  if (!(tweetTextElement instanceof Element)) return '';

  const directAnchor = tweetTextElement.closest('a[href*="/status/"]');
  if (directAnchor) {
    const directId = extractTweetIdFromHref(directAnchor.getAttribute('href') || directAnchor.href || '');
    if (directId) return directId;
  }

  let current = tweetTextElement;
  while (current) {
    const ids = collectTweetIdsInElement(current);
    if (ids.length === 1) return ids[0];
    if (current === tweetElement) break;
    current = current.parentElement;
  }

  return '';
}

function buildTweetTranslationCacheKeys({ tweetElement, tweetTextElement, text }) {
  const normalizedText = normalizeTweetTranslationCacheKey(text);
  if (!normalizedText) {
    return null;
  }

  const scope = tweetTranslationCacheScope || 'provider:unknown|model:|prompt:0';
  const textHash = hashStringForCache(normalizedText);
  const fallbackKey = `scope:${scope}|text:${textHash}`;
  const tweetId = resolveTweetIdForTextElement(tweetElement, tweetTextElement);

  if (!tweetId) {
    return {
      lookupKeys: [fallbackKey],
      storeKeys: [fallbackKey]
    };
  }

  const primaryKey = `scope:${scope}|tweet:${tweetId}|text:${textHash}`;
  return {
    lookupKeys: [primaryKey, fallbackKey],
    storeKeys: [primaryKey, fallbackKey]
  };
}

function ensureTweetTranslationElement(tweetTextElement) {
  const next = tweetTextElement?.nextSibling;
  if (next && next.classList && next.classList.contains('llm-tweet-translation')) {
    return next;
  }
  const translationElement = document.createElement('div');
  translationElement.className = 'llm-tweet-translation';
  translationElement.dataset.llmtUi = '';
  applyStyles(translationElement, styles.tweetTranslation);
  tweetTextElement.parentNode.insertBefore(translationElement, tweetTextElement.nextSibling);
  return translationElement;
}

function requestTweetTranslationStreamWithCache({ tweetElement, tweetTextElement, text }) {
  const keys = buildTweetTranslationCacheKeys({ tweetElement, tweetTextElement, text });
  if (!keys) {
    return Promise.reject(new Error('翻訳対象テキストが見つかりません'));
  }

  for (const key of keys.lookupKeys) {
    const cached = tweetTranslationCache.get(key);
    if (typeof cached === 'string') {
      showTweetTranslation(tweetTextElement, cached);
      return Promise.resolve(cached);
    }
  }

  const translationElement = ensureTweetTranslationElement(tweetTextElement);
  translationElement.textContent = '翻訳しています...';
  const { promise } = startEmbeddedTranslationStream({
    kind: 'tweet',
    text,
    element: translationElement,
    meta: { platform: 'tweet' },
    render: (currentText, { isError = false } = {}) => {
      applyTranslationTextState(translationElement, currentText, isError, styles.tweetTranslation, styles.tweetTranslationError);
    }
  });

  return promise.then((translatedText) => {
    if (!ErrorUtils.isTranslationError(translatedText)) {
      keys.storeKeys.forEach((key) => {
        setTweetTranslationCache(key, translatedText);
      });
    }
    return translatedText;
  });
}

function clearTweetTranslationEntriesForElements(tweetElement, tweetTextElements) {
  tweetTextElements.forEach((element) => {
    const keys = buildTweetTranslationCacheKeys({
      tweetElement,
      tweetTextElement: element,
      text: element?.textContent || ''
    });
    if (!keys) return;
    keys.storeKeys.forEach((key) => {
      tweetTranslationCache.delete(key);
    });
  });
}

function addTranslateButtonToTweets() {
  if (!window.location.hostname.includes('twitter.com') && !window.location.hostname.includes('x.com')) {
    return;
  }
  if (!featureSettings.enableTwitterTranslation) return;

  const tweetSelector = 'article[data-testid="tweet"]';
  window.twitterObserverController = window.twitterObserverController || window.createObserverController({
    selector: tweetSelector,
    onElement: addButtonToTweet,
    isEnabled: () => featureSettings.enableTwitterTranslation
  });
  window.twitterObserverController.start();
}

function addButtonToTweet(tweetElement) {
  if (tweetElement.querySelector('.llm-translate-button')) {
    return;
  }

  const tweetTextElement = tweetElement.querySelector('[data-testid="tweetText"]');
  if (!tweetTextElement) {
    return;
  }

  const actionBar = tweetElement.querySelector('[role="group"]');
  if (!actionBar) {
    return;
  }

  ensureEmbeddedTranslationSpinnerStyles();

  const translateButton = document.createElement('div');
  translateButton.className = 'llm-translate-button';
  translateButton.dataset.llmtUi = '';
  translateButton.style.display = 'flex';
  translateButton.style.alignItems = 'center';
  translateButton.style.cursor = 'pointer';
  translateButton.style.color = 'rgb(83, 100, 113)';
  translateButton.style.padding = '0 12px';
  translateButton.style.fontSize = '13px';
  translateButton.setAttribute('role', 'button');
  translateButton.setAttribute('aria-label', '日本語翻訳');
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

  const translateIcon = translateButton.querySelector('.translate-icon');
  const spinner = translateButton.querySelector('.spinner');

  translateButton.addEventListener('click', () => {
    const tweetTextElements = Array.from(tweetElement.querySelectorAll('[data-testid="tweetText"]'));

    const anyExisting = tweetTextElements.some((element) => {
      const next = element.nextSibling;
      return next && next.classList && next.classList.contains('llm-tweet-translation');
    });

    if (anyExisting) {
      tweetTextElements.forEach((element) => {
        const next = element.nextSibling;
        if (next && next.classList && next.classList.contains('llm-tweet-translation')) {
          const activeSession = findStreamSessionByElement('tweet', next);
          if (activeSession) {
            cancelTranslationStream(activeSession.requestId);
            cancelLocalStreamSession(activeSession.requestId);
          }
          next.remove();
        }
      });
      clearTweetTranslationEntriesForElements(tweetElement, tweetTextElements);
      translateButton.style.color = 'rgb(83, 100, 113)';
      translateIcon.style.display = 'block';
      spinner.style.display = 'none';
      return;
    }

    if (tweetTextElements.length === 0) {
      return;
    }

    translateButton.style.color = '#1DA1F2';
    translateIcon.style.display = 'none';
    spinner.style.display = 'block';

    let pending = tweetTextElements.length;
    tweetTextElements.forEach((element) => {
      const text = element.textContent || '';
      const requestPromise = requestTweetTranslationStreamWithCache({ tweetElement, tweetTextElement: element, text });

      requestPromise
        .catch((error) => {
          if (error?.message === 'cancelled') {
            return;
          }
          const message = error?.message || String(error || 'unknown error');
          showTweetTranslation(element, `翻訳エラー: ${message}`);
        })
        .finally(() => {
          pending -= 1;
          if (pending === 0) {
            translateButton.style.color = 'rgb(83, 100, 113)';
            translateIcon.style.display = 'block';
            spinner.style.display = 'none';
          }
        });
    });
  });

  actionBar.appendChild(translateButton);
}

function showTweetTranslation(tweetTextElement, translatedText) {
  const translationElement = ensureTweetTranslationElement(tweetTextElement);
  applyTranslationTextState(
    translationElement,
    translatedText,
    ErrorUtils.isTranslationError(translatedText),
    styles.tweetTranslation,
    styles.tweetTranslationError
  );
}

window.LLMT = window.LLMT || {};
window.LLMT.twitter = {
  initializeTweetTranslationCacheScope,
  updateTweetTranslationCacheScopeFromChanges,
  addTranslateButtonToTweets
};
Object.assign(window, window.LLMT.twitter);
})();
