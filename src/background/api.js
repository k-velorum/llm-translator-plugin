import { DEFAULT_SETTINGS } from './settings.js';

// 共通プロンプト取得（設定のカスタムがあれば優先）
function getSystemPrompt(settings) {
  const v = (settings && settings.translationSystemPrompt) || DEFAULT_SETTINGS.translationSystemPrompt;
  return (typeof v === 'string' && v.trim().length) ? v : DEFAULT_SETTINGS.translationSystemPrompt;
}
const OPENROUTER_HEADERS_BASE = {
  'HTTP-Referer': 'chrome-extension://llm-translator',
  'X-Title': 'LLM Translation Plugin'
};

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

// 構造化バッチ翻訳（Gemini専用）。
// 入力: texts: string[] -> 出力: translations: string[]（同じ長さ、足りない分は原文で埋める）
export async function translateBatchStructured(texts, settings, requestOptions = {}) {
  if (settings.apiProvider !== 'gemini') {
    throw new Error('structured batch translation is only implemented for Gemini provider for now');
  }

  if (!settings.geminiApiKey) {
    throw new Error('Gemini APIキーが設定されていません');
  }

  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${settings.geminiModel}:generateContent?key=${settings.geminiApiKey}`;

  // id で整合性を担保
  const items = texts.map((t, i) => ({ id: i, text: t }));
  const instr = [
    'あなたは優秀な翻訳者です。与えられた JSON 配列 items の各要素を日本語に翻訳してください。',
    '出力は JSON のみで、配列形式とし、各要素は {"id": number, "translation": string} のみを含めてください。',
    '重要: 入力の id をそのまま維持し、出力配列の長さは入力と同じにします。不要な文字や説明文は一切出力しないでください。',
    'HTMLタグやコードブロックなどのマークアップは保持し、意味を変えないように訳してください。',
  ].join('\n');

  const body = {
    contents: [
      {
        parts: [
          { text: instr + '\n\nitems = ' + JSON.stringify(items) }
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

  // JSON 抽出を頑健化: 最初にそのまま、だめなら JSON 部分っぽい範囲をサルベージ
  function tryParseJson(s) {
    try { return JSON.parse(s); } catch (_) {}
    const match = s.match(/[\[{][\s\S]*[\]}]/);
    if (match) {
      try { return JSON.parse(match[0]); } catch (_) {}
    }
    return null;
  }

  const parsed = tryParseJson(text);
  if (!parsed) {
    throw new Error('構造化出力(JSON)の解析に失敗しました');
  }

  const arr = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.items) ? parsed.items : null);
  if (!arr) {
    throw new Error('構造化出力に配列が見つかりません');
  }

  // id に基づき並べ替え/補完
  const out = new Array(texts.length);
  for (const it of arr) {
    const id = it?.id;
    const tr = (it?.translation ?? '').toString();
    if (Number.isInteger(id) && id >= 0 && id < out.length) {
      out[id] = tr.trim();
    }
  }
  for (let i = 0; i < out.length; i++) {
    if (typeof out[i] !== 'string' || out[i].length === 0) out[i] = texts[i];
  }

  return out;
}
