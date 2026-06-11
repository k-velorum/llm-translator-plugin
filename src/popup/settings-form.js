import {
  DEFAULT_PAGE_TRANSLATION_SEPARATOR_PROMPT,
  DEFAULT_TRANSLATION_SYSTEM_PROMPT,
  LEGACY_COMBINED_TRANSLATION_SYSTEM_PROMPT
} from '../background/settings.js';
import {
  MODEL_PROVIDER_IDS,
  PROVIDER_ORDER,
  getProviderSections,
  getProviderUi
} from './provider-ui.js';
import { restoreModelSelection } from './models.js';
import { showStatus } from './status.js';

function validateApiKey(apiProvider, settings) {
  const provider = getProviderUi(apiProvider);
  const apiKeyKey = provider?.settingsKeys?.apiKey;
  if (provider?.needsApiKey && apiKeyKey && !settings[apiKeyKey]) {
    return { isValid: false, message: provider.validationMessage };
  }

  return { isValid: true, message: '' };
}

function readNumberInput(element, fallback, min, max) {
  if (!element) return fallback;
  const value = parseInt((element.value || '').toString(), 10);
  if (Number.isNaN(value)) return fallback;
  if (typeof min === 'number' && value < min) return min;
  if (typeof max === 'number' && value > max) return max;
  return value;
}

export function loadSettings(elements) {
  const {
    apiProviderSelect,
    twitterFeatureCheckbox,
    youtubeFeatureCheckbox,
    translationSystemPromptTextarea,
    pageTranslationSeparatorPromptTextarea,
    pageTranslationMaxCharsInput,
    pageTranslationMaxItemsInput,
    pageTranslationChunksPerPassInput,
    pageTranslationDelayMsInput,
    pageTranslationConcurrencyInput,
    pageTranslationSeparatorInput
  } = elements;

  chrome.storage.sync.get(null, settings => {
    const apiProvider = settings.apiProvider || 'openrouter';
    apiProviderSelect.value = apiProvider;

    PROVIDER_ORDER.forEach((provider) => {
      const config = getProviderUi(provider);
      const { settingsKeys } = config;
      const apiKeyInput = elements[config.elements.apiKey];
      const serverInput = elements[config.elements.server];
      const modelSelect = elements[config.elements.model];
      const temperatureInput = elements[config.elements.temperature];
      if (apiKeyInput) apiKeyInput.value = settings[settingsKeys.apiKey] || '';
      if (serverInput) serverInput.value = settings[settingsKeys.server] || config.defaultServer || '';
      if (modelSelect) modelSelect.value = settings[settingsKeys.model] || '';
      if (temperatureInput) {
        temperatureInput.value = settings[settingsKeys.temperature] ?? config.defaultTemperature ?? 0.2;
      }
    });

    if (twitterFeatureCheckbox) twitterFeatureCheckbox.checked = settings.enableTwitterTranslation !== false;
    if (youtubeFeatureCheckbox) youtubeFeatureCheckbox.checked = settings.enableYoutubeTranslation !== false;

    const usesLegacyCombinedPrompt =
      settings.translationSystemPrompt === LEGACY_COMBINED_TRANSLATION_SYSTEM_PROMPT;
    const translationPrompt = usesLegacyCombinedPrompt
      ? DEFAULT_TRANSLATION_SYSTEM_PROMPT
      : (settings.translationSystemPrompt || DEFAULT_TRANSLATION_SYSTEM_PROMPT);
    const separatorPrompt =
      settings.pageTranslationSeparatorPrompt || DEFAULT_PAGE_TRANSLATION_SEPARATOR_PROMPT;

    if (translationSystemPromptTextarea) translationSystemPromptTextarea.value = translationPrompt;
    if (pageTranslationSeparatorPromptTextarea) pageTranslationSeparatorPromptTextarea.value = separatorPrompt;
    if (pageTranslationMaxCharsInput) pageTranslationMaxCharsInput.value = (settings.pageTranslationMaxChars ?? 3500);
    if (pageTranslationMaxItemsInput) pageTranslationMaxItemsInput.value = (settings.pageTranslationMaxItemsPerChunk ?? 50);
    if (pageTranslationChunksPerPassInput) pageTranslationChunksPerPassInput.value = (settings.pageTranslationChunksPerPass ?? 6);
    if (pageTranslationDelayMsInput) pageTranslationDelayMsInput.value = (settings.pageTranslationDelayMs ?? 400);
    if (pageTranslationConcurrencyInput) pageTranslationConcurrencyInput.value = (settings.pageTranslationConcurrency ?? 4);
    if (pageTranslationSeparatorInput) pageTranslationSeparatorInput.value = (settings.pageTranslationSeparator ?? '[[[SEP]]]');

    const sections = getProviderSections(elements);
    Object.values(sections).forEach(section => section?.classList.add('hidden'));
    sections[apiProvider]?.classList.remove('hidden');

    MODEL_PROVIDER_IDS.forEach((provider) => {
      const config = getProviderUi(provider);
      restoreModelSelection(
        provider,
        elements[config.elements.model],
        settings[config.settingsKeys.model]
      );
    });
  });
}

export function saveSettings(elements) {
  const { apiProviderSelect, statusMessage, twitterFeatureCheckbox, youtubeFeatureCheckbox } = elements;
  const settings = {
    apiProvider: apiProviderSelect.value
  };

  PROVIDER_ORDER.forEach((provider) => {
    const config = getProviderUi(provider);
    const { settingsKeys } = config;
    const apiKeyInput = elements[config.elements.apiKey];
    const serverInput = elements[config.elements.server];
    const modelSelect = elements[config.elements.model];
    const temperatureInput = elements[config.elements.temperature];
    if (apiKeyInput) settings[settingsKeys.apiKey] = apiKeyInput.value.trim();
    if (serverInput) settings[settingsKeys.server] = serverInput.value.trim() || config.defaultServer;
    if (modelSelect) settings[settingsKeys.model] = modelSelect.value;
    if (temperatureInput) {
      const temperature = Number(temperatureInput.value);
      settings[settingsKeys.temperature] = Number.isFinite(temperature)
        ? Math.max(0, Math.min(2, temperature))
        : config.defaultTemperature ?? 0.2;
    }
  });

  if (twitterFeatureCheckbox) settings.enableTwitterTranslation = !!twitterFeatureCheckbox.checked;
  if (youtubeFeatureCheckbox) settings.enableYoutubeTranslation = !!youtubeFeatureCheckbox.checked;

  const validation = validateApiKey(settings.apiProvider, settings);
  if (!validation.isValid) {
    showStatus(statusMessage, validation.message, false);
    return;
  }

  chrome.storage.sync.set(settings, () => {
    showStatus(statusMessage, '設定を保存しました', true);
  });
}

export function saveFeatureSettings(elements) {
  const {
    twitterFeatureCheckbox,
    youtubeFeatureCheckbox,
    featureStatusMessage,
    translationSystemPromptTextarea,
    pageTranslationSeparatorPromptTextarea
  } = elements;

  const partial = {
    enableTwitterTranslation: !!(twitterFeatureCheckbox && twitterFeatureCheckbox.checked),
    enableYoutubeTranslation: !!(youtubeFeatureCheckbox && youtubeFeatureCheckbox.checked),
    translationSystemPrompt: (translationSystemPromptTextarea?.value || '').trim(),
    pageTranslationSeparatorPrompt: (
      pageTranslationSeparatorPromptTextarea?.value ||
      DEFAULT_PAGE_TRANSLATION_SEPARATOR_PROMPT
    ).trim(),
    pageTranslationMaxChars: readNumberInput(elements.pageTranslationMaxCharsInput, 3500, 500, 32000),
    pageTranslationMaxItemsPerChunk: readNumberInput(elements.pageTranslationMaxItemsInput, 50, 5, 500),
    pageTranslationChunksPerPass: readNumberInput(elements.pageTranslationChunksPerPassInput, 6, 1, 100),
    pageTranslationDelayMs: readNumberInput(elements.pageTranslationDelayMsInput, 400, 0, 60000),
    pageTranslationConcurrency: readNumberInput(elements.pageTranslationConcurrencyInput, 4, 1, 20),
    pageTranslationSeparator: ((elements.pageTranslationSeparatorInput?.value || '[[[SEP]]]').trim() || '[[[SEP]]]')
  };

  if (!partial.translationSystemPrompt) {
    partial.translationSystemPrompt = DEFAULT_TRANSLATION_SYSTEM_PROMPT;
  }
  if (!partial.pageTranslationSeparatorPrompt) {
    partial.pageTranslationSeparatorPrompt = DEFAULT_PAGE_TRANSLATION_SEPARATOR_PROMPT;
  }

  chrome.storage.sync.set(partial, () => {
    const target = featureStatusMessage || document.getElementById('feature-status-message') || document.getElementById('status-message');
    showStatus(target, '機能設定を保存しました', true);
  });
}
