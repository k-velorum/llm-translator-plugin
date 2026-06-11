import cerebrasProvider from './providers/cerebras.js';
import chromePromptProvider from './providers/chrome-prompt.js';
import geminiProvider from './providers/gemini.js';
import lmstudioProvider from './providers/lmstudio.js';
import ollamaProvider from './providers/ollama.js';
import openrouterProvider from './providers/openrouter.js';
import zaiProvider from './providers/zai.js';

const DEFAULT_CAPABILITIES = {
  supportsStreaming: false,
  streamProtocol: null,
  supportsImageTranslation: false,
  // ページ全体翻訳の並列リクエスト上限。null は無制限（ユーザー設定に従う）。
  // ローカル推論サーバーは通常リクエストを逐次処理するため、並列に投げると
  // 互いのタイムアウトを誘発する。該当 provider は 1 に制限する。
  maxPageTranslationConcurrency: null
};

/**
 * @typedef {Object} ProviderDefinition
 * @property {string} id
 * @property {string} label
 * @property {{apiKey?: string, model?: string, server?: string}} settingsKeys
 * @property {boolean} needsApiKey
 * @property {string} [defaultServer]
 * @property {string} [fixedModel]
 * @property {{supportsStreaming: boolean, streamProtocol: string|null, supportsImageTranslation: boolean}} capabilities
 * @property {(message: Object, settings: Object) => Promise<{success: boolean, models?: Array}>} [verify]
 * @property {(message: Object, settings: Object) => Promise<Array>} [getModels]
 */

/** @type {Record<string, ProviderDefinition>} */
export const PROVIDERS = {
  openrouter: {
    id: 'openrouter',
    label: 'OpenRouter',
    settingsKeys: { apiKey: 'openrouterApiKey', model: 'openrouterModel' },
    needsApiKey: true,
    capabilities: DEFAULT_CAPABILITIES,
    ...openrouterProvider
  },
  gemini: {
    id: 'gemini',
    label: 'Google Gemini',
    settingsKeys: { apiKey: 'geminiApiKey', model: 'geminiModel' },
    needsApiKey: true,
    capabilities: DEFAULT_CAPABILITIES,
    ...geminiProvider
  },
  cerebras: {
    id: 'cerebras',
    label: 'Cerebras',
    settingsKeys: { apiKey: 'cerebrasApiKey', model: 'cerebrasModel' },
    needsApiKey: true,
    capabilities: {
      ...DEFAULT_CAPABILITIES,
      supportsStreaming: true,
      streamProtocol: 'openai-chat-sse'
    },
    ...cerebrasProvider
  },
  zai: {
    id: 'zai',
    label: 'Z-AI',
    settingsKeys: { apiKey: 'zaiApiKey', model: 'zaiModel' },
    needsApiKey: true,
    capabilities: DEFAULT_CAPABILITIES,
    ...zaiProvider
  },
  ollama: {
    id: 'ollama',
    label: 'Ollama',
    settingsKeys: { server: 'ollamaServer', model: 'ollamaModel' },
    needsApiKey: false,
    defaultServer: 'http://localhost:11434',
    capabilities: {
      ...DEFAULT_CAPABILITIES,
      maxPageTranslationConcurrency: 1
    },
    ...ollamaProvider
  },
  lmstudio: {
    id: 'lmstudio',
    label: 'LM Studio',
    settingsKeys: { apiKey: 'lmstudioApiKey', server: 'lmstudioServer', model: 'lmstudioModel' },
    needsApiKey: false,
    defaultServer: 'http://localhost:1234',
    capabilities: {
      ...DEFAULT_CAPABILITIES,
      supportsStreaming: true,
      streamProtocol: 'openai-chat-sse',
      supportsImageTranslation: true,
      maxPageTranslationConcurrency: 1
    },
    ...lmstudioProvider
  },
  chromePrompt: {
    id: 'chromePrompt',
    label: 'Chrome Gemini Nano',
    settingsKeys: {},
    needsApiKey: false,
    fixedModel: 'Gemini Nano',
    capabilities: {
      ...DEFAULT_CAPABILITIES,
      maxPageTranslationConcurrency: 1
    },
    ...chromePromptProvider
  }
};

export function getProviderDefinition(providerId) {
  return PROVIDERS[providerId] || null;
}

export function getProviderCapabilities(settings = {}) {
  const provider = getProviderDefinition(settings?.apiProvider || 'gemini');
  return { ...(provider?.capabilities || DEFAULT_CAPABILITIES) };
}
