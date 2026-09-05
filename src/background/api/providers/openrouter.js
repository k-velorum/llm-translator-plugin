import { createConfigurationError } from '../../../shared/errors.js';
import { makeApiRequest } from '../http.js';
import { createOpenAICompatibleProvider } from '../openai-compatible.js';

export const OPENROUTER_HEADERS_BASE = {
  'HTTP-Referer': 'chrome-extension://llm-translator',
  'X-Title': 'LLM Translation Plugin'
};

function getConfig(settings) {
  if (!settings.openrouterApiKey) {
    throw createConfigurationError('OpenRouter APIキーが設定されていません');
  }
  if (!settings.openrouterModel) {
    throw createConfigurationError('OpenRouter のモデルが選択されていません');
  }

  return {
    apiUrl: 'https://openrouter.ai/api/v1/chat/completions',
    model: settings.openrouterModel,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${settings.openrouterApiKey}`,
      ...OPENROUTER_HEADERS_BASE
    }
  };
}

const MODELS_URL = 'https://openrouter.ai/api/v1/models';

function getModelHeaders(apiKey) {
  const headers = { ...OPENROUTER_HEADERS_BASE };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  return headers;
}

async function verify(message) {
  const result = await makeApiRequest(
    MODELS_URL,
    {
      method: 'GET',
      headers: getModelHeaders(message.apiKey)
    },
    'OpenRouter APIキー検証中にエラーが発生'
  );

  return {
    success: true,
    models: result.data
  };
}

async function getModels(message, settings) {
  const key = message.apiKey || settings.openrouterApiKey;
  const result = await makeApiRequest(
    MODELS_URL,
    {
      method: 'GET',
      headers: getModelHeaders(key)
    },
    'OpenRouter モデル一覧取得中にエラーが発生'
  );
  return result.data;
}

export default createOpenAICompatibleProvider({
  providerLabel: 'OpenRouter',
  getConfig,
  buildTranslateBody: ({ cfg, messages }) => ({
    model: cfg.model,
    messages
  }),
  verify,
  getModels
});
