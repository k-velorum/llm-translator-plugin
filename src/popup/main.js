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
import { getProviderSections } from './provider-ui.js';
import {
  loadSettings,
  saveFeatureSettings,
  saveSettings
} from './settings-form.js';
import { testApi } from './test-api.js';

document.addEventListener('DOMContentLoaded', init);

function init() {
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
    apiProviderSelect: document.getElementById('api-provider'),
    openrouterSection: document.getElementById('openrouter-section'),
    geminiSection: document.getElementById('gemini-section'),
    cerebrasSection: document.getElementById('cerebras-section'),
    zaiSection: document.getElementById('zai-section'),
    ollamaSection: document.getElementById('ollama-section'),
    lmstudioSection: document.getElementById('lmstudio-section'),
    chromePromptSection: document.getElementById('chromePrompt-section'),
    openrouterApiKeyInput: document.getElementById('openrouter-api-key'),
    openrouterModelSelect: document.getElementById('openrouter-model'),
    geminiApiKeyInput: document.getElementById('gemini-api-key'),
    geminiModelSelect: document.getElementById('gemini-model'),
    cerebrasApiKeyInput: document.getElementById('cerebras-api-key'),
    cerebrasModelSelect: document.getElementById('cerebras-model'),
    zaiApiKeyInput: document.getElementById('zai-api-key'),
    zaiModelSelect: document.getElementById('zai-model'),
    ollamaServerInput: document.getElementById('ollama-server'),
    ollamaModelSelect: document.getElementById('ollama-model'),
    lmstudioServerInput: document.getElementById('lmstudio-server'),
    lmstudioApiKeyInput: document.getElementById('lmstudio-api-key'),
    lmstudioModelSelect: document.getElementById('lmstudio-model'),
    chromePromptTemperatureInput: document.getElementById('chromePrompt-temperature'),
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
    pageTranslationChunksPerPassInput: document.getElementById('page-translation-chunks-per-pass'),
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

function setupApiProviderToggle({
  apiProviderSelect,
  openrouterSection,
  geminiSection,
  cerebrasSection,
  zaiSection,
  ollamaSection,
  lmstudioSection,
  chromePromptSection
}) {
  apiProviderSelect.addEventListener('change', () => {
    const sections = getProviderSections({
      openrouterSection,
      geminiSection,
      cerebrasSection,
      zaiSection,
      ollamaSection,
      lmstudioSection,
      chromePromptSection
    });

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
