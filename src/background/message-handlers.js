import { getErrorLogLevel } from '../shared/errors.js';
import { loadSettings } from './settings.js';
import {
  translateText,
  translateTextStream,
  getProviderCapabilities
} from './api.js';
import { getProviderDefinition } from './api/registry.js';
import { appendLog, getProviderMeta } from './logging.js';
import { cancelSelectionStream } from './selection-translation.js';
import {
  createStreamEventEmitter,
  normalizeStreamError
} from './streaming.js';
import { TRANSLATION_TIMEOUT_MS } from '../shared/constants.js';
import { normalizeError } from '../shared/errors.js';
import { log } from '../shared/logger.js';

const STREAM_TIMEOUT_MS = TRANSLATION_TIMEOUT_MS;
const activeStreams = new Map();

async function cleanupActiveStream(requestId, { notifyCancelled = false } = {}) {
  const session = activeStreams.get(requestId);
  if (!session) return;
  activeStreams.delete(requestId);
  if (notifyCancelled) {
    try {
      await session.emitter.cancelled();
    } catch (_) {
      // no-op
    }
  }
  try {
    await session.emitter.dispose();
  } catch (_) {
    // no-op
  }
}

async function startStreamingTranslation(message, sender, sendResponse) {
  const requestId = typeof message?.requestId === 'string' ? message.requestId.trim() : '';
  const text = typeof message?.text === 'string' ? message.text : '';
  const kind = typeof message?.kind === 'string' ? message.kind : 'generic';
  const tabId = sender?.tab?.id;
  const frameId = Number.isInteger(sender?.frameId) ? sender.frameId : 0;

  if (!requestId) {
    sendResponse({ accepted: false, error: normalizeError('requestId が未指定です') });
    return;
  }
  if (!text) {
    sendResponse({ accepted: false, error: normalizeError('翻訳対象テキストが空です') });
    return;
  }
  if (!tabId) {
    sendResponse({ accepted: false, error: normalizeError('送信元タブが特定できません') });
    return;
  }
  if (activeStreams.has(requestId)) {
    sendResponse({ accepted: false, error: normalizeError('同じ requestId のストリームが既に存在します') });
    return;
  }

  try {
    const settings = await loadSettings();
    const capabilities = getProviderCapabilities(settings);
    if (!capabilities.supportsStreaming) {
      sendResponse({ accepted: false, reason: 'unsupported' });
      return;
    }

    let streamSendFailed = false;
    const abortController = new AbortController();
    const emitter = createStreamEventEmitter({
      tabId,
      frameId,
      requestId,
      kind,
      onFatalError: () => {
        streamSendFailed = true;
        abortController.abort();
      }
    });

    activeStreams.set(requestId, {
      emitter,
      abortController,
      tabId,
      frameId,
      kind
    });

    sendResponse({ accepted: true, requestId });

    try {
      await emitter.start(message?.meta);
      const finalText = await translateTextStream(
        text,
        settings,
        {
          onDelta: async (deltaText) => {
            await emitter.pushDelta(deltaText);
          }
        },
        {
          signal: abortController.signal,
          timeoutMs: STREAM_TIMEOUT_MS
        }
      );
      await emitter.complete(finalText);
    } catch (error) {
      if (error?.name !== 'AbortError') {
        await appendLog({
          level: getErrorLogLevel(error),
          type: 'translate',
          event: `${kind}_stream_failed`,
          ...getProviderMeta(settings),
          tabId,
          message: error?.message || String(error)
        });
      }

      if (!streamSendFailed && activeStreams.has(requestId)) {
        try {
          await emitter.error(error);
        } catch (_) {
          // no-op
        }
      }
    } finally {
      await cleanupActiveStream(requestId);
    }
  } catch (error) {
    sendResponse({ accepted: false, error: normalizeStreamError(error) });
  }
}

function handleCancelTranslationStream(message, _sender, sendResponse) {
  const requestId = typeof message?.requestId === 'string' ? message.requestId.trim() : '';
  const session = requestId ? activeStreams.get(requestId) : null;
  if (!session) {
    sendResponse({ cancelled: cancelSelectionStream(requestId) });
    return;
  }

  session.abortController.abort();
  cleanupActiveStream(requestId, { notifyCancelled: true })
    .then(() => sendResponse({ cancelled: true }))
    .catch((error) => sendResponse({ cancelled: false, error: normalizeStreamError(error) }));
}

async function handleEmbeddedTextTranslation(message, sender, sendResponse, { eventName = 'tweet_failed', logLabel = 'ツイート翻訳エラー' } = {}) {
  const settings = await loadSettings();
  try {
    const translatedText = await translateText(message.text, settings, { timeoutMs: TRANSLATION_TIMEOUT_MS });
    sendResponse({ translatedText });
  } catch (error) {
    log.error('messageHandlers', logLabel, error);
    appendLog({
      level: getErrorLogLevel(error),
      type: 'translate',
      event: eventName,
      ...getProviderMeta(settings),
      tabId: sender?.tab?.id,
      message: error?.message || String(error)
    });
    sendResponse({ error: normalizeError(error) });
  }
}

async function handleTestTranslate(message, sender, sendResponse) {
  const currentSettings = await loadSettings();
  const testSettings = { ...currentSettings, ...message.settings };
  try {
    const result = await translateText(message.text, testSettings, { timeoutMs: TRANSLATION_TIMEOUT_MS });
    sendResponse({ result });
  } catch (error) {
    log.error('messageHandlers', 'テスト翻訳エラー', error);
    appendLog({
      level: getErrorLogLevel(error),
      type: 'translate',
      event: 'test_failed',
      ...getProviderMeta(testSettings),
      tabId: sender?.tab?.id,
      message: error?.message || String(error)
    });
    sendResponse({ error: normalizeError(error) });
  }
}

async function handleVerifyApiKey(message, _sender, sendResponse, providerOverride) {
  const provider = providerOverride || message.provider;
  const definition = getProviderDefinition(provider);
  if (!definition?.verify) {
    sendResponse({ error: normalizeError(`APIキー検証は未対応のプロバイダーです: ${provider || 'unknown'}`) });
    return;
  }
  try {
    const settings = await loadSettings();
    const result = await definition.verify(message, settings);
    sendResponse({ result });
  } catch (error) {
    sendResponse({ error: normalizeError(error) });
  }
}

async function handleGetModels(message, _sender, sendResponse, providerOverride) {
  const provider = providerOverride || message.provider;
  const definition = getProviderDefinition(provider);
  if (!definition?.getModels) {
    sendResponse({ error: normalizeError(`モデル一覧取得は未対応のプロバイダーです: ${provider || 'unknown'}`) });
    return;
  }
  try {
    const settings = await loadSettings();
    const models = await definition.getModels(message, settings);
    sendResponse({ models });
  } catch (error) {
    sendResponse({ error: normalizeError(error) });
  }
}

const ACTION_HANDLERS = {
  startTranslationStream: (message, sender, sendResponse) => startStreamingTranslation(message, sender, sendResponse),
  cancelTranslationStream: handleCancelTranslationStream,
  translateEmbeddedText: (message, sender, sendResponse) =>
    handleEmbeddedTextTranslation(message, sender, sendResponse, {
      eventName: 'embedded_text_failed',
      logLabel: '埋め込みテキスト翻訳エラー'
    }),
  testTranslate: handleTestTranslate,
  verifyApiKey: (message, sender, sendResponse) => handleVerifyApiKey(message, sender, sendResponse),
  getModels: (message, sender, sendResponse) => handleGetModels(message, sender, sendResponse)
};


// バックグラウンドでのメッセージ処理
export function handleBackgroundMessage(message, sender, sendResponse) {
  const handler = ACTION_HANDLERS[message?.action];
  if (!handler) return false;
  handler(message, sender, sendResponse);
  return true;
}
