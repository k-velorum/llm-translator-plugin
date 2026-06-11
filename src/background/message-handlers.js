import { loadSettings } from './settings.js';
import {
  translateText,
  translateTextStream,
  makeApiRequest,
  getProviderCapabilities
} from './api.js';
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
          level: 'error',
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

// APIキー検証とモデル一覧取得の共通処理
async function handleApiRequest(action, apiKey, endpoint, headers, successCallback, errorCallback, settings) {

  try {
    let result;
    // 直接APIにアクセス
    result = await handleDirectRequest(endpoint, headers);
      successCallback(result);
  } catch (error) {
    log.error('messageHandlers', `${action}エラー`, error);
    errorCallback(normalizeError(error));
  }
}

// 直接APIにアクセスする処理
async function handleDirectRequest(endpoint, headers) {
  return makeApiRequest(
    endpoint,
    {
      method: 'GET',
      headers: headers
    },
    'API直接アクセス中にエラーが発生'
  );
}

// モデル一覧取得の共通処理
async function handleModelListRequest(provider, apiKey, endpoint, headers, dataProcessor, sendResponse, settings) {
  const action = `${provider}モデル一覧取得`;
  await handleApiRequest(
    action,
    apiKey,
    endpoint,
    headers,
    (result) => {
      const models = dataProcessor(result);
          sendResponse({ models: models });
    },
    (error) => {
      // APIキーなしでも取得できるOpenRouterの場合はエラーを無視してデフォルトを返す
      if (provider === 'OpenRouter' && !apiKey) {
         log.warn('messageHandlers', 'OpenRouter APIキー未設定のため、公開モデル一覧を取得します。');
         // ここで公開モデル取得のロジックを再度呼ぶか、デフォルトを返す
         // 今回は簡略化のため、エラーを返しつつ、popup.js側でデフォルトを使う想定
         sendResponse({
           error: normalizeError({
             message: 'APIキー未設定ですが、処理は継続します。',
             details: error.details
           })
         });
      } else {
        sendResponse({ error: normalizeError(error) });
      }
    },
    settings
  );
}


// バックグラウンドでのメッセージ処理
export function handleBackgroundMessage(message, sender, sendResponse) {
  if (message.action === 'startTranslationStream') {
    startStreamingTranslation(message, sender, sendResponse);
    return true;
  }

  if (message.action === 'cancelTranslationStream') {
    const requestId = typeof message?.requestId === 'string' ? message.requestId.trim() : '';
    const session = requestId ? activeStreams.get(requestId) : null;
    if (!session) {
      sendResponse({ cancelled: cancelSelectionStream(requestId) });
      return true;
    }

    session.abortController.abort();
    cleanupActiveStream(requestId, { notifyCancelled: true })
      .then(() => sendResponse({ cancelled: true }))
      .catch((error) => sendResponse({ cancelled: false, error: normalizeStreamError(error) }));
    return true;
  }

  // ツイート翻訳リクエストの処理
  if (message.action === 'translateTweet') {
      loadSettings()
      .then(settings => {
        return translateText(message.text, settings, { timeoutMs: TRANSLATION_TIMEOUT_MS })
          .then(translatedText => {
            sendResponse({ translatedText: translatedText });
          })
          .catch(error => {
            log.error('messageHandlers', 'ツイート翻訳エラー', error);
            appendLog({
              level: 'error',
              type: 'translate',
              event: 'tweet_failed',
              ...getProviderMeta(settings),
              tabId: sender?.tab?.id,
              message: error?.message || String(error)
            });
            // エラーオブジェクト全体を送るのではなく、必要な情報だけ送る
            sendResponse({ error: normalizeError(error) });
          });
      });
    return true; // 非同期レスポンスを示すためにtrueを返す
  }

  // テスト翻訳リクエストの処理
  if (message.action === 'testTranslate') {
      // message.settings を直接使うのではなく、loadSettingsで最新を取得する方が安全かもしれない
    loadSettings()
      .then(currentSettings => {
        // popupからの設定で上書きする（APIキーやモデルなど）
        const testSettings = { ...currentSettings, ...message.settings };
        return translateText(message.text, testSettings, { timeoutMs: TRANSLATION_TIMEOUT_MS })
          .then(result => {
            sendResponse({ result: result });
          })
          .catch(error => {
            log.error('messageHandlers', 'テスト翻訳エラー', error);
            appendLog({
              level: 'error',
              type: 'translate',
              event: 'test_failed',
              ...getProviderMeta(testSettings),
              tabId: sender?.tab?.id,
              message: error?.message || String(error)
            });
            sendResponse({ error: normalizeError(error) });
          });
      });
    return true;
  }

  // OpenRouter APIキー検証リクエストの処理
  if (message.action === 'verifyOpenrouterApiKey') {
    loadSettings().then(settings => {
      handleApiRequest(
        'OpenRouter APIキー検証',
        message.apiKey,
        'https://openrouter.ai/api/v1/models',
        {
          'Authorization': `Bearer ${message.apiKey}`,
          'HTTP-Referer': 'chrome-extension://llm-translator', // 適切な値に変更
          'X-Title': 'LLM Translation Plugin' // 適切な値に変更
        },
        (result) => {
          sendResponse({
            result: {
              success: true,
              models: result.data // モデルデータも返す
            }
          });
        },
        (error) => sendResponse({ error: error }),
        settings
      );
    });
    return true;
  }

  // Anthropic は削除済み

  // OpenRouterモデル一覧取得リクエストの処理
  if (message.action === 'getOpenrouterModels') {
    loadSettings().then(settings => {
      const key = message.apiKey || settings.openrouterApiKey;
      const headers = {
        'HTTP-Referer': 'chrome-extension://llm-translator',
        'X-Title': 'LLM Translation Plugin'
      };
      if (key) headers['Authorization'] = `Bearer ${key}`;
      handleModelListRequest('OpenRouter', key, 'https://openrouter.ai/api/v1/models', headers, (result) => result.data, sendResponse, settings);
    });
    return true;
  }

  // Anthropic は削除済み

  // Cerebras APIキー検証
  if (message.action === 'verifyCerebrasApiKey') {
    const apiKey = message.apiKey;
    if (!apiKey) {
      sendResponse({ error: normalizeError('Cerebras APIキーが未指定です') });
      return true;
    }
    const endpoint = 'https://api.cerebras.ai/v1/models';
    makeApiRequest(
      endpoint,
      { method: 'GET', headers: { 'Authorization': `Bearer ${apiKey}` } },
      'Cerebras APIキー検証中にエラーが発生'
    )
      .then(() => sendResponse({ result: { success: true } }))
      .catch((error) => sendResponse({ error: normalizeError(error) }));
    return true;
  }

  // Cerebras モデル一覧取得
  if (message.action === 'getCerebrasModels') {
    loadSettings().then((settings) => {
      const apiKey = message.apiKey || settings.cerebrasApiKey;
      const endpoint = apiKey
        ? 'https://api.cerebras.ai/v1/models'
        : 'https://api.cerebras.ai/public/v1/models?format=openrouter';
      const headers = apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {};
      makeApiRequest(endpoint, { method: 'GET', headers }, 'Cerebras モデル一覧取得中にエラーが発生')
        .then((result) => {
          const arr = Array.isArray(result?.data)
            ? result.data
            : (Array.isArray(result?.models) ? result.models : []);
          const models = arr.map((m) => ({
            id: m.id,
            name: m.name || m.id,
            context_length: m.context_length,
            pricing: m.pricing
          }));
          sendResponse({ models });
        })
        .catch((error) => sendResponse({ error: normalizeError(error) }));
    });
    return true;
  }

  // Gemini APIキー検証
  if (message.action === 'verifyGeminiApiKey') {
    const apiKey = message.apiKey;
    if (!apiKey) {
      sendResponse({ error: normalizeError('Gemini APIキーが未指定です') });
      return true;
    }
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
    makeApiRequest(endpoint, { method: 'GET' }, 'Gemini APIキー検証中にエラーが発生')
      .then(() => sendResponse({ result: { success: true } }))
      .catch((error) => sendResponse({ error: normalizeError(error) }));
    return true;
  }

  // Gemini モデル一覧取得
  if (message.action === 'getGeminiModels') {
    const apiKey = message.apiKey;
    if (!apiKey) {
      sendResponse({ error: normalizeError('Gemini APIキーが未指定です') });
      return true;
    }
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
    makeApiRequest(endpoint, { method: 'GET' }, 'Gemini モデル一覧取得中にエラーが発生')
      .then((result) => {
        const modelsArr = result.models || [];
        const models = modelsArr.map(m => ({ id: (m.name || '').replace('models/', ''), name: m.displayName || m.name, context_length: m.inputTokenLimit }));
        sendResponse({ models });
      })
      .catch((error) => sendResponse({ error: normalizeError(error) }));
    return true;
  }

  // Ollama モデル一覧取得
  if (message.action === 'getOllamaModels') {
    loadSettings().then(settings => {
      const server = (message.server || settings.ollamaServer || 'http://localhost:11434').replace(/\/$/, '');
      const endpoint = `${server}/api/tags`;
      makeApiRequest(endpoint, { method: 'GET' }, 'Ollama モデル一覧取得中にエラーが発生', 'info')
        .then((result) => {
          const arr = result.models || [];
          const models = arr.map(m => ({ id: m.name, name: m.name }));
          sendResponse({ models });
        })
        .catch((error) => sendResponse({ error: normalizeError(error) }));
    });
    return true;
  }

  // LM Studio モデル一覧取得 (OpenAI互換)
  if (message.action === 'getLmstudioModels') {
    loadSettings().then(settings => {
      const server = (message.server || settings.lmstudioServer || 'http://localhost:1234').replace(/\/$/, '');
      const endpoint = `${server}/v1/models`;
      const headers = {};
      const apiKey = message.apiKey || settings.lmstudioApiKey;
      if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
      log.info('messageHandlers', 'getLmstudioModels:start', {
        server,
        endpoint,
        hasApiKey: Boolean(apiKey)
      });
      makeApiRequest(endpoint, { method: 'GET', headers }, 'LM Studio モデル一覧取得中にエラーが発生', 'info')
        .then((result) => {
          const arr = result.data || [];
          const models = arr.map(m => ({ id: m.id, name: m.id }));
          log.info('messageHandlers', 'getLmstudioModels:response', {
            server,
            rawModelCount: Array.isArray(arr) ? arr.length : null,
            modelCount: models.length
          });
          sendResponse({ models });
        })
        .catch((error) => {
          log.warn('messageHandlers', 'getLmstudioModels:error', {
            server,
            message: error.message
          });
          sendResponse({ error: normalizeError(error) });
        });
    });
    return true;
  }

  // 他のメッセージタイプがあればここに追加

  return false; // 同期的に処理が完了したか、処理するハンドラがなかった場合
}
