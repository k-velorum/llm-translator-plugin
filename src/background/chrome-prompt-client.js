import { NANO_LOAD_TIMEOUT_MS } from '../shared/chrome-prompt.js';
import {
  PROVIDER_AVAILABILITY_TIMEOUT_MS,
  TRANSLATION_TIMEOUT_MS
} from '../shared/constants.js';

const OFFSCREEN_DOCUMENT_PATH = 'offscreen.html';
const TARGET = 'chromePromptRuntime';

let creatingOffscreenDocument = null;
let requestSeq = 0;

async function hasOffscreenDocument(offscreenUrl) {
  if (chrome.runtime.getContexts) {
    const existingContexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
      documentUrls: [offscreenUrl]
    });
    return existingContexts.length > 0;
  }

  const clients = await self.clients?.matchAll?.();
  return Array.isArray(clients) && clients.some((client) => client.url === offscreenUrl);
}

async function ensureChromePromptOffscreenDocument() {
  if (!chrome.offscreen?.createDocument) {
    throw new Error('この Chrome では offscreen document を利用できません');
  }

  const offscreenUrl = chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH);

  if (await hasOffscreenDocument(offscreenUrl)) return;

  if (creatingOffscreenDocument) {
    await creatingOffscreenDocument;
    return;
  }

  creatingOffscreenDocument = chrome.offscreen.createDocument({
    url: OFFSCREEN_DOCUMENT_PATH,
    reasons: ['WORKERS'],
    justification: 'Run Chrome built-in Prompt API from an extension document because MV3 service workers cannot access LanguageModel.'
  });

  try {
    await creatingOffscreenDocument;
  } finally {
    creatingOffscreenDocument = null;
  }
}

export async function callChromePromptRuntime(action, payload = {}, requestOptions = {}) {
  await ensureChromePromptOffscreenDocument();

  const requestId = `chromePrompt:${Date.now()}:${++requestSeq}`;
  const timeoutMs = requestOptions.timeoutMs ?? TRANSLATION_TIMEOUT_MS;
  const externalSignal = requestOptions.signal;

  return await new Promise((resolve, reject) => {
    let settled = false;
    let timeoutId = null;

    const notifyAbort = () => {
      try {
        chrome.runtime.sendMessage({
          target: TARGET,
          requestId,
          action: 'abort'
        })?.catch?.(() => {});
      } catch (_) {
        // no-op
      }
    };

    const settle = (fn, value) => {
      if (settled) return;
      settled = true;
      chrome.runtime.onMessage.removeListener(onRuntimeMessage);
      if (timeoutId) clearTimeout(timeoutId);
      if (externalSignal) {
        try { externalSignal.removeEventListener('abort', onAbort); } catch (_) {}
      }
      fn(value);
    };

    const onAbort = () => {
      const error = new Error('The operation was aborted');
      error.name = 'AbortError';
      notifyAbort();
      settle(reject, error);
    };

    let aggregated = '';
    const onRuntimeMessage = (message, sender, sendResponse) => {
      if (message?.target !== 'chromePromptClient' || message.requestId !== requestId ||
          !['delta', 'status'].includes(message.action) || sender.id !== chrome.runtime.id ||
          sender.url !== chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH)) return false;
      if (settled) return false;
      if (message.action === 'status') {
        if (message.phase === 'running' && !inferenceStarted) {
          inferenceStarted = true;
          armTimeout(timeoutMs, '翻訳がタイムアウトしました', 'TimeoutError');
        }
        Promise.resolve().then(() => { if (!settled) return requestOptions.onStatus?.(message.phase); })
          .then(() => sendResponse({ accepted: !settled }))
          .catch(error => { notifyAbort(); settle(reject, error); sendResponse({ accepted: false }); });
        return true;
      }
      const delta = typeof message.deltaText === 'string' ? message.deltaText : '';
      aggregated += delta;
      Promise.resolve().then(() => { if (!settled) return requestOptions.onDelta?.(delta, aggregated); })
        .then(() => sendResponse({ accepted: !settled }))
        .catch(error => {
          notifyAbort();
          settle(reject, error);
          sendResponse({ accepted: false });
        });
      return true;
    };
    chrome.runtime.onMessage.addListener(onRuntimeMessage);

    if (externalSignal?.aborted) {
      onAbort();
      return;
    }

    if (externalSignal) {
      externalSignal.addEventListener('abort', onAbort, { once: true });
    }

    let inferenceStarted = false;
    function armTimeout(duration, message, name) {
      if (timeoutId) clearTimeout(timeoutId);
      if (duration <= 0) return;
      timeoutId = setTimeout(() => {
        const error = Object.assign(new Error(message), { name });
        notifyAbort();
        settle(reject, error);
      }, duration);
    }
    armTimeout(action === 'availability' ? timeoutMs : NANO_LOAD_TIMEOUT_MS,
      action === 'availability' ? 'Gemini Nano の状態確認がタイムアウトしました' : 'Gemini Nano のモデル読み込みがタイムアウトしました。再試行してください。',
      action === 'availability' ? 'TimeoutError' : 'NanoLoadError');

    try {
      chrome.runtime.sendMessage(
        {
          target: TARGET,
          requestId,
          action,
          payload
        },
        (response) => {
          if (chrome.runtime.lastError) {
            settle(reject, new Error(chrome.runtime.lastError.message));
            return;
          }

          if (!response) {
            settle(reject, new Error('Chrome Prompt runtime returned empty response'));
            return;
          }

          if (response.error) {
            const error = new Error(response.error.message || 'Chrome Prompt runtime error');
            error.name = response.error.name || 'ChromePromptRuntimeError';
            error.details = response.error.details;
            settle(reject, error);
            return;
          }

          settle(resolve, response.result);
        }
      );
    } catch (error) {
      settle(reject, error);
    }
  });
}

export async function getChromePromptAvailability(settings = {}) {
  return callChromePromptRuntime('availability', { settings }, { timeoutMs: PROVIDER_AVAILABILITY_TIMEOUT_MS });
}

export async function translateWithChromePromptRuntime(text, settings, requestOptions = {}) {
  return callChromePromptRuntime('translate', { text, settings }, requestOptions);
}

export async function translateBatchStructuredWithChromePromptRuntime(texts, settings, requestOptions = {}) {
  return callChromePromptRuntime('translateBatchStructured', { texts, settings }, requestOptions);
}
