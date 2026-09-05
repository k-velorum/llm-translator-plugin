import { getProviderCapabilities, getProviderDefinition } from './api/registry.js';

export { makeApiRequest, makeStreamingApiRequest, readOpenAICompatibleSSE } from './api/http.js';
export { getProviderCapabilities } from './api/registry.js';
export { OPENROUTER_HEADERS_BASE } from './api/providers/openrouter.js';

// エラー詳細のフォーマット
export function formatErrorDetails(error, settings) {
  const maskApiKey = (apiKey) => {
    if (!apiKey) return '未設定';
    if (apiKey.length <= 8) return '********';
    return apiKey.substring(0, 4) + '...' + apiKey.substring(apiKey.length - 4);
  };

  const providerId = settings?.apiProvider || 'unknown';
  const provider = getProviderDefinition(providerId);
  const serverKey = provider?.settingsKeys?.server;
  const modelKey = provider?.settingsKeys?.model;
  const apiKeyKey = provider?.settingsKeys?.apiKey;
  const apiProvider = provider
    ? serverKey
      ? `${provider.label} (${settings?.[serverKey] || provider.defaultServer})`
      : provider.label
    : providerId || '不明';
  const modelName = provider?.fixedModel || (modelKey ? settings?.[modelKey] || '未選択' : '不明');
  const maskedApiKey = apiKeyKey ? maskApiKey(settings?.[apiKeyKey]) : provider ? '不要' : '不明';

  return `
==== 翻訳エラー ====
API プロバイダー: ${apiProvider}
使用モデル: ${modelName}
APIキー: ${maskedApiKey}
エラー詳細: ${error.message || '詳細不明のエラー'}
${error.stack ? '\nスタックトレース:\n' + error.stack : ''}
==================
`;
}

// テキスト翻訳関数
export async function translateText(text, settings, requestOptions = {}) {
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
  const capabilities = getProviderCapabilities(settings);
  if (!capabilities.supportsStreaming) {
    throw new Error(`streaming is not supported for provider: ${settings?.apiProvider || 'unknown'}`);
  }
  const provider = getProviderDefinition(settings?.apiProvider);
  if (provider?.translateStream) {
    return provider.translateStream(text, settings, handlers, requestOptions);
  }
  throw new Error(`streaming is not implemented for provider: ${settings?.apiProvider || 'unknown'}`);
}

// 構造化バッチ翻訳（全Provider対応）。
// 入力: texts: string[] -> 出力: translations: (string|null)[]（同じ長さ、欠落項目は null）
export async function translateBatchStructured(texts, settings, requestOptions = {}) {
  if (!Array.isArray(texts) || texts.length === 0) return [];

  const providerId = settings?.apiProvider || 'gemini';
  const provider = getProviderDefinition(providerId);
  if (provider?.translateBatchStructured) {
    return provider.translateBatchStructured(texts, settings, requestOptions);
  }
  throw new Error(`structured batch translation is not implemented for provider: ${providerId}`);
}
