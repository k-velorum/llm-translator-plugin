import {
  DEFAULT_PAGE_TRANSLATION_SEPARATOR_PROMPT,
  DEFAULT_TRANSLATION_SYSTEM_PROMPT
} from '../background/settings.js';
import { createVerificationUI } from './api-key-verification.js';
import { bindLogHandlers, refreshLogs } from './logs.js';
import {
  bindProviderModelRefreshHandlers,
  initSelect2,
  loadModels
} from './models.js';
import {
  getProviderElementRefs,
  getProviderSections,
  renderProviderSections
} from './provider-ui.js';
import {
  loadSettings,
  saveFeatureSettings,
  saveSettings
} from './settings-form.js';
import { testApi } from './test-api.js';

document.addEventListener('DOMContentLoaded', init);

function init() {
  renderProviderSections(document.getElementById('provider-sections'));
  const elements = getElements();
  initTabs(elements);
  setupApiProviderToggle(elements);
  createVerificationUI(elements);
  loadSettings(elements);
  bindEventHandlers(elements);
  bindLogHandlers(elements);
  initSelect2();
  loadModels(elements);

  refreshLogs(elements);
}

function getElements() {
  return {
    ...getProviderElementRefs(),
    apiProviderSelect: document.getElementById('api-provider'),
    saveButton: document.getElementById('save-button'),
    statusMessage: document.getElementById('status-message'),
    featureStatusMessage: document.getElementById('feature-status-message'),
    twitterFeatureCheckbox: document.getElementById('enable-twitter-translation'),
    youtubeFeatureCheckbox: document.getElementById('enable-youtube-translation'),
    featureSaveButton: document.getElementById('feature-save-button'),
    translationSystemPromptTextarea: document.getElementById('translation-system-prompt'),
    resetSystemPromptButton: document.getElementById('reset-system-prompt'),
    separatorPromptToggleButton: document.getElementById('toggle-separator-prompt-settings'),
    separatorPromptBody: document.getElementById('separator-prompt-body'),
    pageTranslationSeparatorPromptTextarea: document.getElementById('page-translation-separator-prompt'),
    resetSeparatorPromptButton: document.getElementById('reset-separator-prompt'),
    advancedToggleButton: document.getElementById('toggle-advanced-settings'),
    advancedBody: document.getElementById('advanced-settings-body'),
    pageTranslationMaxCharsInput: document.getElementById('page-translation-max-chars'),
    pageTranslationMaxItemsInput: document.getElementById('page-translation-max-items'),
    pageTranslationDelayMsInput: document.getElementById('page-translation-delay-ms'),
    pageTranslationConcurrencyInput: document.getElementById('page-translation-concurrency'),
    pageTranslationSeparatorInput: document.getElementById('page-translation-separator'),
    testApiProviderSelect: document.getElementById('test-api-provider'),
    testTextArea: document.getElementById('test-text'),
    testButton: document.getElementById('test-button'),
    testStatus: document.getElementById('test-status'),
    testResult: document.getElementById('test-result'),
    logView: document.getElementById('log-view'),
    logClearButton: document.getElementById('log-clear-button'),
    logStatus: document.getElementById('log-status'),
    tabs: document.querySelectorAll('.tab'),
    tabContents: document.querySelectorAll('.tab-content')
  };
}

function initTabs({ tabs, tabContents }) {
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const tabId = tab.getAttribute('data-tab');
      tabs.forEach(currentTab => currentTab.classList.remove('active'));
      tab.classList.add('active');
      tabContents.forEach(content => {
        content.classList.toggle('active', content.id === `${tabId}-tab`);
      });
    });
  });
}

function setupApiProviderToggle(elements) {
  const { apiProviderSelect } = elements;
  apiProviderSelect.addEventListener('change', () => {
    const sections = getProviderSections(elements);

    Object.values(sections).forEach(section => section?.classList.add('hidden'));
    sections[apiProviderSelect.value]?.classList.remove('hidden');
  });
}

function bindEventHandlers(elements) {
  const {
    saveButton,
    featureSaveButton,
    testButton,
    advancedToggleButton,
    advancedBody,
    resetSystemPromptButton,
    translationSystemPromptTextarea,
    separatorPromptToggleButton,
    separatorPromptBody,
    resetSeparatorPromptButton,
    pageTranslationSeparatorPromptTextarea
  } = elements;

  saveButton.addEventListener('click', () => saveSettings(elements));
  if (featureSaveButton) featureSaveButton.addEventListener('click', () => saveFeatureSettings(elements));
  testButton.addEventListener('click', () => testApi(elements));
  bindProviderModelRefreshHandlers(elements);

  if (advancedToggleButton && advancedBody) {
    advancedToggleButton.addEventListener('click', () => {
      advancedBody.classList.toggle('hidden');
    });
  }

  if (separatorPromptToggleButton && separatorPromptBody) {
    separatorPromptToggleButton.addEventListener('click', () => {
      separatorPromptBody.classList.toggle('hidden');
    });
  }

  if (resetSystemPromptButton) {
    resetSystemPromptButton.addEventListener('click', () => {
      if (translationSystemPromptTextarea) {
        translationSystemPromptTextarea.value = DEFAULT_TRANSLATION_SYSTEM_PROMPT;
      }
    });
  }

  if (resetSeparatorPromptButton) {
    resetSeparatorPromptButton.addEventListener('click', () => {
      if (pageTranslationSeparatorPromptTextarea) {
        pageTranslationSeparatorPromptTextarea.value = DEFAULT_PAGE_TRANSLATION_SEPARATOR_PROMPT;
      }
    });
  }
}
