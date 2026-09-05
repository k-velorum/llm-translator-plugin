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
  getProviderUi,
  getProviderElementRefs,
  getProviderSections,
  renderProviderSections
} from './provider-ui.js';
import {
  loadSettings,
  collectSettings,
  saveSettings
} from './settings-form.js';
import { invalidateTestResult, testApi } from './test-api.js';
import { createSaveState } from './save-state.js';

document.addEventListener('DOMContentLoaded', init);

async function init() {
  renderProviderSections(document.getElementById('provider-sections'));
  const elements = getElements();
  createVerificationUI(elements);
  let savedSettings;
  try {
    savedSettings = await loadSettings(elements);
  } catch (error) {
    elements.saveState.textContent = '設定を読み込めませんでした';
    elements.statusMessage.textContent = error.message;
    elements.statusMessage.classList.remove('hidden');
    return;
  }
  let connectionRevision = 0;
  let savedConnectionRevision = 0;
  const draft = () => collectSettings(elements, savedSettings);
  const saveState = createSaveState(elements, async () => {
    const settings = draft();
    const pendingConnectionRevision = connectionRevision;
    await saveSettings(settings, { validateConnection: connectionRevision !== savedConnectionRevision });
    savedSettings = settings;
    savedConnectionRevision = pendingConnectionRevision;
  });
  const markDirty = (target) => {
    if (target.closest('#settings-tab')) connectionRevision += 1;
    saveState.markDirty();
    invalidateTestResult(elements);
    updateTestSummary(elements, draft());
  };
  const markFieldDirty = (event) => {
    // モデル検索欄への入力やdetailsの開閉は設定変更ではない。
    if (event.target.matches('input[id], select[id], textarea[id]')) markDirty(event.target);
  };
  document.querySelectorAll('#settings-tab, #features-tab').forEach((panel) => {
    panel.addEventListener('input', markFieldDirty);
    panel.addEventListener('change', markFieldDirty);
  });
  initTabs(elements);
  setupApiProviderToggle(elements);
  bindEventHandlers(elements, draft, markDirty);
  bindLogHandlers(elements);
  initSelect2();
  // Select2のプログラムによる復元は未保存扱いにせず、ユーザーの選択だけ拾う。
  $('.model-select').on('select2:select', (event) => markDirty(event.target));
  loadModels(elements);
  updateTestSummary(elements, draft());
  refreshLogs(elements);
}

function updateTestSummary(elements, settings) {
  const provider = getProviderUi(settings.apiProvider);
  elements.testProviderLabel.textContent = provider?.label || settings.apiProvider;
  elements.testModelLabel.textContent = settings[provider?.settingsKeys?.model] || 'モデル未選択';
  if (settings.apiProvider === 'chromePrompt') elements.testModelLabel.textContent = 'Gemini Nano';
}

function getElements() {
  return {
    ...getProviderElementRefs(),
    apiProviderSelect: document.getElementById('api-provider'),
    saveButton: document.getElementById('save-button'),
    statusMessage: document.getElementById('status-message'),
    saveState: document.getElementById('save-state'),
    twitterFeatureCheckbox: document.getElementById('enable-twitter-translation'),
    youtubeFeatureCheckbox: document.getElementById('enable-youtube-translation'),
    translationSystemPromptTextarea: document.getElementById('translation-system-prompt'),
    resetSystemPromptButton: document.getElementById('reset-system-prompt'),
    pageTranslationSeparatorPromptTextarea: document.getElementById('page-translation-separator-prompt'),
    resetSeparatorPromptButton: document.getElementById('reset-separator-prompt'),
    pageTranslationMaxCharsInput: document.getElementById('page-translation-max-chars'),
    pageTranslationMaxItemsInput: document.getElementById('page-translation-max-items'),
    pageTranslationDelayMsInput: document.getElementById('page-translation-delay-ms'),
    pageTranslationConcurrencyInput: document.getElementById('page-translation-concurrency'),
    pageTranslationSeparatorInput: document.getElementById('page-translation-separator'),
    testProviderLabel: document.getElementById('test-provider-label'),
    testModelLabel: document.getElementById('test-model-label'),
    testErrorDetails: document.getElementById('test-error-details'),
    testErrorBody: document.getElementById('test-error-body'),
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
  const selectTab = (tabId) => {
    tabs.forEach((tab) => {
      const selected = tab.getAttribute('data-tab') === tabId;
      tab.classList.toggle('active', selected);
      tab.setAttribute('aria-pressed', String(selected));
    });
    tabContents.forEach((content) => content.classList.toggle('active', content.id === `${tabId}-tab`));
    document.getElementById('settings-scroll').scrollTop = 0;
  };
  tabs.forEach((tab) => tab.addEventListener('click', () => selectTab(tab.getAttribute('data-tab'))));
  document.getElementById('open-test-button').addEventListener('click', () => selectTab('test'));
}

function setupApiProviderToggle(elements) {
  const { apiProviderSelect } = elements;
  apiProviderSelect.addEventListener('change', () => {
    const sections = getProviderSections(elements);

    Object.values(sections).forEach(section => section?.classList.add('hidden'));
    sections[apiProviderSelect.value]?.classList.remove('hidden');
  });
}

function bindEventHandlers(elements, draft, markDirty) {
  elements.testButton.addEventListener('click', () => testApi(elements, draft()));
  bindProviderModelRefreshHandlers(elements);
  const resets = [
    [elements.resetSystemPromptButton, elements.translationSystemPromptTextarea, DEFAULT_TRANSLATION_SYSTEM_PROMPT],
    [elements.resetSeparatorPromptButton, elements.pageTranslationSeparatorPromptTextarea, DEFAULT_PAGE_TRANSLATION_SEPARATOR_PROMPT]
  ];
  resets.forEach(([button, field, value]) => {
    button.addEventListener('click', () => {
      field.value = value;
      markDirty(field);
    });
  });
}
