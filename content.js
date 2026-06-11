(() => {
  'use strict';

let contentTranslationIntegrationsInitialized = false;

function initializeContentTranslationIntegrations() {
  if (contentTranslationIntegrationsInitialized) return;
  contentTranslationIntegrationsInitialized = true;
  window.registerFeatureSettingsListener();
  window.initializeTweetTranslationCacheScope();
  window.loadFeatureSettings(() => {
    window.addTranslateButtonToTweets();
    window.addTranslateButtonToYouTubeComments();
  });
}

document.addEventListener('DOMContentLoaded', () => {
  initializeContentTranslationIntegrations();
});

if (document.readyState === 'interactive' || document.readyState === 'complete') {
  initializeContentTranslationIntegrations();
}

window.LLMT = window.LLMT || {};
window.LLMT.init = initializeContentTranslationIntegrations;
})();
