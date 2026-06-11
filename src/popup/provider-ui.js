import { DEFAULT_PROVIDER_MODELS } from './provider-default-models.js';

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
    heading: 'OpenRouter API設定',
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
    fields: [
      { kind: 'text', element: 'apiKey', label: 'OpenRouter APIキー', placeholder: 'sk-or-...' },
      { kind: 'model', element: 'model', label: 'モデル' }
    ],
    testRequired: [
      { key: 'openrouterApiKey', message: 'OpenRouter APIキーが設定されていません' }
    ],
    defaultModels: DEFAULT_PROVIDER_MODELS.openrouter
  },
  gemini: {
    label: 'Google Gemini',
    heading: 'Google Gemini API設定',
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
    fields: [
      { kind: 'text', element: 'apiKey', label: 'Gemini APIキー', placeholder: 'AIza...' },
      { kind: 'model', element: 'model', label: 'モデル' }
    ],
    testRequired: [
      { key: 'geminiApiKey', message: 'Gemini APIキーが設定されていません' }
    ]
  },
  cerebras: {
    label: 'Cerebras',
    heading: 'Cerebras API設定',
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
    fields: [
      { kind: 'text', element: 'apiKey', label: 'Cerebras APIキー', placeholder: 'your-cerebras-api-key' },
      { kind: 'model', element: 'model', label: 'モデル' }
    ],
    testRequired: [
      { key: 'cerebrasApiKey', message: 'Cerebras APIキーが設定されていません' },
      { key: 'cerebrasModel', message: 'Cerebras のモデルが設定されていません' }
    ],
    defaultModels: DEFAULT_PROVIDER_MODELS.cerebras
  },
  zai: {
    label: 'Z-AI',
    heading: 'Z-AI 設定',
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
    fields: [
      { kind: 'text', element: 'apiKey', label: 'Z-AI APIキー', placeholder: 'your-api-key' },
      { kind: 'model', element: 'model', label: 'モデル' }
    ],
    testRequired: [
      { key: 'zaiApiKey', message: 'Z-AI APIキーが設定されていません' },
      { key: 'zaiModel', message: 'Z-AI のモデルが設定されていません' }
    ],
    defaultModels: DEFAULT_PROVIDER_MODELS.zai
  },
  ollama: {
    label: 'Ollama',
    heading: 'Ollama ローカルサーバー設定',
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
    fields: [
      { kind: 'text', element: 'server', label: 'サーバーアドレス', placeholder: 'http://localhost:11434' },
      { kind: 'model', element: 'model', label: 'モデル' }
    ],
    testRequired: [
      { key: 'ollamaModel', message: 'Ollamaのモデルが設定されていません' }
    ]
  },
  lmstudio: {
    label: 'LM Studio',
    heading: 'LM Studio ローカルサーバー設定',
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
    fields: [
      { kind: 'text', element: 'server', label: 'サーバーアドレス', placeholder: 'http://localhost:1234' },
      { kind: 'text', element: 'apiKey', label: 'APIキー（任意）', placeholder: '(必要な場合のみ)' },
      { kind: 'model', element: 'model', label: 'モデル' }
    ],
    testRequired: [
      { key: 'lmstudioModel', message: 'LM Studio のモデルが設定されていません' }
    ]
  },
  chromePrompt: {
    label: 'Chrome Gemini Nano',
    heading: 'Chrome Gemini Nano 設定',
    elements: {
      section: 'chromePromptSection',
      temperature: 'chromePromptTemperatureInput'
    },
    settingsKeys: {
      temperature: 'chromePromptTemperature'
    },
    defaultTemperature: 0.2,
    fields: [
      {
        kind: 'number',
        element: 'temperature',
        label: 'temperature（0〜2、既定: 0.2）',
        placeholder: '0.2',
        min: '0',
        max: '2',
        step: '0.1',
        note: 'Chrome の Built-in Prompt API / Gemini Nano を使用します。APIキー、モデル選択、外部HTTP通信は不要です。'
      }
    ]
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

export function getProviderElementRefs(root = document) {
  return Object.fromEntries(
    PROVIDER_ORDER.flatMap((provider) => {
      const config = PROVIDER_UI[provider];
      return Object.entries(config.elements)
        .filter(([, elementName]) => Boolean(elementName))
        .map(([elementType, elementName]) => [
          elementName,
          root.getElementById(getProviderElementId(provider, elementType))
        ]);
    })
  );
}

export function renderProviderSections(container, template = document.getElementById('provider-section-template')) {
  if (!container || !template) return;
  container.innerHTML = '';

  PROVIDER_ORDER.forEach((provider, index) => {
    const config = PROVIDER_UI[provider];
    const fragment = template.content.cloneNode(true);
    const section = fragment.querySelector('.api-section');
    const heading = fragment.querySelector('.api-heading');
    section.id = getProviderElementId(provider, 'section');
    section.classList.toggle('hidden', index !== 0);
    heading.textContent = config.heading || `${config.label} 設定`;

    (config.fields || []).forEach((field) => {
      section.appendChild(createProviderField(provider, field));
    });

    container.appendChild(fragment);
  });
}

function createProviderField(provider, field) {
  const group = document.createElement('div');
  group.className = 'form-group';

  const id = getProviderElementId(provider, field.element);
  const label = document.createElement('label');
  label.htmlFor = id;
  label.textContent = field.label;
  group.appendChild(label);

  if (field.kind === 'model') {
    const select = document.createElement('select');
    select.id = id;
    select.className = 'model-select';
    const option = document.createElement('option');
    option.value = '';
    option.textContent = 'モデルを読み込み中...';
    select.appendChild(option);
    group.appendChild(select);

    const info = document.createElement('div');
    info.id = getProviderElementId(provider, 'modelInfo');
    info.className = 'model-info';
    group.appendChild(info);
    return group;
  }

  const input = document.createElement('input');
  input.type = field.kind;
  input.id = id;
  input.placeholder = field.placeholder || '';
  if (field.min !== undefined) input.min = field.min;
  if (field.max !== undefined) input.max = field.max;
  if (field.step !== undefined) input.step = field.step;
  group.appendChild(input);

  if (field.note) {
    const note = document.createElement('div');
    note.className = 'note';
    note.textContent = field.note;
    group.appendChild(note);
  }

  return group;
}

function getProviderElementId(provider, elementType) {
  if (elementType === 'section') return `${provider}-section`;
  if (elementType === 'apiKey') return `${provider}-api-key`;
  if (elementType === 'modelInfo') return `${provider}-model-info`;
  return `${provider}-${elementType}`;
}
