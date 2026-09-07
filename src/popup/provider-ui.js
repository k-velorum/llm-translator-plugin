import { CONNECTION_PRESETS } from '../shared/connections.js';

export const PROVIDER_ORDER = ['openai', 'gemini', 'chromePrompt'];
// OpenAI互換のモデル一覧は接続下書きと一緒にconnection-formが管理する。
export const MODEL_PROVIDER_IDS = ['gemini'];

export const PROVIDER_UI = {
  openai: {
    label: 'OpenAI互換', heading: 'OpenAI互換API', settingsKeys: {},
    elements: {
      section: 'openaiSection', preset: 'openaiPresetSelect', server: 'openaiServerInput',
      apiKey: 'openaiApiKeyInput', model: 'openaiModelSelect', reasoning: 'openaiReasoningSelect',
      streaming: 'openaiStreamingInput', modelInfo: 'openaiModelInfo'
    },
    fields: [
      { kind: 'select', element: 'preset', label: 'プリセット',
        options: Object.entries(CONNECTION_PRESETS).map(([id, preset]) => [id, preset.label]) },
      { kind: 'url', element: 'server', label: 'ベースURL', placeholder: 'https://api.openai.com/v1',
        note: '入力例: https://api.openai.com/v1' },
      { kind: 'password', element: 'apiKey', label: 'APIキー（必要な場合のみ）', placeholder: 'APIキー' },
      { kind: 'model', element: 'model', label: 'モデル' },
      { kind: 'select', element: 'reasoning', label: '推論（Thinking）', options: [['default', 'モデルの既定']] },
      { kind: 'checkbox', element: 'streaming', label: '生成途中から順次表示する',
        note: 'ストリーム非対応の接続先ではOFFにしてください。' }
    ]
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

    const details = document.createElement('details');
    details.className = 'connection-details';
    details.id = `${provider}-details`;
    const summary = document.createElement('summary');
    summary.textContent = '詳細設定';
    details.appendChild(summary);
    (config.fields || []).forEach((field) => {
      if (provider === 'openai' && field.element === 'preset') {
        document.getElementById('connection-preset-slot').replaceChildren(createProviderField(provider, field));
        return;
      }
      const advanced = provider === 'openai' && ['reasoning', 'streaming'].includes(field.element);
      (advanced ? details : section).appendChild(createProviderField(provider, field));
    });
    if (details.children.length > 1) section.appendChild(details);

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
    option.textContent = '';
    select.appendChild(option);
    group.appendChild(select);
    if (provider === 'openai') {
      const pricing = document.createElement('div');
      pricing.id = 'openai-model-pricing';
      pricing.className = 'model-pricing note';
      group.appendChild(pricing);
      const hint = document.createElement('div');
      hint.className = 'note';
      hint.textContent = '入力例: gpt-4o-mini';
      const refresh = document.createElement('button');
      refresh.type = 'button';
      refresh.id = 'openai-refresh-models';
      refresh.className = 'btn-secondary btn-inline';
      refresh.textContent = 'モデル一覧を取得';
      const status = document.createElement('div');
      status.id = 'openai-connection-status';
      status.className = 'note';
      status.setAttribute('role', 'status');
      group.append(hint, refresh, status);
    }

    const info = document.createElement('div');
    info.id = getProviderElementId(provider, 'modelInfo');
    info.className = 'model-info';
    const details = document.createElement('details');
    details.className = 'model-details';
    const summary = document.createElement('summary');
    summary.textContent = 'モデル情報';
    details.append(summary, info);
    group.appendChild(details);
    return group;
  }

  const input = document.createElement(field.kind === 'select' ? 'select' : 'input');
  if (field.kind === 'select') {
    for (const [value, text] of field.options) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = text;
      input.appendChild(option);
    }
  } else {
    input.type = field.kind;
  }
  input.id = id;
  if (field.kind === 'password') input.autocomplete = 'off';
  input.placeholder = field.placeholder || '';
  if (field.min !== undefined) input.min = field.min;
  if (field.max !== undefined) input.max = field.max;
  if (field.step !== undefined) input.step = field.step;
  group.appendChild(input);
  if (field.kind === 'checkbox') {
    group.classList.add('connection-checkbox');
    label.prepend(input);
  }

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
