import { DEFAULT_SETTINGS } from './settings.js';

// 共通プロンプト取得（設定のカスタムがあれば優先）
function getSystemPrompt(settings) {
  const v = (settings && settings.translationSystemPrompt) || DEFAULT_SETTINGS.translationSystemPrompt;
  return (typeof v === 'string' && v.trim().length) ? v : DEFAULT_SETTINGS.translationSystemPrompt;
}

export function getProviderCapabilities(settings = {}) {
  const provider = settings?.apiProvider || 'gemini';
  if (provider === 'lmstudio' || provider === 'cerebras') {
    return {
      supportsStreaming: true,
      streamProtocol: 'openai-chat-sse',
      supportsImageTranslation: provider === 'lmstudio'
    };
  }
  return {
    supportsStreaming: false,
    streamProtocol: null,
    supportsImageTranslation: false
  };
}
const OPENROUTER_HEADERS_BASE = {
  'HTTP-Referer': 'chrome-extension://llm-translator',
  'X-Title': 'LLM Translation Plugin'
};

const STRUCTURED_BATCH_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'integer' },
          translation: { type: 'string' }
        },
        required: ['id', 'translation']
      }
    }
  },
  required: ['items']
};

function buildStructuredBatchItems(texts) {
  return texts.map((t, i) => ({ id: i, text: t }));
}

function buildStructuredBatchInstruction(settings) {
  const defaultPrompt = DEFAULT_SETTINGS.translationSystemPrompt;
  const customPrompt = (settings?.translationSystemPrompt || '').trim();
  const policy = (customPrompt && customPrompt !== defaultPrompt)
    ? customPrompt
    : '指示された文章を日本語に翻訳してください。翻訳結果のみを返してください。';
  return [
    'あなたは優秀な翻訳者です。与えられた JSON 配列 items の各要素を日本語に翻訳してください。',
    '出力は JSON のみで、オブジェクト形式 {"items":[{"id": number, "translation": string}]} にしてください。',
    '重要: 入力の id をそのまま維持し、items の件数は入力と同じにします。不要な説明文は一切出力しないでください。',
    'HTMLタグやコードブロックなどのマークアップは保持し、意味を変えないように訳してください。',
    `翻訳方針: ${policy}`
  ].join('\n');
}

function parseJsonLoose(s) {
  if (typeof s !== 'string') return null;
  const input = s.trim();
  if (!input) return null;

  const tried = new Set();
  const tryCandidate = (candidate) => {
    const c = (candidate || '').trim();
    if (!c || tried.has(c)) return null;
    tried.add(c);
    try { return JSON.parse(c); } catch (_) {}
    return null;
  };

  const direct = tryCandidate(input);
  if (direct !== null) return direct;

  for (const m of input.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) {
    const parsed = tryCandidate(m[1] || '');
    if (parsed !== null) return parsed;
  }

  const objStart = input.indexOf('{');
  const arrStart = input.indexOf('[');
  const preferArray = arrStart >= 0 && (objStart < 0 || arrStart < objStart);

  const trySliceByBounds = (openChar, closeChar) => {
    const start = input.indexOf(openChar);
    const end = input.lastIndexOf(closeChar);
    if (start >= 0 && end > start) {
      const parsed = tryCandidate(input.slice(start, end + 1));
      if (parsed !== null) return parsed;
    }
    return null;
  };

  if (preferArray) {
    const parsedArray = trySliceByBounds('[', ']');
    if (parsedArray !== null) return parsedArray;
    const parsedObj = trySliceByBounds('{', '}');
    if (parsedObj !== null) return parsedObj;
  } else {
    const parsedObj = trySliceByBounds('{', '}');
    if (parsedObj !== null) return parsedObj;
    const parsedArray = trySliceByBounds('[', ']');
    if (parsedArray !== null) return parsedArray;
  }

  // ここまでで解析できない場合は null を返し、上位でフォールバックする。
  return null;
}

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

function normalizeOpenAICompatibleDeltaText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((part) => {
      if (typeof part === 'string') return part;
      if (typeof part?.text === 'string') return part.text;
      return '';
    }).join('');
  }
  if (content && typeof content === 'object' && typeof content.text === 'string') {
    return content.text;
  }
  return '';
}

function normalizeStructuredBatchResult(parsed, texts) {
  const arr = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.items) ? parsed.items : null);
  if (!arr) {
    throw new Error('構造化出力に配列(items)が見つかりません');
  }

  const out = new Array(texts.length);
  const seen = new Set();
  for (const it of arr) {
    const id = it?.id;
    const tr = it?.translation;
    if (!Number.isInteger(id) || id < 0 || id >= out.length || typeof tr !== 'string') continue;
    if (seen.has(id)) continue;
    out[id] = tr.trim();
    seen.add(id);
  }

  if (seen.size === 0) {
    throw new Error('構造化出力の id が有効に取得できませんでした');
  }

  if (seen.size < texts.length) {
    const missing = [];
    for (let i = 0; i < texts.length; i++) {
      if (!seen.has(i)) {
        out[i] = texts[i];
        missing.push(i);
      }
    }
    const missingRatio = missing.length / texts.length;
    if (missingRatio >= 0.5) {
      throw new Error(`構造化出力の id 欠落率が高すぎます (${missing.length}/${texts.length})`);
    }
    console.warn(
      `構造化出力の id が不足しています。原文で補完します: [${missing.join(',')}] ratio=${missingRatio.toFixed(2)}`
    );
  }

  return out;
}

function parseStructuredBatchResponse(text, texts) {
  const parsed = parseJsonLoose(text);
  if (!parsed) {
    throw new Error('構造化出力(JSON)の解析に失敗しました');
  }
  return normalizeStructuredBatchResult(parsed, texts);
}

function getOpenAICompatibleStructuredConfig(settings) {
  if (settings.apiProvider === 'openrouter') {
    if (!settings.openrouterApiKey) throw new Error('OpenRouter APIキーが設定されていません');
    if (!settings.openrouterModel) throw new Error('OpenRouter のモデルが選択されていません');
    return {
      providerLabel: 'OpenRouter',
      apiUrl: 'https://openrouter.ai/api/v1/chat/completions',
      model: settings.openrouterModel,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${settings.openrouterApiKey}`,
        ...OPENROUTER_HEADERS_BASE
      }
    };
  }

  if (settings.apiProvider === 'cerebras') {
    if (!settings.cerebrasApiKey) throw new Error('Cerebras APIキーが設定されていません');
    if (!settings.cerebrasModel) throw new Error('Cerebras のモデルが選択されていません');
    return {
      providerLabel: 'Cerebras',
      apiUrl: 'https://api.cerebras.ai/v1/chat/completions',
      model: settings.cerebrasModel,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${settings.cerebrasApiKey}`
      }
    };
  }

  if (settings.apiProvider === 'zai') {
    if (!settings.zaiApiKey) throw new Error('Z-AI APIキーが設定されていません');
    if (!settings.zaiModel) throw new Error('Z-AIのモデルが選択されていません');
    return {
      providerLabel: 'Z-AI',
      apiUrl: 'https://api.z.ai/api/paas/v4/chat/completions',
      model: settings.zaiModel,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${settings.zaiApiKey}`,
        'Accept-Language': 'en-US,en'
      }
    };
  }

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

function getOpenAICompatibleResponseFormatCandidates(settings) {
  const schemaFormat = {
    type: 'json_schema',
    json_schema: {
      name: 'translations',
      strict: true,
      schema: STRUCTURED_BATCH_SCHEMA
    }
  };
  const jsonObjectFormat = { type: 'json_object' };
  if (settings.apiProvider === 'zai') return [jsonObjectFormat];
  return [schemaFormat, jsonObjectFormat];
}

// 以前のプロキシフォールバックは削除（直接アクセスのみ）

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
  } else if (settings.apiProvider === 'anthropic') {
    apiProvider = 'Anthropic';
    modelName = settings.anthropicModel;
    maskedApiKey = maskApiKey(settings.anthropicApiKey);
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

// APIリクエスト共通処理
export async function makeApiRequest(url, options = {}, errorMessage, logLevel = 'error') {
  const logger = (console[logLevel] || console.error).bind(console);

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const maxRetries = 3;

  const timeoutMs = Number.isFinite(options?.timeoutMs) ? options.timeoutMs : null;
  const externalSignal = options?.signal;

  // fetch() へ渡すオプション（timeoutMs は独自）
  const baseOptions = { ...(options || {}) };
  delete baseOptions.timeoutMs;
  delete baseOptions.signal;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let timeoutId = null;
    let timedOut = false;

    const controller = new AbortController();
    const onExternalAbort = () => controller.abort();

    try {
      if (externalSignal) {
        if (externalSignal.aborted) {
          controller.abort();
        } else {
          externalSignal.addEventListener('abort', onExternalAbort, { once: true });
        }
      }

      if (timeoutMs && timeoutMs > 0) {
        timeoutId = setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, timeoutMs);
      }

      const response = await fetch(url, { ...baseOptions, signal: controller.signal });

      if (!response.ok) {
        // Ollama の CORS で 403 が出やすいため、分かりやすいヒントを付与
        if (response.status === 403 && /\/api\/(generate|tags)/.test(url)) {
          throw new Error(
            'API Error: 403 Forbidden - おそらくOllamaのCORS設定が原因です。\n' +
            '環境変数 OLLAMA_ORIGINS を設定してサーバーを起動してください。例:\n' +
            '  macOS/Linux:  OLLAMA_ORIGINS=* ollama serve\n' +
            '  Windows(PowerShell):  $env:OLLAMA_ORIGINS="*"; ollama serve\n' +
            '特定の拡張IDのみ許可する場合は chrome-extension://<拡張ID> を指定してください。'
          );
        }

        // 429/5xx はリトライ（Retry-After ヘッダを尊重）
        if (response.status === 429 || (response.status >= 500 && response.status < 600)) {
          const retryAfter = response.headers.get('Retry-After');
          const baseDelay = retryAfter ? Math.min(5000, parseInt(retryAfter, 10) * 1000 || 0) : 0;
          const backoff = baseDelay || Math.min(4000, 250 * Math.pow(2, attempt));
          if (attempt < maxRetries) {
            logger(`${errorMessage}: HTTP ${response.status} -> ${backoff}ms 待機後にリトライ (${attempt + 1}/${maxRetries})`);
            await sleep(backoff);
            continue; // リトライ
          }
        }

        let errorText = '';
        try {
          const errorData = await response.json();
          errorText = JSON.stringify(errorData);
          console.error('エラーレスポンス:', errorData);
          throw new Error(`API Error: ${errorData.error?.message || response.statusText} (${response.status})`);
        } catch (parseError) {
          try {
            errorText = await response.text();
            console.error('エラーテキスト:', errorText);
          } catch (textError) {
            errorText = 'レスポンステキストを取得できませんでした';
          }
          throw new Error(`API Error: ${response.statusText} (${response.status}) - ${errorText}`);
        }
      }

      const data = await response.json();
      return data;
    } catch (error) {
      // タイムアウトは即失敗（リトライしない）
      if (timedOut) {
        const timeoutError = new Error(`API Error: request timed out after ${timeoutMs}ms`);
        timeoutError.name = 'TimeoutError';
        logger(`${errorMessage}:`, timeoutError);
        throw timeoutError;
      }

      // 明示的なキャンセル（Abort）は上位で扱う
      if (error && error.name === 'AbortError') {
        throw error;
      }

      // ネットワーク失敗は指数バックオフでリトライ
      const isNetworkError = (error instanceof TypeError && error.message === 'Failed to fetch');
      if (isNetworkError && attempt < maxRetries) {
        const delay = Math.min(4000, 250 * Math.pow(2, attempt));
        logger(`${errorMessage}: ネットワークエラー -> ${delay}ms 待機後にリトライ (${attempt + 1}/${maxRetries})`);
        await sleep(delay);
        continue;
      }
      logger(`${errorMessage}:`, error);
      throw error;
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
      if (externalSignal) {
        try { externalSignal.removeEventListener('abort', onExternalAbort); } catch (_) {}
      }
    }
  }
}

export async function makeStreamingApiRequest(url, options = {}, handlers = {}, errorMessage, logLevel = 'error') {
  const logger = (console[logLevel] || console.error).bind(console);
  const timeoutMs = Number.isFinite(options?.timeoutMs) ? options.timeoutMs : null;
  const externalSignal = options?.signal;

  const baseOptions = { ...(options || {}) };
  delete baseOptions.timeoutMs;
  delete baseOptions.signal;

  let timeoutId = null;
  let timedOut = false;
  const controller = new AbortController();
  const onExternalAbort = () => controller.abort();

  try {
    if (externalSignal) {
      if (externalSignal.aborted) {
        controller.abort();
      } else {
        externalSignal.addEventListener('abort', onExternalAbort, { once: true });
      }
    }

    if (timeoutMs && timeoutMs > 0) {
      timeoutId = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs);
    }

    const response = await fetch(url, { ...baseOptions, signal: controller.signal });
    if (!response.ok) {
      let errorText = '';
      try {
        const errorData = await response.json();
        errorText = JSON.stringify(errorData);
        throw new Error(`API Error: ${errorData.error?.message || response.statusText} (${response.status})`);
      } catch (parseError) {
        try {
          errorText = await response.text();
        } catch (_) {
          errorText = 'レスポンステキストを取得できませんでした';
        }
        throw new Error(`API Error: ${response.statusText} (${response.status}) - ${errorText}`);
      }
    }

    if (!response.body) {
      throw new Error('API Error: ストリーム応答ボディが取得できませんでした');
    }

    return await readOpenAICompatibleSSE(response.body, handlers);
  } catch (error) {
    if (timedOut) {
      const timeoutError = new Error(`API Error: request timed out after ${timeoutMs}ms`);
      timeoutError.name = 'TimeoutError';
      logger(`${errorMessage}:`, timeoutError);
      throw timeoutError;
    }
    if (error && error.name === 'AbortError') {
      throw error;
    }
    logger(`${errorMessage}:`, error);
    throw error;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
    if (externalSignal) {
      try { externalSignal.removeEventListener('abort', onExternalAbort); } catch (_) {}
    }
  }
}

export async function readOpenAICompatibleSSE(stream, handlers = {}) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let aggregated = '';

  const processEvent = async (rawEvent) => {
    const lines = rawEvent.split(/\r?\n/);
    const dataLines = [];

    for (const line of lines) {
      if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
    }

    const payload = dataLines.join('\n').trim();
    if (!payload) return false;
    if (payload === '[DONE]') return true;

    let parsed;
    try {
      parsed = JSON.parse(payload);
    } catch (_) {
      throw new Error(`API Error: SSE payload JSON の解析に失敗しました: ${payload.slice(0, 200)}`);
    }

    if (parsed?.error?.message) {
      throw new Error(`API Error: ${parsed.error.message}`);
    }

    const deltaText = normalizeOpenAICompatibleDeltaText(parsed?.choices?.[0]?.delta?.content);
    if (deltaText) {
      aggregated += deltaText;
      await handlers.onDelta?.(deltaText, aggregated, parsed);
    }

    await handlers.onEvent?.(parsed);
    return false;
  };

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });

    let boundaryIndex = buffer.search(/\r?\n\r?\n/);
    while (boundaryIndex >= 0) {
      const rawEvent = buffer.slice(0, boundaryIndex);
      const separatorLength = buffer[boundaryIndex] === '\r' ? (buffer[boundaryIndex + 1] === '\n' && buffer[boundaryIndex + 2] === '\r' ? 4 : 2) : 2;
      buffer = buffer.slice(boundaryIndex + separatorLength);
      if (await processEvent(rawEvent)) {
        await handlers.onDone?.(aggregated);
        return aggregated;
      }
      boundaryIndex = buffer.search(/\r?\n\r?\n/);
    }

    if (done) {
      const rest = buffer.trim();
      if (rest) {
        await processEvent(rest);
      }
      await handlers.onDone?.(aggregated);
      return aggregated;
    }
  }
}

// OpenRouter APIでの翻訳
async function translateWithOpenRouter(text, settings, requestOptions = {}) {
  if (!settings.openrouterApiKey) {
    throw new Error('OpenRouter APIキーが設定されていません');
  }

  const messages = [
    { role: 'system', content: getSystemPrompt(settings) },
    { role: 'user', content: text }
  ];

  {
    // 直接APIにアクセス

    try {
      const data = await makeApiRequest(
        'https://openrouter.ai/api/v1/chat/completions',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${settings.openrouterApiKey}`,
            ...OPENROUTER_HEADERS_BASE
          },
          body: JSON.stringify({
            model: settings.openrouterModel,
            messages: messages
          }),
          timeoutMs: requestOptions.timeoutMs ?? 180000,
          signal: requestOptions.signal
        },
        'OpenRouter API リクエスト中にエラーが発生'
      );

      return data.choices[0].message.content.trim();
    } catch (error) {
      throw error;
    }
  }
}

// Gemini APIでの翻訳
async function translateWithGemini(text, settings, requestOptions = {}) {
  if (!settings.geminiApiKey) {
    throw new Error('Gemini APIキーが設定されていません');
  }
  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${settings.geminiModel}:generateContent?key=${settings.geminiApiKey}`;
  console.log(`Gemini API リクエスト開始: ${apiUrl.replace(settings.geminiApiKey, '***API_KEY***')}`);

  try {
    const data = await makeApiRequest(
      apiUrl,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: `${getSystemPrompt(settings)}\n\n${text}` }
              ]
            }
          ],
          generationConfig: { temperature: 0.2 }
        }),
        timeoutMs: requestOptions.timeoutMs ?? 180000,
        signal: requestOptions.signal
      },
      'Gemini API リクエスト中にエラーが発生'
    );

    return data.candidates[0].content.parts[0].text.trim();
  } catch (error) {
    if (error instanceof TypeError && error.message === 'Failed to fetch') {
      throw new Error('ネットワーク接続エラー: Gemini APIに接続できません。インターネット接続を確認してください。');
    }
    throw error;
  }
}

// Cerebras API (OpenAI互換) での翻訳
async function translateWithCerebras(text, settings, requestOptions = {}) {
  if (!settings.cerebrasApiKey) {
    throw new Error('Cerebras APIキーが設定されていません');
  }
  if (!settings.cerebrasModel) {
    throw new Error('Cerebras のモデルが選択されていません');
  }

  const apiUrl = 'https://api.cerebras.ai/v1/chat/completions';
  const messages = [
    { role: 'system', content: getSystemPrompt(settings) },
    { role: 'user', content: text }
  ];

  const data = await makeApiRequest(
    apiUrl,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${settings.cerebrasApiKey}`
      },
      body: JSON.stringify({
        model: settings.cerebrasModel,
        messages,
        temperature: 0.2,
        stream: false
      }),
      timeoutMs: requestOptions.timeoutMs ?? 180000,
      signal: requestOptions.signal
    },
    'Cerebras API リクエスト中にエラーが発生'
  );

  return (data.choices?.[0]?.message?.content || '').trim();
}

async function translateWithCerebrasStream(text, settings, handlers = {}, requestOptions = {}) {
  if (!settings.cerebrasApiKey) {
    throw new Error('Cerebras APIキーが設定されていません');
  }
  if (!settings.cerebrasModel) {
    throw new Error('Cerebras のモデルが選択されていません');
  }

  const apiUrl = 'https://api.cerebras.ai/v1/chat/completions';
  const messages = [
    { role: 'system', content: getSystemPrompt(settings) },
    { role: 'user', content: text }
  ];

  return makeStreamingApiRequest(
    apiUrl,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${settings.cerebrasApiKey}`
      },
      body: JSON.stringify({
        model: settings.cerebrasModel,
        messages,
        temperature: 0.2,
        stream: true
      }),
      timeoutMs: requestOptions.timeoutMs ?? 180000,
      signal: requestOptions.signal
    },
    handlers,
    'Cerebras API ストリーミング中にエラーが発生'
  );
}

// Z-AI (OpenAI互換) での翻訳
async function translateWithZai(text, settings, requestOptions = {}) {
  if (!settings.zaiApiKey) {
    throw new Error('Z-AI APIキーが設定されていません');
  }
  if (!settings.zaiModel) {
    throw new Error('Z-AIのモデルが選択されていません');
  }

  const apiUrl = 'https://api.z.ai/api/paas/v4/chat/completions';
  const messages = [
    { role: 'system', content: getSystemPrompt(settings) },
    { role: 'user', content: text }
  ];

  const data = await makeApiRequest(
    apiUrl,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${settings.zaiApiKey}`,
        'Accept-Language': 'en-US,en'
      },
      body: JSON.stringify({
        model: settings.zaiModel,
        messages,
        temperature: 0.2,
        stream: false
      }),
      timeoutMs: requestOptions.timeoutMs ?? 180000,
      signal: requestOptions.signal
    },
    'Z-AI API リクエスト中にエラーが発生'
  );

  return (data.choices?.[0]?.message?.content || '').trim();
}

// Anthropic は削除済み

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
        timeoutMs: requestOptions.timeoutMs ?? 180000,
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
      { method: 'POST', headers, body, timeoutMs: requestOptions.timeoutMs ?? 180000, signal: requestOptions.signal },
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
      timeoutMs: requestOptions.timeoutMs ?? 180000,
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
      timeoutMs: requestOptions.timeoutMs ?? 180000,
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
    return await translateWithOpenRouter(text, settings, requestOptions);
  } else if (settings.apiProvider === 'cerebras') {
    return await translateWithCerebras(text, settings, requestOptions);
  } else if (settings.apiProvider === 'zai') {
    return await translateWithZai(text, settings, requestOptions);
  } else if (settings.apiProvider === 'ollama') {
    return await translateWithOllama(text, settings, requestOptions);
  } else if (settings.apiProvider === 'lmstudio') {
    return await translateWithLmStudio(text, settings, requestOptions);
  } else {
    return await translateWithGemini(text, settings, requestOptions);
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
    return translateWithCerebrasStream(text, settings, handlers, requestOptions);
  }
  if (settings.apiProvider === 'lmstudio') {
    return translateWithLmStudioStream(text, settings, handlers, requestOptions);
  }
  throw new Error(`streaming is not implemented for provider: ${settings?.apiProvider || 'unknown'}`);
}

async function translateBatchStructuredGemini(texts, settings, requestOptions = {}) {
  if (!settings.geminiApiKey) {
    throw new Error('Gemini APIキーが設定されていません');
  }

  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${settings.geminiModel}:generateContent?key=${settings.geminiApiKey}`;
  const items = buildStructuredBatchItems(texts);
  const instr = buildStructuredBatchInstruction(settings);

  const body = {
    contents: [
      {
        parts: [
          { text: `${instr}\n\nitems = ${JSON.stringify(items)}` }
        ]
      }
    ],
    generationConfig: {
      temperature: 0.2,
      response_mime_type: 'application/json'
    }
  };

  const data = await makeApiRequest(
    apiUrl,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      timeoutMs: requestOptions.timeoutMs ?? 180000,
      signal: requestOptions.signal
    },
    'Gemini API (structured batch) リクエスト中にエラーが発生'
  );

  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  return parseStructuredBatchResponse(text, texts);
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

  const formats = getOpenAICompatibleResponseFormatCandidates(settings);
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
          timeoutMs: requestOptions.timeoutMs ?? 180000,
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
          timeoutMs: requestOptions.timeoutMs ?? 180000,
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
    return translateBatchStructuredGemini(texts, settings, requestOptions);
  }
  if (provider === 'openrouter' || provider === 'cerebras' || provider === 'zai' || provider === 'lmstudio') {
    return translateBatchStructuredOpenAICompatible(texts, settings, requestOptions);
  }
  if (provider === 'ollama') {
    return translateBatchStructuredOllama(texts, settings, requestOptions);
  }
  throw new Error(`structured batch translation is not implemented for provider: ${provider}`);
}
