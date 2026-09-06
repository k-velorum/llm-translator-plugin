import { createConfigurationError } from '../../../shared/errors.js';
import { getActiveConnection, normalizeBaseUrl, validateConnection } from '../../../shared/connections.js';
import { getReasoningRequestOptions } from '../../../shared/reasoning.js';
import { PROVIDER_AVAILABILITY_TIMEOUT_MS } from '../../../shared/constants.js';
import { createOpenAICompatibleProvider } from '../openai-compatible.js';
import { makeApiRequest } from '../http.js';
import { translateImage as translateLMStudioImage } from './lmstudio-image.js';
import { DEFAULT_PROVIDER_MODELS } from '../../../shared/default-models.js';

function getHeaders(connection, { json = false } = {}) {
  const headers = { ...connection.preset.headers };
  if (json) headers['Content-Type'] = 'application/json';
  if (connection.apiKey) headers.Authorization = `Bearer ${connection.apiKey}`;
  return headers;
}

function getConfig(settings) {
  const connection = getActiveConnection(settings);
  try { validateConnection(connection); } catch (error) { throw createConfigurationError(error.message); }
  return {
    apiUrl: `${normalizeBaseUrl(connection.baseUrl)}/chat/completions`,
    model: connection.model,
    headers: getHeaders(connection, { json: true }),
    requestBodyOptions: getReasoningRequestOptions(connection.preset.reasoning, connection.reasoning)
  };
}

async function getModels(message, settings) {
  // popupの下書きは完全な接続情報として受け取る。空のキーを保存済みキーで補わない。
  const connection = message.connection
    ? getActiveConnection({ apiProvider: 'openai', openaiPreset: message.presetId || 'custom',
      openaiConnections: { [message.presetId || 'custom']: message.connection } })
    : getActiveConnection(settings);
  const baseUrl = normalizeBaseUrl(connection.baseUrl);
  const isDefaultEndpoint = baseUrl === connection.preset.baseUrl;
  if (isDefaultEndpoint && connection.preset.staticModels) {
    return DEFAULT_PROVIDER_MODELS[connection.presetId] || [];
  }
  const url = isDefaultEndpoint && !connection.apiKey && connection.preset.publicModelsUrl
    ? connection.preset.publicModelsUrl : `${baseUrl}/models`;
  const result = await makeApiRequest(url, {
    method: 'GET', headers: getHeaders(connection), timeoutMs: PROVIDER_AVAILABILITY_TIMEOUT_MS,
    redirect: 'error'
  }, 'モデル一覧を取得できませんでした', 'info');
  const models = Array.isArray(result?.data) ? result.data : result?.models;
  if (!Array.isArray(models)) throw new Error('モデル一覧の応答形式に対応していません。モデルIDを直接入力してください。');
  return models.filter(model => typeof model?.id === 'string').map(model => ({ ...model, name: model.name || model.id }));
}

async function translateImage(imageInput, settings, requestOptions) {
  const connection = getActiveConnection(settings);
  validateConnection(connection);
  const baseUrl = normalizeBaseUrl(connection.baseUrl);
  if (!connection.preset.nativeImages || !baseUrl.endsWith('/v1')) {
    throw createConfigurationError('画像翻訳はLM Studioプリセットで /v1 を含むベースURLを指定してください');
  }
  return translateLMStudioImage(imageInput, {
    ...settings,
    lmstudioServer: baseUrl.slice(0, -3),
    lmstudioApiKey: connection.apiKey,
    lmstudioModel: connection.model,
    lmstudioReasoning: connection.reasoning
  }, requestOptions);
}

export default createOpenAICompatibleProvider({
  providerLabel: 'OpenAI互換',
  getConfig,
  buildTranslateBody: ({ cfg, messages, settings }) => ({
    model: cfg.model, messages,
    ...(getActiveConnection(settings).preset.minimalBody ? {} : { temperature: 0.2, stream: false })
  }),
  responseFormatCandidates: (settings) => getActiveConnection(settings).preset.jsonObjectOnly
    ? [{ type: 'json_object' }] : undefined,
  getModels,
  translateImage
});
