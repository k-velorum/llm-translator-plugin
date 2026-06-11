import {
  translateWithChromePromptRuntime,
  translateBatchStructuredWithChromePromptRuntime
} from './chrome-prompt-client.js';
import {
  STRUCTURED_BATCH_SCHEMA,
  buildStructuredBatchInstruction,
  buildStructuredBatchItems,
  normalizeStructuredBatchResult,
  parseJsonLoose
} from '../shared/structured-batch.js';
import { TRANSLATION_TIMEOUT_MS } from '../shared/constants.js';
import { makeApiRequest, makeStreamingApiRequest } from './api/http.js';
import { getSystemPrompt } from './api/prompt.js';
import cerebrasProvider from './api/providers/cerebras.js';
import geminiProvider from './api/providers/gemini.js';
import openrouterProvider from './api/providers/openrouter.js';
import zaiProvider from './api/providers/zai.js';
import { getProviderCapabilities } from './api/registry.js';

export { makeApiRequest, makeStreamingApiRequest, readOpenAICompatibleSSE } from './api/http.js';
export { getProviderCapabilities } from './api/registry.js';
export { OPENROUTER_HEADERS_BASE } from './api/providers/openrouter.js';

function extractChatMessageContent(data) {
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((part) => {
      if (typeof part === 'string') return part;
      if (typeof part?.text === 'string') return part.text;
      return '';
    }).join('');
  }
  if (content && typeof content === 'object') return JSON.stringify(content);
  return '';
}

function extractLmStudioRestMessageContent(data) {
  const output = Array.isArray(data?.output) ? data.output : [];

  const normalizeContent = (content) => {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return content.map((part) => {
        if (typeof part === 'string') return part;
        if (typeof part?.text === 'string') return part.text;
        if (typeof part?.content === 'string') return part.content;
        return '';
      }).join('');
    }
    if (content && typeof content === 'object' && typeof content.text === 'string') {
      return content.text;
    }
    return '';
  };

  return output
    .filter((item) => item?.type === 'message')
    .map((item) => normalizeContent(item?.content).trim())
    .filter(Boolean)
    .join('\n')
    .trim();
}

function parseStructuredBatchResponse(text, texts) {
  const parsed = parseJsonLoose(text);
  if (!parsed) {
    throw new Error('構造化出力(JSON)の解析に失敗しました');
  }
  return normalizeStructuredBatchResult(parsed, texts);
}

function getOpenAICompatibleStructuredConfig(settings) {
  if (settings.apiProvider === 'lmstudio') {
    const server = (settings.lmstudioServer || 'http://localhost:1234').replace(/\/$/, '');
    if (!settings.lmstudioModel) throw new Error('LM Studio のモデルが選択されていません');
    const headers = { 'Content-Type': 'application/json' };
    if (settings.lmstudioApiKey) headers.Authorization = `Bearer ${settings.lmstudioApiKey}`;
    return {
      providerLabel: 'LM Studio',
      apiUrl: `${server}/v1/chat/completions`,
      model: settings.lmstudioModel,
      headers
    };
  }

  throw new Error(`structured batch is not supported for provider: ${settings.apiProvider}`);
}

function getOpenAICompatibleResponseFormatCandidates() {
  const schemaFormat = {
    type: 'json_schema',
    json_schema: {
      name: 'translations',
      strict: true,
      schema: STRUCTURED_BATCH_SCHEMA
    }
  };
  const jsonObjectFormat = { type: 'json_object' };
  return [schemaFormat, jsonObjectFormat];
}

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

// Ollama (local server) での翻訳
async function translateWithOllama(text, settings, requestOptions = {}) {
  const server = (settings.ollamaServer || 'http://localhost:11434').replace(/\/$/, '');
  if (!settings.ollamaModel) {
    throw new Error('Ollamaのモデルが選択されていません');
  }

  const apiUrl = `${server}/api/generate`;
  const prompt = `${getSystemPrompt(settings)}\n\n${text}`;
  try {
    const data = await makeApiRequest(
      apiUrl,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: settings.ollamaModel,
          prompt,
          stream: false
        }),
        timeoutMs: requestOptions.timeoutMs ?? TRANSLATION_TIMEOUT_MS,
        signal: requestOptions.signal
      },
      'Ollama API リクエスト中にエラーが発生'
    );
    // stream: false の場合、response に全文が入る
    return (data.response || '').trim();
  } catch (error) {
    throw error;
  }
}

// LM Studio (OpenAI互換) での翻訳
async function translateWithLmStudio(text, settings, requestOptions = {}) {
  const server = (settings.lmstudioServer || 'http://localhost:1234').replace(/\/$/, '');
  if (!settings.lmstudioModel) {
    throw new Error('LM Studio のモデルが選択されていません');
  }

  const apiUrl = `${server}/v1/chat/completions`;
  const messages = [
    { role: 'system', content: getSystemPrompt(settings) },
    { role: 'user', content: text }
  ];

  const headers = { 'Content-Type': 'application/json' };
  if (settings.lmstudioApiKey) headers['Authorization'] = `Bearer ${settings.lmstudioApiKey}`;

  const body = JSON.stringify({
    model: settings.lmstudioModel,
    messages,
    temperature: 0.2,
    stream: false
  });

  try {
    const data = await makeApiRequest(
      apiUrl,
      { method: 'POST', headers, body, timeoutMs: requestOptions.timeoutMs ?? TRANSLATION_TIMEOUT_MS, signal: requestOptions.signal },
      'LM Studio API リクエスト中にエラーが発生'
    );
    return (data.choices?.[0]?.message?.content || '').trim();
  } catch (error) {
    throw error;
  }
}

async function translateWithLmStudioStream(text, settings, handlers = {}, requestOptions = {}) {
  const server = (settings.lmstudioServer || 'http://localhost:1234').replace(/\/$/, '');
  if (!settings.lmstudioModel) {
    throw new Error('LM Studio のモデルが選択されていません');
  }

  const apiUrl = `${server}/v1/chat/completions`;
  const messages = [
    { role: 'system', content: getSystemPrompt(settings) },
    { role: 'user', content: text }
  ];

  const headers = { 'Content-Type': 'application/json' };
  if (settings.lmstudioApiKey) headers.Authorization = `Bearer ${settings.lmstudioApiKey}`;

  return makeStreamingApiRequest(
    apiUrl,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: settings.lmstudioModel,
        messages,
        temperature: 0.2,
        stream: true
      }),
      timeoutMs: requestOptions.timeoutMs ?? TRANSLATION_TIMEOUT_MS,
      signal: requestOptions.signal
    },
    handlers,
    'LM Studio API ストリーミング中にエラーが発生'
  );
}

function buildImageTranslationPrompt() {
  return [
    'この画像に含まれるテキストを読み取り、日本語に翻訳してください。',
    '翻訳結果のみを出力してください。',
    'テキストが見当たらない場合は「翻訳対象のテキストが見つかりませんでした。」とだけ出力してください。'
  ].join('\n');
}

async function translateImageWithLmStudio(imageInput, settings, requestOptions = {}) {
  const server = (settings.lmstudioServer || 'http://localhost:1234').replace(/\/$/, '');
  if (!settings.lmstudioModel) {
    throw new Error('LM Studio のモデルが選択されていません');
  }
  if (!imageInput?.dataUrl || !imageInput?.mimeType) {
    throw new Error('画像入力データが不正です');
  }

  const apiUrl = `${server}/api/v1/chat`;
  const headers = { 'Content-Type': 'application/json' };
  if (settings.lmstudioApiKey) headers.Authorization = `Bearer ${settings.lmstudioApiKey}`;

  const body = JSON.stringify({
    model: settings.lmstudioModel,
    system_prompt: getSystemPrompt(settings),
    input: [
      {
        type: 'message',
        content: buildImageTranslationPrompt()
      },
      {
        type: 'image',
        data_url: imageInput.dataUrl
      }
    ],
    temperature: 0.2,
    stream: false
  });

  const data = await makeApiRequest(
    apiUrl,
    {
      method: 'POST',
      headers,
      body,
      timeoutMs: requestOptions.timeoutMs ?? TRANSLATION_TIMEOUT_MS,
      signal: requestOptions.signal
    },
    'LM Studio 画像翻訳 API リクエスト中にエラーが発生'
  );

  const text = extractLmStudioRestMessageContent(data);
  if (!text) {
    throw new Error('LM Studio から画像翻訳結果を取得できませんでした');
  }
  return text;
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
    return await translateWithOllama(text, settings, requestOptions);
  } else if (settings.apiProvider === 'lmstudio') {
    return await translateWithLmStudio(text, settings, requestOptions);
  } else if (settings.apiProvider === 'chromePrompt') {
    return await translateWithChromePromptRuntime(text, settings, requestOptions);
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
    return translateImageWithLmStudio(imageInput, settings, requestOptions);
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
    return translateWithLmStudioStream(text, settings, handlers, requestOptions);
  }
  throw new Error(`streaming is not implemented for provider: ${settings?.apiProvider || 'unknown'}`);
}

async function translateBatchStructuredOpenAICompatible(texts, settings, requestOptions = {}) {
  const cfg = getOpenAICompatibleStructuredConfig(settings);
  const items = buildStructuredBatchItems(texts);
  const instr = buildStructuredBatchInstruction(settings);
  const messages = [
    {
      role: 'system',
      content: 'あなたは翻訳結果を厳密なJSONとして返すアシスタントです。JSON以外は出力しないでください。'
    },
    {
      role: 'user',
      content: `${instr}\n\nitems = ${JSON.stringify(items)}`
    }
  ];

  const formats = getOpenAICompatibleResponseFormatCandidates();
  let lastError = null;

  for (let i = 0; i < formats.length; i++) {
    const responseFormat = formats[i];
    try {
      const data = await makeApiRequest(
        cfg.apiUrl,
        {
          method: 'POST',
          headers: cfg.headers,
          body: JSON.stringify({
            model: cfg.model,
            messages,
            temperature: 0.2,
            stream: false,
            response_format: responseFormat
          }),
          timeoutMs: requestOptions.timeoutMs ?? TRANSLATION_TIMEOUT_MS,
          signal: requestOptions.signal
        },
        `${cfg.providerLabel} API (structured batch) リクエスト中にエラーが発生`
      );

      return parseStructuredBatchResponse(extractChatMessageContent(data), texts);
    } catch (error) {
      if (error?.name === 'AbortError' || error?.name === 'TimeoutError') throw error;
      lastError = error;
      if (i >= formats.length - 1) break;
    }
  }

  throw lastError || new Error(`${cfg.providerLabel} structured batch translation failed`);
}

async function translateBatchStructuredOllama(texts, settings, requestOptions = {}) {
  const server = (settings.ollamaServer || 'http://localhost:11434').replace(/\/$/, '');
  if (!settings.ollamaModel) {
    throw new Error('Ollamaのモデルが選択されていません');
  }

  const apiUrl = `${server}/api/generate`;
  const items = buildStructuredBatchItems(texts);
  const instr = buildStructuredBatchInstruction(settings);
  const prompt = `${instr}\n\nitems = ${JSON.stringify(items)}`;

  const formatCandidates = [STRUCTURED_BATCH_SCHEMA, 'json'];
  let lastError = null;

  for (let i = 0; i < formatCandidates.length; i++) {
    const format = formatCandidates[i];
    try {
      const data = await makeApiRequest(
        apiUrl,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: settings.ollamaModel,
            prompt,
            stream: false,
            format
          }),
          timeoutMs: requestOptions.timeoutMs ?? TRANSLATION_TIMEOUT_MS,
          signal: requestOptions.signal
        },
        'Ollama API (structured batch) リクエスト中にエラーが発生'
      );

      const text = (data?.response ?? '').toString();
      return parseStructuredBatchResponse(text, texts);
    } catch (error) {
      if (error?.name === 'AbortError' || error?.name === 'TimeoutError') throw error;
      lastError = error;
      if (i >= formatCandidates.length - 1) break;
    }
  }

  throw lastError || new Error('Ollama structured batch translation failed');
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
    return translateBatchStructuredOpenAICompatible(texts, settings, requestOptions);
  }
  if (provider === 'ollama') {
    return translateBatchStructuredOllama(texts, settings, requestOptions);
  }
  if (provider === 'chromePrompt') {
    return translateBatchStructuredWithChromePromptRuntime(texts, settings, requestOptions);
  }
  throw new Error(`structured batch translation is not implemented for provider: ${provider}`);
}
