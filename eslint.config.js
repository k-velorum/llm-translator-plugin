import js from '@eslint/js';
import globals from 'globals';

const chromeGlobals = {
  chrome: 'readonly'
};

const contentSharedGlobals = {
  addButtonToTweet: 'readonly',
  addTranslateButtonToTweets: 'readonly',
  addTranslateButtonToYouTubeComments: 'readonly',
  applyPageTranslation: 'readonly',
  applyPageTranslationChunk: 'readonly',
  applyStyles: 'readonly',
  applyTranslationTextState: 'readonly',
  appendStreamSessionDelta: 'readonly',
  canUseExtensionRuntime: 'readonly',
  cancelLocalStreamSession: 'readonly',
  cancelTranslationStream: 'readonly',
  closePopupOnClickOutside: 'readonly',
  capturePageTextSnapshot: 'readonly',
  completeStreamSession: 'readonly',
  contentTranslationIntegrationsInitialized: 'writable',
  createSelectionPopup: 'readonly',
  createTranslationRequestId: 'readonly',
  discardStreamSession: 'readonly',
  DOMUtils: 'readonly',
  ensureEmbeddedTranslationSpinnerStyles: 'readonly',
  ensureSelectionLoadingSpinnerStyles: 'readonly',
  ErrorUtils: 'readonly',
  extractTranslatedTextFromResponse: 'readonly',
  featureSettings: 'writable',
  findStreamSessionByElement: 'readonly',
  failStreamSession: 'readonly',
  flushStreamSession: 'readonly',
  getSelectionAnchorRect: 'readonly',
  hidePageTranslationControls: 'readonly',
  initializeContentTranslationIntegrations: 'readonly',
  initializeTweetTranslationCacheScope: 'readonly',
  loadFeatureSettings: 'readonly',
  pageTranslationControls: 'writable',
  pageTranslationControlsSnapshotId: 'writable',
  pageTranslationSnapshot: 'writable',
  positionPopupInViewport: 'readonly',
  prepareSelectionTranslationStream: 'readonly',
  providerSupportsStreaming: 'readonly',
  registerFeatureSettingsListener: 'readonly',
  registerStreamSession: 'readonly',
  removePopup: 'readonly',
  resolveImageAnchorRect: 'readonly',
  resolveImageDataUrl: 'readonly',
  safeSendMessage: 'readonly',
  showLoadingPopup: 'readonly',
  showPageTranslationControls: 'readonly',
  showSelectionStreamPopup: 'readonly',
  showTranslationPopup: 'readonly',
  startEmbeddedTranslationStream: 'readonly',
  styles: 'readonly',
  streamViewSessions: 'readonly',
  TWEET_TRANSLATION_CACHE_SETTINGS_DEFAULTS: 'readonly',
  translationPopup: 'writable',
  tweetObserver: 'writable',
  tweetTranslationCacheSettings: 'writable',
  updateSelectionStreamPopup: 'readonly',
  updateTweetTranslationCacheScopeFromChanges: 'readonly',
  ytObserver: 'writable'
};

export default [
  {
    ignores: ['lib/**', 'node_modules/**', 'coverage/**']
  },
  js.configs.recommended,
  {
    files: ['background.js', 'src/background/**/*.js', 'src/offscreen/**/*.js', 'src/shared/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...chromeGlobals,
        LanguageModel: 'readonly'
      }
    }
  },
  {
    files: ['content.js', 'src/content/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'script',
      globals: {
        ...globals.browser,
        ...chromeGlobals,
        ...contentSharedGlobals
      }
    }
  },
  {
    files: ['src/popup/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...chromeGlobals,
        $: 'readonly',
        jQuery: 'readonly'
      }
    }
  },
  {
    files: ['eslint.config.js', 'test/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.node
      }
    }
  },
  {
    rules: {
      eqeqeq: ['error', 'always'],
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-cond-assign': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-redeclare': 'off',
      'no-useless-assignment': 'off',
      'no-useless-catch': 'off',
      'no-useless-escape': 'warn',
      'no-var': 'error',
      'preserve-caught-error': 'off'
    }
  }
];
