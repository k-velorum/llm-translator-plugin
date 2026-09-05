import { createConfigurationError } from '../../../shared/errors.js';
import { createOpenAICompatibleProvider } from '../openai-compatible.js';
import { makeApiRequest } from '../http.js';
import { getReasoningRequestOptions } from '../../../shared/reasoning.js';

const MODELS_URL = 'https://api.cerebras.ai/v1/models';
const PUBLIC_MODELS_URL = 'https://api.cerebras.ai/public/v1/models?format=openrouter';

function getConfig(settings) {
  if (!settings.cerebrasApiKey) {
    throw createConfigurationError('Cerebras APIキーが設定されていません');
  }
  if (!settings.cerebrasModel) {
    throw createConfigurationError('Cerebras のモデルが選択されていません');
  }

  return {
    apiUrl: 'https://api.cerebras.ai/v1/chat/completions',
    model: settings.cerebrasModel,
    requestBodyOptions: getReasoningRequestOptions('cerebras', settings.cerebrasReasoning),
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${settings.cerebrasApiKey}`
    }
  };
}

async function verify(message) {
  const apiKey = message.apiKey;
  if (!apiKey) {
    throw createConfigurationError('Cerebras APIキーが未指定です');
  }
  await makeApiRequest(
    MODELS_URL,
    { method: 'GET', headers: { 'Authorization': `Bearer ${apiKey}` } },
    'Cerebras APIキー検証中にエラーが発生'
  );
  return { success: true };
}

async function getModels(message, settings) {
  const apiKey = message.apiKey || settings.cerebrasApiKey;
  const endpoint = apiKey ? MODELS_URL : PUBLIC_MODELS_URL;
  const headers = apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {};
  const result = await makeApiRequest(endpoint, { method: 'GET', headers }, 'Cerebras モデル一覧取得中にエラーが発生');
  const arr = Array.isArray(result?.data)
    ? result.data
    : (Array.isArray(result?.models) ? result.models : []);
  return arr.map((model) => ({
    id: model.id,
    name: model.name || model.id,
    context_length: model.context_length,
    pricing: model.pricing
  }));
}

export default createOpenAICompatibleProvider({
  providerLabel: 'Cerebras',
  getConfig,
  verify,
  getModels
});
