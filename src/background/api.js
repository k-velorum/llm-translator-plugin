import cerebrasProvider from './api/providers/cerebras.js';
import chromePromptProvider from './api/providers/chrome-prompt.js';
import geminiProvider from './api/providers/gemini.js';
import lmstudioProvider from './api/providers/lmstudio.js';
import ollamaProvider from './api/providers/ollama.js';
import openrouterProvider from './api/providers/openrouter.js';
import zaiProvider from './api/providers/zai.js';
import { getProviderCapabilities } from './api/registry.js';

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

  let apiProvider, modelName, maskedApiKey;

  if (settings.apiProvider === 'openrouter') {
    apiProvider = 'OpenRouter';
    modelName = settings.openrouterModel;
    maskedApiKey = maskApiKey(settings.openrouterApiKey);
  } else if (settings.apiProvider === 'gemini') {
    apiProvider = 'Google Gemini';
    modelName = settings.geminiModel;
    maskedApiKey = maskApiKey(settings.geminiApiKey);
  } else if (settings.apiProvider === 'cerebras') {
    apiProvider = 'Cerebras';
    modelName = settings.cerebrasModel;
    maskedApiKey = maskApiKey(settings.cerebrasApiKey);
  } else if (settings.apiProvider === 'zai') {
    apiProvider = 'Z-AI';
    modelName = settings.zaiModel;
    maskedApiKey = maskApiKey(settings.zaiApiKey);
  } else if (settings.apiProvider === 'ollama') {
    apiProvider = `Ollama (${settings.ollamaServer || 'http://localhost:11434'})`;
    modelName = settings.ollamaModel || '未選択';
    maskedApiKey = '不要';
  } else if (settings.apiProvider === 'lmstudio') {
    apiProvider = `LM Studio (${settings.lmstudioServer || 'http://localhost:1234'})`;
    modelName = settings.lmstudioModel || '未選択';
    maskedApiKey = maskApiKey(settings.lmstudioApiKey);
  } else if (settings.apiProvider === 'chromePrompt') {
    apiProvider = 'Chrome Gemini Nano';
    modelName = 'Gemini Nano';
    maskedApiKey = '不要';
  } else {
    apiProvider = settings?.apiProvider || '不明';
    modelName = '不明';
    maskedApiKey = '不明';
  }

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
  if (settings.apiProvider === 'openrouter') {
    return await openrouterProvider.translate(text, settings, requestOptions);
  } else if (settings.apiProvider === 'cerebras') {
    return await cerebrasProvider.translate(text, settings, requestOptions);
  } else if (settings.apiProvider === 'zai') {
    return await zaiProvider.translate(text, settings, requestOptions);
  } else if (settings.apiProvider === 'ollama') {
    return await ollamaProvider.translate(text, settings, requestOptions);
  } else if (settings.apiProvider === 'lmstudio') {
    return await lmstudioProvider.translate(text, settings, requestOptions);
  } else if (settings.apiProvider === 'chromePrompt') {
    return await chromePromptProvider.translate(text, settings, requestOptions);
  } else {
    return await geminiProvider.translate(text, settings, requestOptions);
  }
}

export async function translateImage(imageInput, settings, requestOptions = {}) {
  const capabilities = getProviderCapabilities(settings);
  if (!capabilities.supportsImageTranslation) {
    throw new Error(`現在のプロバイダー (${settings?.apiProvider || 'unknown'}) は画像翻訳に対応していません`);
  }

  if (settings.apiProvider === 'lmstudio') {
    return lmstudioProvider.translateImage(imageInput, settings, requestOptions);
  }

  throw new Error(`画像翻訳は未実装のプロバイダーです: ${settings?.apiProvider || 'unknown'}`);
}

export async function translateTextStream(text, settings, handlers = {}, requestOptions = {}) {
  const capabilities = getProviderCapabilities(settings);
  if (!capabilities.supportsStreaming) {
    throw new Error(`streaming is not supported for provider: ${settings?.apiProvider || 'unknown'}`);
  }
  if (settings.apiProvider === 'cerebras') {
    return cerebrasProvider.translateStream(text, settings, handlers, requestOptions);
  }
  if (settings.apiProvider === 'lmstudio') {
    return lmstudioProvider.translateStream(text, settings, handlers, requestOptions);
  }
  throw new Error(`streaming is not implemented for provider: ${settings?.apiProvider || 'unknown'}`);
}

// 構造化バッチ翻訳（全Provider対応）。
// 入力: texts: string[] -> 出力: translations: string[]（同じ長さ）
export async function translateBatchStructured(texts, settings, requestOptions = {}) {
  if (!Array.isArray(texts) || texts.length === 0) return [];

  const provider = settings?.apiProvider || 'gemini';
  if (provider === 'gemini') {
    return geminiProvider.translateBatchStructured(texts, settings, requestOptions);
  }
  if (provider === 'cerebras') {
    return cerebrasProvider.translateBatchStructured(texts, settings, requestOptions);
  }
  if (provider === 'openrouter') {
    return openrouterProvider.translateBatchStructured(texts, settings, requestOptions);
  }
  if (provider === 'zai') {
    return zaiProvider.translateBatchStructured(texts, settings, requestOptions);
  }
  if (provider === 'lmstudio') {
    return lmstudioProvider.translateBatchStructured(texts, settings, requestOptions);
  }
  if (provider === 'ollama') {
    return ollamaProvider.translateBatchStructured(texts, settings, requestOptions);
  }
  if (provider === 'chromePrompt') {
    return chromePromptProvider.translateBatchStructured(texts, settings, requestOptions);
  }
  throw new Error(`structured batch translation is not implemented for provider: ${provider}`);
}
