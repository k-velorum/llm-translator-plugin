import { getActiveConnection } from '../shared/connections.js';
import { formatUserError } from '../shared/errors.js';
import { getProviderCapabilities, getProviderDefinition } from './api/registry.js';

export { makeApiRequest, makeStreamingApiRequest, readOpenAICompatibleSSE } from './api/http.js';
export { getProviderCapabilities } from './api/registry.js';
export { OPENROUTER_HEADERS_BASE } from './api/providers/openrouter.js';

// エラー詳細のフォーマット
export function formatErrorDetails(error, settings) {
  const providerId = settings?.apiProvider || 'unknown';
  const provider = getProviderDefinition(providerId);
  const connection = providerId === 'openai' ? getActiveConnection(settings) : null;
  const serverKey = provider?.settingsKeys?.server;
  const modelKey = provider?.settingsKeys?.model;
  const apiKeyKey = provider?.settingsKeys?.apiKey;
  const apiProvider = connection ? `${connection.preset.label} (${connection.baseUrl})` : provider
    ? serverKey
      ? `${provider.label} (${settings?.[serverKey] || provider.defaultServer})`
      : provider.label
    : providerId || '不明';
  const modelName = connection?.model || provider?.fixedModel || (modelKey ? settings?.[modelKey] || '未選択' : '不明');
  const maskedApiKey = connection ? (connection.apiKey ? '設定済み' : '未設定') : apiKeyKey ? (settings?.[apiKeyKey] ? '設定済み' : '未設定') : provider ? '不要' : '不明';

  return `
==== 翻訳エラー ====
API プロバイダー: ${apiProvider}
使用モデル: ${modelName}
APIキー: ${maskedApiKey}
エラー詳細: ${formatUserError(error)}
${error.stack ? '\nスタックトレース:\n' + error.stack : ''}
==================
`;
}

// requestOptions.messages は user/assistant の会話履歴（今回の入力を含む）。
// system 指示は settings から各 provider が一度だけ付ける。未指定なら text を単発入力として扱う。
// テキスト翻訳関数
export async function translateText(text, settings, requestOptions = {}) {
  if (requestOptions.onDelta) {
    return translateTextStream(text, settings, { onDelta: requestOptions.onDelta }, requestOptions);
  }
  const provider = getProviderDefinition(settings?.apiProvider) || getProviderDefinition('gemini');
  return await provider.translate(text, settings, requestOptions);
}

export async function translateImage(imageInput, settings, requestOptions = {}) {
  const capabilities = getProviderCapabilities(settings);
  if (!capabilities.supportsImageTranslation) {
    throw new Error(`現在のプロバイダー (${settings?.apiProvider || 'unknown'}) は画像翻訳に対応していません`);
  }

  const provider = getProviderDefinition(settings?.apiProvider);
  if (provider?.translateImage) {
    return provider.translateImage(imageInput, settings, requestOptions);
  }

  throw new Error(`画像翻訳は未実装のプロバイダーです: ${settings?.apiProvider || 'unknown'}`);
}

export async function translateTextStream(text, settings, handlers = {}, requestOptions = {}) {
  return translateWithUpdates('translate', 'translateStream', text, settings, handlers, requestOptions);
}

// 表示側は通信方式を判断しない。非対応の場合も同じ更新・完了の契約で一括結果を返す。
// 通信エラー時の自動再送は、二重課金や生成途中の結果の混在につながるため行わない。
async function translateWithUpdates(method, streamMethod, input, settings, handlers, requestOptions) {
  const provider = getProviderDefinition(settings?.apiProvider);
  if (!provider?.[method]) throw new Error(`翻訳経路が未実装です: ${settings?.apiProvider || 'unknown'}`);
  const streaming = getProviderCapabilities(settings).supportsStreaming && provider[streamMethod];
  const result = streaming
    ? await provider[streamMethod](input, settings, { ...handlers, onDone: undefined }, requestOptions)
    : await provider[method](input, settings, requestOptions);
  if (requestOptions.signal?.aborted) throw new DOMException('The operation was aborted', 'AbortError');
  if (!streaming) await handlers.onDelta?.(result, result);
  await handlers.onDone?.(result);
  return result;
}

export async function translateImageStream(imageInput, settings, handlers = {}, requestOptions = {}) {
  if (!getProviderCapabilities(settings).supportsImageTranslation) {
    throw new Error(`現在のプロバイダー (${settings?.apiProvider || 'unknown'}) は画像翻訳に対応していません`);
  }
  return translateWithUpdates('translateImage', 'translateImageStream', imageInput, settings, handlers, requestOptions);
}

// 構造化バッチ翻訳（全Provider対応）。
// 入力: texts: string[] -> 出力: translations: (string|null)[]（同じ長さ、欠落項目は null）
export async function translateBatchStructured(texts, settings, requestOptions = {}) {
  if (!Array.isArray(texts) || texts.length === 0) return [];

  const providerId = settings?.apiProvider || 'gemini';
  const provider = getProviderDefinition(providerId);
  if (requestOptions.onDelta && getProviderCapabilities(settings).supportsStreaming && provider?.translateBatchStructuredStream) {
    return provider.translateBatchStructuredStream(texts, settings, { onDelta: requestOptions.onDelta }, requestOptions);
  }
  if (provider?.translateBatchStructured) {
    return provider.translateBatchStructured(texts, settings, requestOptions);
  }
  throw new Error(`structured batch translation is not implemented for provider: ${providerId}`);
}
