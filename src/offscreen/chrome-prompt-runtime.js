import {
  STRUCTURED_BATCH_SCHEMA,
  buildStructuredBatchInstruction,
  buildStructuredBatchItems,
  normalizeStructuredBatchResult,
  parseJsonLoose
} from '../shared/structured-batch.js';
import { serializeError } from '../shared/errors.js';

const TARGET = 'chromePromptRuntime';

const DEFAULT_TRANSLATION_SYSTEM_PROMPT =
  '指示された文章を日本語に翻訳してください。翻訳結果のみを出力してください。';

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
  const instruction = buildStructuredBatchInstruction(settings, {
    defaultPrompt: DEFAULT_TRANSLATION_SYSTEM_PROMPT,
    fallbackPolicy: DEFAULT_TRANSLATION_SYSTEM_PROMPT
  });
  const prompt = `${instruction}\n\nitems = ${JSON.stringify(items)}`;

  return await withSession(settings, signal, async (session) => {
    const result = await session.prompt(prompt, {
      signal,
      responseConstraint: STRUCTURED_BATCH_SCHEMA
    });
    return parseStructuredBatchResponse(result, texts);
  });
}

function parseStructuredBatchResponse(text, texts) {
  const parsed = parseJsonLoose(text);
  if (!parsed) {
    throw new Error('Chrome Prompt API の構造化出力(JSON)の解析に失敗しました');
  }
  return normalizeStructuredBatchResult(parsed, texts, {
    warnOnMissingIds: false,
    messages: {
      missingItems: 'Chrome Prompt API の構造化出力に配列(items)が見つかりません',
      noValidIds: 'Chrome Prompt API の構造化出力から有効な id を取得できませんでした',
      tooManyMissingIds: (missing, total) =>
        `Chrome Prompt API の構造化出力の id 欠落率が高すぎます (${missing}/${total})`
    }
  });
}
