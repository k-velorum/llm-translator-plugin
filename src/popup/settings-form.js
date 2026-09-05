import { normalizeTranslationPolicy } from '../shared/translation-policy.js';
import {
  MODEL_PROVIDER_IDS,
  PROVIDER_ORDER,
  getProviderSections,
  getProviderUi
} from './provider-ui.js';
import { restoreModelSelection } from './models.js';
import { normalizeReasoning } from '../shared/reasoning.js';

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
    pageTranslationMaxCharsInput,
    pageTranslationMaxItemsInput,
    pageTranslationDelayMsInput,
    pageTranslationConcurrencyInput,
    pageTranslationSeparatorInput
  } = elements;

  return new Promise((resolve, reject) => chrome.storage.sync.get(null, settings => {
    if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
    const apiProvider = settings.apiProvider || 'openrouter';
    apiProviderSelect.value = apiProvider;

    PROVIDER_ORDER.forEach((provider) => {
      const config = getProviderUi(provider);
      const { settingsKeys } = config;
      const apiKeyInput = elements[config.elements.apiKey];
      const serverInput = elements[config.elements.server];
      const modelSelect = elements[config.elements.model];
      const temperatureInput = elements[config.elements.temperature];
      const reasoningSelect = elements[config.elements.reasoning];
      if (reasoningSelect) reasoningSelect.value = normalizeReasoning(provider, settings[settingsKeys.reasoning]);
      if (apiKeyInput) apiKeyInput.value = settings[settingsKeys.apiKey] || '';
      if (serverInput) serverInput.value = settings[settingsKeys.server] || config.defaultServer || '';
      if (modelSelect) modelSelect.value = settings[settingsKeys.model] || '';
      if (temperatureInput) {
        temperatureInput.value = settings[settingsKeys.temperature] ?? config.defaultTemperature ?? 0.2;
      }
    });

    if (twitterFeatureCheckbox) twitterFeatureCheckbox.checked = settings.enableTwitterTranslation !== false;
    if (youtubeFeatureCheckbox) youtubeFeatureCheckbox.checked = settings.enableYoutubeTranslation !== false;

    if (translationSystemPromptTextarea) {
      translationSystemPromptTextarea.value = normalizeTranslationPolicy(settings.translationSystemPrompt);
    }
    if (pageTranslationMaxCharsInput) pageTranslationMaxCharsInput.value = (settings.pageTranslationMaxChars ?? 3500);
    if (pageTranslationMaxItemsInput) pageTranslationMaxItemsInput.value = (settings.pageTranslationMaxItemsPerChunk ?? 50);
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
    resolve(settings);
  }));
}

export function collectSettings(elements, savedSettings = {}) {
  const { apiProviderSelect, twitterFeatureCheckbox, youtubeFeatureCheckbox } = elements;
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
    if (settingsKeys.reasoning) {
      settings[settingsKeys.reasoning] = normalizeReasoning(provider,
        elements[config.elements.reasoning]?.value || savedSettings[settingsKeys.reasoning]);
    }
    if (apiKeyInput) settings[settingsKeys.apiKey] = apiKeyInput.value.trim();
    if (serverInput) settings[settingsKeys.server] = serverInput.value.trim() || config.defaultServer;
    if (modelSelect) settings[settingsKeys.model] = modelSelect.value || savedSettings[settingsKeys.model] || '';
    if (temperatureInput) {
      const temperature = Number(temperatureInput.value);
      settings[settingsKeys.temperature] = Number.isFinite(temperature)
        ? Math.max(0, Math.min(2, temperature))
        : config.defaultTemperature ?? 0.2;
    }
  });

  if (twitterFeatureCheckbox) settings.enableTwitterTranslation = !!twitterFeatureCheckbox.checked;
  if (youtubeFeatureCheckbox) settings.enableYoutubeTranslation = !!youtubeFeatureCheckbox.checked;

  return { ...settings, ...collectFeatureSettings(elements) };
}

export async function saveSettings(settings, { validateConnection = true } = {}) {
  const validation = validateApiKey(settings.apiProvider, settings);
  if (validateConnection && !validation.isValid) throw new Error(validation.message);
  await new Promise((resolve, reject) => {
    chrome.storage.sync.set(settings, () => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      resolve();
    });
  });
}

function collectFeatureSettings(elements) {
  const {
    twitterFeatureCheckbox,
    youtubeFeatureCheckbox,
    translationSystemPromptTextarea
  } = elements;

  const partial = {
    enableTwitterTranslation: !!(twitterFeatureCheckbox && twitterFeatureCheckbox.checked),
    enableYoutubeTranslation: !!(youtubeFeatureCheckbox && youtubeFeatureCheckbox.checked),
    translationSystemPrompt: normalizeTranslationPolicy(translationSystemPromptTextarea?.value),
    pageTranslationMaxChars: readNumberInput(elements.pageTranslationMaxCharsInput, 3500, 500, 32000),
    pageTranslationMaxItemsPerChunk: readNumberInput(elements.pageTranslationMaxItemsInput, 50, 5, 500),
    pageTranslationDelayMs: readNumberInput(elements.pageTranslationDelayMsInput, 400, 0, 60000),
    pageTranslationConcurrency: readNumberInput(elements.pageTranslationConcurrencyInput, 4, 1, 20),
    pageTranslationSeparator: ((elements.pageTranslationSeparatorInput?.value || '[[[SEP]]]').trim() || '[[[SEP]]]')
  };

  return partial;
}
