let contentTranslationIntegrationsInitialized = false;

function initializeContentTranslationIntegrations() {
  if (contentTranslationIntegrationsInitialized) return;
  contentTranslationIntegrationsInitialized = true;
  registerFeatureSettingsListener();
  initializeTweetTranslationCacheScope();
  loadFeatureSettings(() => {
    addTranslateButtonToTweets();
    addTranslateButtonToYouTubeComments();
  });
}

document.addEventListener('DOMContentLoaded', () => {
  initializeContentTranslationIntegrations();
});

if (document.readyState === 'interactive' || document.readyState === 'complete') {
  initializeContentTranslationIntegrations();
}
