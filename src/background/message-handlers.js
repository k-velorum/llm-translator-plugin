import { loadSettings } from './settings.js';
import { translateText, makeApiRequest } from './api.js';
import { appendLog, getProviderMeta } from './logging.js';

// APIキー検証とモデル一覧取得の共通処理
async function handleApiRequest(action, apiKey, endpoint, headers, successCallback, errorCallback, settings) {

  try {
    let result;
    // 直接APIにアクセス
    result = await handleDirectRequest(endpoint, headers);
      successCallback(result);
  } catch (error) {
    console.error(`${action}エラー:`, error);
    errorCallback({ message: error.message, details: error.stack || '' });
  }
}

// 中間サーバー機能は削除

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
         console.warn('OpenRouter APIキー未設定のため、公開モデル一覧を取得します。');
         // ここで公開モデル取得のロジックを再度呼ぶか、デフォルトを返す
         // 今回は簡略化のため、エラーを返しつつ、popup.js側でデフォルトを使う想定
         sendResponse({ error: { message: 'APIキー未設定ですが、処理は継続します。', details: error.details } });
      } else {
        sendResponse({ error: error });
      }
    },
    settings
  );
}


// バックグラウンドでのメッセージ処理
export function handleBackgroundMessage(message, sender, sendResponse) {

  // ツイート翻訳リクエストの処理
  if (message.action === 'translateTweet') {
      loadSettings()
      .then(settings => {
        return translateText(message.text, settings, { timeoutMs: 180000 })
          .then(translatedText => {
            sendResponse({ translatedText: translatedText });
          })
          .catch(error => {
            console.error('ツイート翻訳エラー:', error);
            appendLog({
              level: 'error',
              type: 'translate',
              event: 'tweet_failed',
              ...getProviderMeta(settings),
              tabId: sender?.tab?.id,
              message: error?.message || String(error)
            });
            // エラーオブジェクト全体を送るのではなく、必要な情報だけ送る
            sendResponse({ error: { message: error.message, details: error.stack || '' } });
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
        return translateText(message.text, testSettings, { timeoutMs: 180000 })
          .then(result => {
            sendResponse({ result: result });
          })
          .catch(error => {
            console.error('テスト翻訳エラー:', error);
            appendLog({
              level: 'error',
              type: 'translate',
              event: 'test_failed',
              ...getProviderMeta(testSettings),
              tabId: sender?.tab?.id,
              message: error?.message || String(error)
            });
            sendResponse({ error: { message: error.message, details: error.stack || '' } });
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

  // Gemini APIキー検証
  if (message.action === 'verifyGeminiApiKey') {
    const apiKey = message.apiKey;
    if (!apiKey) {
      sendResponse({ error: { message: 'Gemini APIキーが未指定です' } });
      return true;
    }
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
    makeApiRequest(endpoint, { method: 'GET' }, 'Gemini APIキー検証中にエラーが発生')
      .then(() => sendResponse({ result: { success: true } }))
      .catch((error) => sendResponse({ error: { message: error.message, details: error.stack || '' } }));
    return true;
  }

  // Gemini モデル一覧取得
  if (message.action === 'getGeminiModels') {
    const apiKey = message.apiKey;
    if (!apiKey) {
      sendResponse({ error: { message: 'Gemini APIキーが未指定です' } });
      return true;
    }
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
    makeApiRequest(endpoint, { method: 'GET' }, 'Gemini モデル一覧取得中にエラーが発生')
      .then((result) => {
        const modelsArr = result.models || [];
        const models = modelsArr.map(m => ({ id: (m.name || '').replace('models/', ''), name: m.displayName || m.name, context_length: m.inputTokenLimit }));
        sendResponse({ models });
      })
      .catch((error) => sendResponse({ error: { message: error.message, details: error.stack || '' } }));
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
        .catch((error) => sendResponse({ error: { message: error.message, details: error.stack || '' } }));
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
      makeApiRequest(endpoint, { method: 'GET', headers }, 'LM Studio モデル一覧取得中にエラーが発生', 'info')
        .then((result) => {
          const arr = result.data || [];
          const models = arr.map(m => ({ id: m.id, name: m.id }));
          sendResponse({ models });
        })
        .catch((error) => sendResponse({ error: { message: error.message, details: error.stack || '' } }));
    });
    return true;
  }

  // 他のメッセージタイプがあればここに追加

  return false; // 同期的に処理が完了したか、処理するハンドラがなかった場合
}
