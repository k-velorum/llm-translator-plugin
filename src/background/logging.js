const LOG_KEY = 'pageTranslationLogs';
const LOG_MAX = 200;

function storageLocalGet(key) {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get(key, (data) => resolve(data || {}));
    } catch (_) {
      resolve({});
    }
  });
}

function storageLocalSet(obj) {
  return new Promise((resolve, reject) => {
    try {
      chrome.storage.local.set(obj, () => {
        if (chrome.runtime.lastError) return reject(chrome.runtime.lastError);
        resolve();
      });
    } catch (e) {
      reject(e);
    }
  });
}

export async function appendLog(entry) {
  try {
    const item = { ts: Date.now(), ...entry };
    const data = await storageLocalGet(LOG_KEY);
    const arr = Array.isArray(data[LOG_KEY]) ? data[LOG_KEY] : [];
    arr.push(item);
    while (arr.length > LOG_MAX) arr.shift();
    await storageLocalSet({ [LOG_KEY]: arr });
  } catch (_e) {
    // ログ失敗は処理を止めない。logger から呼ばれるためここでは再ログしない。
  }
}

export function getProviderMeta(settings) {
  const provider = settings?.apiProvider || 'unknown';
  if (provider === 'openrouter') return { provider: 'openrouter', model: settings.openrouterModel || '' };
  if (provider === 'gemini') return { provider: 'gemini', model: settings.geminiModel || '' };
  if (provider === 'cerebras') return { provider: 'cerebras', model: settings.cerebrasModel || '' };
  if (provider === 'zai') return { provider: 'zai', model: settings.zaiModel || '' };
  if (provider === 'ollama') return { provider: 'ollama', model: settings.ollamaModel || '' };
  if (provider === 'lmstudio') return { provider: 'lmstudio', model: settings.lmstudioModel || '' };
  if (provider === 'chromePrompt') return { provider: 'chromePrompt', model: 'Gemini Nano' };
  return { provider, model: '' };
}
