(() => {
  'use strict';

window.twitterObserverController = window.twitterObserverController || null;
window.youtubeObserverController = window.youtubeObserverController || null;

const featureSettings = {
  enableTwitterTranslation: true,
  enableYoutubeTranslation: true
};

let featureSettingsListenerRegistered = false;
let capabilityRevision = 0;

function refreshTranslationCapabilities() {
  const revision = ++capabilityRevision;
  window.LLMT.settings.capabilities = {};
  window.LLMT.messaging.sendBackgroundMessage('getTranslationCapabilities').then(result => {
    if (revision === capabilityRevision && result.ok) {
      window.LLMT.settings.capabilities = result.data?.capabilities || {};
    }
  }).catch(() => {});
}

function loadFeatureSettings(callback) {
  refreshTranslationCapabilities();
  return new Promise((resolve) => {
    const finish = () => {
      if (typeof callback === 'function') {
        try { callback(); } catch {}
      }
      resolve(featureSettings);
    };

    try {
      chrome.storage?.sync?.get?.(['enableTwitterTranslation', 'enableYoutubeTranslation'], (settings) => {
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
      refreshTranslationCapabilities();
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
          window.twitterObserverController?.stop();
          document.querySelectorAll('.llm-translate-button, .llm-tweet-translation').forEach((node) => node.remove());
        } else {
          window.addTranslateButtonToTweets();
        }
      }

      if (youtubeChanged) {
        if (!featureSettings.enableYoutubeTranslation) {
          window.youtubeObserverController?.stop();
          document.querySelectorAll('.llm-yt-translate-button, .llm-yt-translation').forEach((node) => node.remove());
        } else {
          window.addTranslateButtonToYouTubeComments();
        }
      }

      window.updateTweetTranslationCacheScopeFromChanges(changes);
    });
  } catch {}
}

function createObserverController({ selector, onElement, isEnabled }) {
  let observer = null;

  const applyToNode = (node) => {
    if (!(node instanceof Element)) return;
    if (node.matches?.(selector)) {
      onElement(node);
    }
    node.querySelectorAll?.(selector).forEach(onElement);
  };

  return {
    start() {
      if (!isEnabled()) return;
      document.querySelectorAll(selector).forEach(onElement);
      if (observer || !document.body) return;
      observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          for (const node of mutation.addedNodes || []) {
            applyToNode(node);
          }
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
    },
    stop() {
      observer?.disconnect();
      observer = null;
    }
  };
}

window.LLMT = window.LLMT || {};
window.LLMT.settings = {
  featureSettings,
  capabilities: {},
  loadFeatureSettings,
  registerFeatureSettingsListener,
  createObserverController,
  ready: loadFeatureSettings
};
window.featureSettings = featureSettings;
window.loadFeatureSettings = loadFeatureSettings;
window.registerFeatureSettingsListener = registerFeatureSettingsListener;
window.createObserverController = createObserverController;
})();
