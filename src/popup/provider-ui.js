export const PROVIDER_ORDER = [
  'openrouter',
  'gemini',
  'cerebras',
  'zai',
  'ollama',
  'lmstudio',
  'chromePrompt'
];

export const MODEL_PROVIDER_IDS = PROVIDER_ORDER.filter((provider) => provider !== 'chromePrompt');

export const PROVIDER_UI = {
  openrouter: {
    label: 'OpenRouter',
    needsApiKey: true,
    supportsVerification: true,
    publicModelsWithoutApiKey: true,
    elements: {
      section: 'openrouterSection',
      apiKey: 'openrouterApiKeyInput',
      model: 'openrouterModelSelect',
      modelInfo: 'openrouterModelInfo'
    },
    settingsKeys: {
      apiKey: 'openrouterApiKey',
      model: 'openrouterModel'
    },
    validationMessage: 'OpenRouter APIキーを入力してください',
    testRequired: [
      { key: 'openrouterApiKey', message: 'OpenRouter APIキーが設定されていません' }
    ],
    defaultModels: [
      { id: 'openai/gpt-4o-mini', name: 'GPT 4o mini' },
      { id: 'anthropic/claude-3.5-haiku', name: 'Claude 3.5 Haiku' },
      { id: 'anthropic/claude-3.7-sonnet', name: 'Claude 3.7 Sonnet' }
    ]
  },
  gemini: {
    label: 'Google Gemini',
    needsApiKey: true,
    supportsVerification: true,
    elements: {
      section: 'geminiSection',
      apiKey: 'geminiApiKeyInput',
      model: 'geminiModelSelect',
      modelInfo: 'geminiModelInfo'
    },
    settingsKeys: {
      apiKey: 'geminiApiKey',
      model: 'geminiModel'
    },
    validationMessage: 'Gemini APIキーを入力してください',
    testRequired: [
      { key: 'geminiApiKey', message: 'Gemini APIキーが設定されていません' }
    ]
  },
  cerebras: {
    label: 'Cerebras',
    needsApiKey: true,
    supportsVerification: true,
    publicModelsWithoutApiKey: true,
    elements: {
      section: 'cerebrasSection',
      apiKey: 'cerebrasApiKeyInput',
      model: 'cerebrasModelSelect',
      modelInfo: 'cerebrasModelInfo'
    },
    settingsKeys: {
      apiKey: 'cerebrasApiKey',
      model: 'cerebrasModel'
    },
    validationMessage: 'Cerebras APIキーを入力してください',
    testRequired: [
      { key: 'cerebrasApiKey', message: 'Cerebras APIキーが設定されていません' },
      { key: 'cerebrasModel', message: 'Cerebras のモデルが設定されていません' }
    ],
    defaultModels: [
      { id: 'llama3.1-8b', name: 'llama3.1-8b' },
      { id: 'llama-3.3-70b', name: 'llama-3.3-70b' },
      { id: 'qwen-3-32b', name: 'qwen-3-32b' },
      { id: 'qwen-3-coder-480b', name: 'qwen-3-coder-480b' }
    ]
  },
  zai: {
    label: 'Z-AI',
    needsApiKey: true,
    staticModelsOnly: true,
    elements: {
      section: 'zaiSection',
      apiKey: 'zaiApiKeyInput',
      model: 'zaiModelSelect',
      modelInfo: 'zaiModelInfo'
    },
    settingsKeys: {
      apiKey: 'zaiApiKey',
      model: 'zaiModel'
    },
    validationMessage: 'Z-AI APIキーを入力してください',
    testRequired: [
      { key: 'zaiApiKey', message: 'Z-AI APIキーが設定されていません' },
      { key: 'zaiModel', message: 'Z-AI のモデルが設定されていません' }
    ],
    defaultModels: [
      { id: 'glm-4.7', name: 'glm-4.7' },
      { id: 'glm-4.7-flash', name: 'glm-4.7-flash' },
      { id: 'glm-4.7-flashx', name: 'glm-4.7-flashx' },
      { id: 'glm-4.6', name: 'glm-4.6' },
      { id: 'glm-4.5', name: 'glm-4.5' },
      { id: 'glm-4.5-air', name: 'glm-4.5-air' },
      { id: 'glm-4.5-x', name: 'glm-4.5-x' },
      { id: 'glm-4.5-airx', name: 'glm-4.5-airx' },
      { id: 'glm-4.5-flash', name: 'glm-4.5-flash' },
      { id: 'glm-4-32b-0414-128k', name: 'glm-4-32b-0414-128k' }
    ]
  },
  ollama: {
    label: 'Ollama',
    elements: {
      section: 'ollamaSection',
      server: 'ollamaServerInput',
      model: 'ollamaModelSelect',
      modelInfo: 'ollamaModelInfo'
    },
    settingsKeys: {
      server: 'ollamaServer',
      model: 'ollamaModel'
    },
    defaultServer: 'http://localhost:11434',
    testRequired: [
      { key: 'ollamaModel', message: 'Ollamaのモデルが設定されていません' }
    ]
  },
  lmstudio: {
    label: 'LM Studio',
    elements: {
      section: 'lmstudioSection',
      server: 'lmstudioServerInput',
      apiKey: 'lmstudioApiKeyInput',
      model: 'lmstudioModelSelect',
      modelInfo: 'lmstudioModelInfo'
    },
    settingsKeys: {
      server: 'lmstudioServer',
      apiKey: 'lmstudioApiKey',
      model: 'lmstudioModel'
    },
    defaultServer: 'http://localhost:1234',
    testRequired: [
      { key: 'lmstudioModel', message: 'LM Studio のモデルが設定されていません' }
    ]
  },
  chromePrompt: {
    label: 'Chrome Gemini Nano',
    elements: {
      section: 'chromePromptSection',
      temperature: 'chromePromptTemperatureInput'
    },
    settingsKeys: {
      temperature: 'chromePromptTemperature'
    },
    defaultTemperature: 0.2
  }
};

export function getProviderUi(provider) {
  return PROVIDER_UI[provider] || null;
}

export function getProviderSections(elements) {
  return Object.fromEntries(
    PROVIDER_ORDER.map((provider) => [
      provider,
      elements[PROVIDER_UI[provider].elements.section]
    ])
  );
}
