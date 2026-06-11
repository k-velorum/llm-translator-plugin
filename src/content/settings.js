(() => {
  'use strict';

window.tweetObserver = window.tweetObserver || null;
window.ytObserver = window.ytObserver || null;

const featureSettings = {
  enableTwitterTranslation: true,
  enableYoutubeTranslation: true
};

let featureSettingsListenerRegistered = false;

function loadFeatureSettings(callback) {
  return new Promise((resolve) => {
    const finish = () => {
      if (typeof callback === 'function') {
        try { callback(); } catch {}
      }
      resolve(featureSettings);
    };

    try {
      chrome.storage?.sync?.get?.(null, (settings) => {
        if (settings) {
          if (typeof settings.enableTwitterTranslation === 'boolean') {
            featureSettings.enableTwitterTranslation = settings.enableTwitterTranslation;
          }
          if (typeof settings.enableYoutubeTranslation === 'boolean') {
            featureSettings.enableYoutubeTranslation = settings.enableYoutubeTranslation;
          }
        }
        finish();
      });
    } catch {
      finish();
    }
  });
}

function registerFeatureSettingsListener() {
  if (featureSettingsListenerRegistered) return;
  featureSettingsListenerRegistered = true;

  try {
    chrome.storage?.onChanged?.addListener?.((changes, area) => {
      if (area !== 'sync') return;
      let twitterChanged = false;
      let youtubeChanged = false;

      if (Object.prototype.hasOwnProperty.call(changes, 'enableTwitterTranslation')) {
        featureSettings.enableTwitterTranslation = !!changes.enableTwitterTranslation.newValue;
        twitterChanged = true;
      }
      if (Object.prototype.hasOwnProperty.call(changes, 'enableYoutubeTranslation')) {
        featureSettings.enableYoutubeTranslation = !!changes.enableYoutubeTranslation.newValue;
        youtubeChanged = true;
      }

      if (twitterChanged) {
        if (!featureSettings.enableTwitterTranslation) {
          try { window.tweetObserver?.disconnect(); } catch {}
          window.tweetObserver = null;
          document.querySelectorAll('.llm-translate-button, .llm-tweet-translation').forEach((node) => node.remove());
        } else {
          addTranslateButtonToTweets();
        }
      }

      if (youtubeChanged) {
        if (!featureSettings.enableYoutubeTranslation) {
          try { window.ytObserver?.disconnect(); } catch {}
          window.ytObserver = null;
          document.querySelectorAll('.llm-yt-translate-button, .llm-yt-translation').forEach((node) => node.remove());
        } else {
          addTranslateButtonToYouTubeComments();
        }
      }

      updateTweetTranslationCacheScopeFromChanges(changes);
    });
  } catch {}
}

window.LLMT = window.LLMT || {};
window.LLMT.settings = {
  featureSettings,
  loadFeatureSettings,
  registerFeatureSettingsListener,
  ready: loadFeatureSettings
};
window.featureSettings = featureSettings;
window.loadFeatureSettings = loadFeatureSettings;
window.registerFeatureSettingsListener = registerFeatureSettingsListener;
})();
