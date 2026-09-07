import chromePromptProvider from './providers/chrome-prompt.js';
import geminiProvider from './providers/gemini.js';
import openaiProvider from './providers/openai.js';
import { createLegacyCompatibleProvider } from './legacy-compatible.js';
import {
  LEGACY_COMPATIBLE_IDS, getConnectionPreset, getConnectionCapabilities
} from '../../shared/connections.js';

const DEFAULT_CAPABILITIES = {
  supportsStreaming: false,
  streamProtocol: null,
  supportsImageTranslation: false,
  maxPageTranslationConcurrency: null
};

export const PROVIDERS = {
  openai: {
    id: 'openai', label: 'OpenAI互換', settingsKeys: {},
    capabilities: DEFAULT_CAPABILITIES,
    ...openaiProvider
  },
  gemini: {
    id: 'gemini', label: 'Google Gemini',
    settingsKeys: { apiKey: 'geminiApiKey', model: 'geminiModel' },
    needsApiKey: true,
    capabilities: DEFAULT_CAPABILITIES,
    ...geminiProvider
  },
  chromePrompt: {
    id: 'chromePrompt', label: 'Chrome Gemini Nano', settingsKeys: {},
    needsApiKey: false, fixedModel: 'Gemini Nano',
    capabilities: { ...DEFAULT_CAPABILITIES, supportsImageTranslation: true, maxPageTranslationConcurrency: 1 },
    ...chromePromptProvider
  }
};

// 新規設定では使わず、旧設定を含む再試行・実行中セッションとの互換に限定する。
const legacyProviders = Object.fromEntries(LEGACY_COMPATIBLE_IDS.map(id => {
  const preset = getConnectionPreset(id);
  const settingsKeys = { model: `${id}Model` };
  if (id !== 'ollama') settingsKeys.apiKey = `${id}ApiKey`;
  if (preset.legacyServer) settingsKeys.server = preset.legacyServer;
  return [id, { id, label: preset.label, settingsKeys, needsApiKey: !!preset.needsApiKey,
    defaultServer: preset.legacyServer ? preset.baseUrl.replace(/\/v1$/, '') : undefined,
    capabilities: getConnectionCapabilities({ apiProvider: id }),
    ...createLegacyCompatibleProvider(id) }];
}));

export function getProviderDefinition(providerId) {
  return PROVIDERS[providerId] || legacyProviders[providerId] || null;
}

export function getProviderCapabilities(settings = {}) {
  if (settings.apiProvider === 'openai' || LEGACY_COMPATIBLE_IDS.includes(settings.apiProvider)) {
    return getConnectionCapabilities(settings);
  }
  const provider = getProviderDefinition(settings.apiProvider);
  return { ...(provider?.capabilities || DEFAULT_CAPABILITIES) };
}
