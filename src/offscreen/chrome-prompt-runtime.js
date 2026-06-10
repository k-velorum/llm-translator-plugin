const TARGET = 'chromePromptRuntime';

const DEFAULT_TRANSLATION_SYSTEM_PROMPT =
  '指示された文章を日本語に翻訳してください。翻訳結果のみを出力してください。';

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

const activeAbortControllers = new Map();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.target !== TARGET) {
    return false;
  }

  if (message.action === 'abort') {
    abortRequest(message.requestId);
    sendResponse({ requestId: message.requestId, result: { aborted: true } });
    return false;
  }

  (async () => {
    const { action, payload } = message;
    const signal = createRequestSignal(message.requestId);

    if (action === 'availability') {
      return await handleAvailability();
    }

    if (action === 'translate') {
      return await handleTranslate(payload?.text || '', payload?.settings || {}, signal);
    }

    if (action === 'translateBatchStructured') {
      return await handleTranslateBatchStructured(payload?.texts || [], payload?.settings || {}, signal);
    }

    throw new Error(`Unknown Chrome Prompt runtime action: ${action}`);
  })()
    .then((result) => {
      sendResponse({
        requestId: message.requestId,
        result
      });
    })
    .catch((error) => {
      sendResponse({
        requestId: message.requestId,
        error: serializeError(error)
      });
    })
    .finally(() => {
      activeAbortControllers.delete(message.requestId);
    });

  return true;
});

function createRequestSignal(requestId) {
  const controller = new AbortController();
  activeAbortControllers.set(requestId, controller);
  return controller.signal;
}

function abortRequest(requestId) {
  const controller = activeAbortControllers.get(requestId);
  if (!controller) return;
  controller.abort();
}

function serializeError(error) {
  return {
    name: error?.name || 'Error',
    message: error?.message || String(error),
    details: error?.stack || ''
  };
}

function assertLanguageModelAvailable() {
  if (!('LanguageModel' in self)) {
    throw new Error('この Chrome では LanguageModel / Prompt API を利用できません');
  }
}

async function handleAvailability() {
  if (!('LanguageModel' in self)) {
    return {
      supported: false,
      availability: 'unsupported',
      message: 'LanguageModel is not defined'
    };
  }

  const availability = await LanguageModel.availability();

  return {
    supported: availability !== 'unavailable',
    availability
  };
}

async function createSession(settings = {}, signal) {
  assertLanguageModelAvailable();

  const options = {
    signal,
    initialPrompts: [
      {
        role: 'system',
        content: buildSystemPrompt(settings)
      }
    ],
    monitor(monitorTarget) {
      monitorTarget.addEventListener('downloadprogress', (event) => {
        chrome.runtime.sendMessage({
          action: 'chromePromptDownloadProgress',
          loaded: event.loaded
        });
      });
    }
  };

  const params = await getSafeParams();
  const temperature = normalizeTemperature(settings.chromePromptTemperature, params);

  if (params && Number.isFinite(temperature)) {
    options.temperature = temperature;
    options.topK = params.defaultTopK;
  }

  return await LanguageModel.create(options);
}

async function getSafeParams() {
  try {
    if (!('LanguageModel' in self) || typeof LanguageModel.params !== 'function') {
      return null;
    }
    return await LanguageModel.params();
  } catch (_) {
    return null;
  }
}

function normalizeTemperature(value, params) {
  const fallback = Number.isFinite(params?.defaultTemperature) ? params.defaultTemperature : 0.2;
  const max = Number.isFinite(params?.maxTemperature) ? params.maxTemperature : 2;
  const n = Number(value);
  if (!Number.isFinite(n)) return Math.max(0, Math.min(max, fallback));
  return Math.max(0, Math.min(max, n));
}

function buildSystemPrompt(settings = {}) {
  const prompt = (settings.translationSystemPrompt || DEFAULT_TRANSLATION_SYSTEM_PROMPT).trim();

  return [
    prompt || DEFAULT_TRANSLATION_SYSTEM_PROMPT,
    '',
    '入力言語は明示されない場合があります。必要に応じて自動で判断してください。',
    '翻訳結果のみを出力してください。余計な説明、前置き、Markdownコードフェンスは出力しないでください。'
  ].join('\n');
}

function buildStructuredBatchInstruction(settings) {
  const prompt = (settings.translationSystemPrompt || DEFAULT_TRANSLATION_SYSTEM_PROMPT).trim();
  return [
    'あなたは優秀な翻訳者です。与えられた JSON 配列 items の各要素を日本語に翻訳してください。',
    '出力は JSON のみで、オブジェクト形式 {"items":[{"id": number, "translation": string}]} にしてください。',
    '重要: 入力の id をそのまま維持し、items の件数は入力と同じにします。不要な説明文は一切出力しないでください。',
    'HTMLタグやコードブロックなどのマークアップは保持し、意味を変えないように訳してください。',
    `翻訳方針: ${prompt || DEFAULT_TRANSLATION_SYSTEM_PROMPT}`
  ].join('\n');
}

function buildStructuredBatchItems(texts) {
  return texts.map((text, id) => ({ id, text }));
}

async function withSession(settings, signal, callback) {
  const session = await createSession(settings, signal);
  try {
    return await callback(session);
  } finally {
    try {
      session.destroy();
    } catch (_) {
      // no-op
    }
  }
}

async function handleTranslate(text, settings, signal) {
  const input = typeof text === 'string' ? text.trim() : '';
  if (!input) return '';

  return await withSession(settings, signal, async (session) => {
    const result = await session.prompt(input, { signal });
    return (result || '').trim();
  });
}

async function handleTranslateBatchStructured(texts, settings, signal) {
  if (!Array.isArray(texts) || texts.length === 0) return [];

  const items = buildStructuredBatchItems(texts);
  const prompt = `${buildStructuredBatchInstruction(settings)}\n\nitems = ${JSON.stringify(items)}`;

  return await withSession(settings, signal, async (session) => {
    const result = await session.prompt(prompt, {
      signal,
      responseConstraint: STRUCTURED_BATCH_SCHEMA
    });
    return parseStructuredBatchResponse(result, texts);
  });
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
    return trySliceByBounds('{', '}');
  }

  const parsedObj = trySliceByBounds('{', '}');
  if (parsedObj !== null) return parsedObj;
  return trySliceByBounds('[', ']');
}

function parseStructuredBatchResponse(text, texts) {
  const parsed = parseJsonLoose(text);
  if (!parsed) {
    throw new Error('Chrome Prompt API の構造化出力(JSON)の解析に失敗しました');
  }
  return normalizeStructuredBatchResult(parsed, texts);
}

function normalizeStructuredBatchResult(parsed, texts) {
  const arr = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.items) ? parsed.items : null);
  if (!arr) {
    throw new Error('Chrome Prompt API の構造化出力に配列(items)が見つかりません');
  }

  const out = new Array(texts.length);
  const seen = new Set();

  for (const item of arr) {
    const id = item?.id;
    const translation = item?.translation;
    if (!Number.isInteger(id) || id < 0 || id >= out.length || typeof translation !== 'string') continue;
    if (seen.has(id)) continue;
    out[id] = translation.trim();
    seen.add(id);
  }

  if (seen.size === 0) {
    throw new Error('Chrome Prompt API の構造化出力から有効な id を取得できませんでした');
  }

  if (seen.size < texts.length) {
    const missing = [];
    for (let i = 0; i < texts.length; i += 1) {
      if (!seen.has(i)) {
        out[i] = texts[i];
        missing.push(i);
      }
    }
    const missingRatio = missing.length / texts.length;
    if (missingRatio >= 0.5) {
      throw new Error(`Chrome Prompt API の構造化出力の id 欠落率が高すぎます (${missing.length}/${texts.length})`);
    }
  }

  return out;
}
