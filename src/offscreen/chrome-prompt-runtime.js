import { createReadyNanoSession, nanoAvailability, nanoError, nanoInputOptions } from '../shared/chrome-prompt.js';
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
const requestIds = new WeakMap();

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
      return await handleAvailability(payload?.kind);
    }

    const streamRequestId = action.endsWith('Stream') ? message.requestId : null;
    if (action === 'translate' || action === 'translateStream') {
      return await handleTranslate(payload?.text || '', payload?.settings || {}, signal, streamRequestId, payload?.messages);
    }

    if (action === 'translateImage' || action === 'translateImageStream') {
      return await handleTranslateImage(payload?.imageInput, payload?.settings || {}, signal, streamRequestId);
    }

    if (action === 'translateBatchStructured' || action === 'translateBatchStructuredStream') {
      return await handleTranslateBatchStructured(payload?.texts || [], payload?.settings || {}, signal, streamRequestId);
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
  requestIds.set(controller.signal, requestId);
  return controller.signal;
}

function abortRequest(requestId) {
  const controller = activeAbortControllers.get(requestId);
  if (!controller) return;
  controller.abort();
}

function assertLanguageModelAvailable() {
  if (!('LanguageModel' in self)) {
    throw nanoError('NanoUnavailable', 'この Chrome では LanguageModel / Prompt API を利用できません');
  }
}

async function handleAvailability(kind = 'text') {
  const availability = await nanoAvailability(kind);
  return { supported: !['unavailable', 'unsupported'].includes(availability), availability };
}

async function notifyStatus(signal, phase) {
  signal.throwIfAborted();
  await chrome.runtime.sendMessage({
    target: 'chromePromptClient', action: 'status', requestId: requestIds.get(signal), phase
  });
}

async function createSession(settings = {}, signal, inputOptions = {}) {
  assertLanguageModelAvailable();

  const options = {
    ...inputOptions,
    signal,
    initialPrompts: [
      {
        role: 'system',
        content: buildSystemPrompt(settings)
      }
    ]
  };

  const params = await getSafeParams();
  const temperature = normalizeTemperature(settings.chromePromptTemperature, params);

  if (params && Number.isFinite(temperature)) {
    options.temperature = temperature;
    options.topK = params.defaultTopK;
  }

  return await createReadyNanoSession(options, inputOptions.expectedInputs?.some(input => input.type === 'image') ? 'image' : 'text');
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
    '指定された回答本文または出力形式のみを返してください。余計な説明、前置き、Markdownコードフェンスは出力しないでください。'
  ].join('\n');
}

async function withSession(settings, signal, callback, inputOptions = {}) {
  await notifyStatus(signal, 'loading');
  const session = await createSession(settings, signal, inputOptions);
  try {
    await notifyStatus(signal, 'running');
    return await callback(session);
  } finally {
    try {
      session.destroy();
    } catch (_) {
      // no-op
    }
  }
}

async function promptSession(session, input, options, requestId) {
  if (!requestId || typeof session.promptStreaming !== 'function') {
    const result = await session.prompt(input, options);
    if (requestId) await sendDelta(requestId, result, options.signal);
    return result;
  }
  let result = '';
  for await (const delta of session.promptStreaming(input, options)) {
    options.signal.throwIfAborted();
    result += delta;
    await sendDelta(requestId, delta, options.signal);
  }
  options.signal.throwIfAborted();
  return result;
}

async function sendDelta(requestId, deltaText, signal) {
  signal.throwIfAborted();
  if (!deltaText) return;
  const response = await chrome.runtime.sendMessage({
    target: 'chromePromptClient', action: 'delta', requestId, deltaText
  });
  if (!response?.accepted) throw new Error('翻訳結果の受信先が閉じられました');
}

async function handleTranslate(text, settings, signal, requestId, messages) {
  const input = typeof text === 'string' ? text.trim() : '';
  if (!input) return '';

  return await withSession(settings, signal, async (session) => {
    const result = await promptSession(session, messages || input, { signal }, requestId);
    return (result || '').trim();
  });
}

async function handleTranslateImage(imageInput, settings, signal, requestId) {
  assertLanguageModelAvailable();
  const imageData = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i.exec(imageInput?.dataUrl || '');
  if (!imageData) {
    throw new Error('画像入力データが不正です');
  }
  const inputOptions = nanoInputOptions('image');
  // メッセージで渡せない Blob を直接復元する。data: の fetch は拡張の connect-src で拒否される。
  let bytes;
  try {
    bytes = Uint8Array.from(atob(imageData[2]), char => char.charCodeAt(0));
  } catch (_) {
    throw new Error('画像入力のBase64データが不正です');
  }
  const image = new Blob([bytes], { type: imageData[1] });
  return await withSession(settings, signal, async (session) => {
    const result = await promptSession(session, [{
      role: 'user',
      content: [
        { type: 'text', value: 'この画像に含まれるテキストを読み取り、日本語に翻訳してください。翻訳結果のみを出力してください。テキストが見当たらない場合は「翻訳対象のテキストが見つかりませんでした。」とだけ出力してください。' },
        { type: 'image', value: image }
      ]
    }], { signal }, requestId);
    const text = (result || '').trim();
    if (!text) throw new Error('Gemini Nano から画像翻訳結果を取得できませんでした');
    return text;
  }, inputOptions);
}

async function handleTranslateBatchStructured(texts, settings, signal, requestId) {
  if (!Array.isArray(texts) || texts.length === 0) return [];

  const items = buildStructuredBatchItems(texts);
  const instruction = buildStructuredBatchInstruction(settings, {
    defaultPrompt: DEFAULT_TRANSLATION_SYSTEM_PROMPT,
    fallbackPolicy: DEFAULT_TRANSLATION_SYSTEM_PROMPT
  });
  const prompt = `${instruction}\n\nitems = ${JSON.stringify(items)}`;

  return await withSession(settings, signal, async (session) => {
    const result = await promptSession(session, prompt, {
      signal,
      responseConstraint: STRUCTURED_BATCH_SCHEMA
    }, requestId);
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
