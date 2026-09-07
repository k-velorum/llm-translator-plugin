import { normalizeReasoning, REASONING_OPTIONS } from './reasoning.js';

// UI、移行、APIの差分は同じプリセットから解決する。接続先の追加で処理を分岐させない。
export const CONNECTION_PRESETS = {
  custom: { label: 'カスタム', baseUrl: '', streaming: true, reasoning: 'custom' },
  openrouter: {
    label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', needsApiKey: true,
    model: 'openai/gpt-4o-mini', streaming: true, reasoning: 'openrouter',
    headers: { 'HTTP-Referer': 'chrome-extension://llm-translator', 'X-Title': 'LLM Translation Plugin' },
    minimalBody: true
  },
  cerebras: {
    label: 'Cerebras', baseUrl: 'https://api.cerebras.ai/v1', needsApiKey: true,
    model: 'llama3.1-8b', streaming: true, reasoning: 'cerebras',
    publicModelsUrl: 'https://api.cerebras.ai/public/v1/models?format=openrouter'
  },
  zai: {
    label: 'Z-AI', baseUrl: 'https://api.z.ai/api/paas/v4', needsApiKey: true,
    model: 'glm-4.7', streaming: false, reasoning: 'zai', jsonObjectOnly: true,
    headers: { 'Accept-Language': 'en-US,en' }, staticModels: true
  },
  lmstudio: {
    label: 'LM Studio', baseUrl: 'http://localhost:1234/v1', streaming: true,
    reasoning: 'lmstudio', legacyServer: 'lmstudioServer'
  },
  ollama: {
    label: 'Ollama', baseUrl: 'http://localhost:11434/v1', streaming: false,
    maxPageTranslationConcurrency: 1, legacyServer: 'ollamaServer'
  }
};

export const LEGACY_COMPATIBLE_IDS = Object.keys(CONNECTION_PRESETS).filter(id => id !== 'custom');

export function getConnectionPreset(id) {
  return Object.hasOwn(CONNECTION_PRESETS, id) ? CONNECTION_PRESETS[id] : CONNECTION_PRESETS.custom;
}

export function defaultConnection(id) {
  const preset = getConnectionPreset(id);
  return { baseUrl: preset.baseUrl, apiKey: '', model: preset.model || '',
    reasoning: 'default', streaming: preset.streaming };
}

export function legacyBaseUrl(server) {
  const base = String(server).trim().replace(/\/+$/, '');
  return base.endsWith('/v1') ? base : `${base}/v1`;
}

// 旧キーは削除せず読み替える。新しい保存値があれば、空欄も含めてそちらを優先する。
export function normalizeConnectionSettings(settings = {}) {
  const connections = { ...settings.openaiConnections };
  for (const id of Object.keys(CONNECTION_PRESETS)) {
    const preset = getConnectionPreset(id);
    const legacy = {
      ...defaultConnection(id),
      apiKey: settings[`${id}ApiKey`] || '',
      model: settings[`${id}Model`] ?? preset.model ?? '',
      reasoning: normalizeReasoning(preset.reasoning, settings[`${id}Reasoning`])
    };
    if (preset.legacyServer && settings[preset.legacyServer]) {
      legacy.baseUrl = legacyBaseUrl(settings[preset.legacyServer]);
    }
    connections[id] = { ...legacy, ...connections[id] };
  }
  const legacyProvider = LEGACY_COMPATIBLE_IDS.includes(settings.apiProvider);
  return {
    ...settings,
    apiProvider: legacyProvider || !settings.apiProvider ? 'openai' : settings.apiProvider,
    openaiPreset: legacyProvider ? settings.apiProvider
      : Object.hasOwn(CONNECTION_PRESETS, settings.openaiPreset) ? settings.openaiPreset : 'openrouter',
    openaiConnections: connections
  };
}

export function getActiveConnection(settings = {}) {
  const normalized = normalizeConnectionSettings(settings);
  const presetId = normalized.openaiPreset;
  const preset = getConnectionPreset(presetId);
  const connection = normalized.openaiConnections[presetId] || defaultConnection(presetId);
  return { ...connection, presetId, preset };
}

export function normalizeBaseUrl(value) {
  let url;
  try { url = new URL(String(value).trim()); } catch { throw new Error('ベースURLを入力してください（http:// または https://）'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('ベースURLにはHTTP(S)のURLを指定してください。認証情報・クエリ・フラグメントは使用できません。');
  }
  const baseUrl = url.href.replace(/\/+$/, '');
  if (/\/(chat\/completions|models)$/.test(baseUrl)) {
    throw new Error('ベースURLは /chat/completions や /models を除いた部分を入力してください。');
  }
  return baseUrl;
}

export function validateConnection(connection, { requireModel = true } = {}) {
  normalizeBaseUrl(connection.baseUrl);
  if (connection.preset.needsApiKey && !connection.apiKey?.trim()) {
    throw new Error(`${connection.preset.label} APIキーを入力してください`);
  }
  if (requireModel && !connection.model?.trim()) throw new Error('モデルを選択または入力してください');
}

export function connectionReasoningOptions(presetId) {
  return REASONING_OPTIONS[getConnectionPreset(presetId).reasoning] || [['default', 'モデルの既定']];
}

export function getConnectionCapabilities(settings) {
  const connection = getActiveConnection(settings);
  return {
    supportsStreaming: connection.streaming !== false,
    streamProtocol: connection.streaming !== false ? 'openai-chat-sse' : null,
    // 拡張の送信経路の対応を示す。画像を扱えるかは選択中のモデル・サーバーに依存する。
    supportsImageTranslation: true,
    maxPageTranslationConcurrency: connection.preset.maxPageTranslationConcurrency || null
  };
}
