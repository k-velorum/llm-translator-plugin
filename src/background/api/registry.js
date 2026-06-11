const DEFAULT_CAPABILITIES = {
  supportsStreaming: false,
  streamProtocol: null,
  supportsImageTranslation: false
};

/**
 * @typedef {Object} ProviderDefinition
 * @property {string} id
 * @property {string} label
 * @property {{apiKey?: string, model?: string, server?: string}} settingsKeys
 * @property {boolean} needsApiKey
 * @property {{supportsStreaming: boolean, streamProtocol: string|null, supportsImageTranslation: boolean}} capabilities
 */

/** @type {Record<string, ProviderDefinition>} */
export const PROVIDERS = {
  openrouter: {
    id: 'openrouter',
    label: 'OpenRouter',
    settingsKeys: { apiKey: 'openrouterApiKey', model: 'openrouterModel' },
    needsApiKey: true,
    capabilities: DEFAULT_CAPABILITIES
  },
  gemini: {
    id: 'gemini',
    label: 'Google Gemini',
    settingsKeys: { apiKey: 'geminiApiKey', model: 'geminiModel' },
    needsApiKey: true,
    capabilities: DEFAULT_CAPABILITIES
  },
  cerebras: {
    id: 'cerebras',
    label: 'Cerebras',
    settingsKeys: { apiKey: 'cerebrasApiKey', model: 'cerebrasModel' },
    needsApiKey: true,
    capabilities: {
      supportsStreaming: true,
      streamProtocol: 'openai-chat-sse',
      supportsImageTranslation: false
    }
  },
  zai: {
    id: 'zai',
    label: 'Z-AI',
    settingsKeys: { apiKey: 'zaiApiKey', model: 'zaiModel' },
    needsApiKey: true,
    capabilities: DEFAULT_CAPABILITIES
  },
  ollama: {
    id: 'ollama',
    label: 'Ollama',
    settingsKeys: { server: 'ollamaServer', model: 'ollamaModel' },
    needsApiKey: false,
    capabilities: DEFAULT_CAPABILITIES
  },
  lmstudio: {
    id: 'lmstudio',
    label: 'LM Studio',
    settingsKeys: { apiKey: 'lmstudioApiKey', server: 'lmstudioServer', model: 'lmstudioModel' },
    needsApiKey: false,
    capabilities: {
      supportsStreaming: true,
      streamProtocol: 'openai-chat-sse',
      supportsImageTranslation: true
    }
  },
  chromePrompt: {
    id: 'chromePrompt',
    label: 'Chrome Gemini Nano',
    settingsKeys: {},
    needsApiKey: false,
    capabilities: DEFAULT_CAPABILITIES
  }
};

export function getProviderDefinition(providerId) {
  return PROVIDERS[providerId] || null;
}

export function getProviderCapabilities(settings = {}) {
  const provider = getProviderDefinition(settings?.apiProvider || 'gemini');
  return { ...(provider?.capabilities || DEFAULT_CAPABILITIES) };
}
