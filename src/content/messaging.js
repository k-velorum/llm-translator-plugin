(() => {
  'use strict';

function canUseExtensionRuntime() {
  try {
    return !!(chrome?.runtime?.id && chrome?.runtime?.sendMessage);
  } catch {
    return false;
  }
}

function normalizeMessagingError(error) {
  const message = error?.message || String(error || 'sendMessage failed');
  if (/Extension context invalidated/i.test(message)) {
    return { message: '拡張との接続が切れました。このページを再読み込みしてから翻訳してください。' };
  }
  return { ...error, message };
}

function normalizeMessageResponse(response) {
  if (!response) {
    return { ok: false, error: { message: 'No response from background script' } };
  }
  if (response.error) {
    return { ok: false, error: typeof response.error === 'object'
      ? { ...response.error, message: [response.error.message, response.error.hint].filter(Boolean).join('\n'), hint: '' }
      : { message: String(response.error) } };
  }
  return { ok: true, data: response };
}

function sendBackgroundMessage(action, payload = {}) {
  return new Promise((resolve) => {
    if (!canUseExtensionRuntime()) {
      resolve({ ok: false, error: { message: '拡張との接続が切れました。このページを再読み込みしてから翻訳してください。' } });
      return;
    }

    try {
      chrome.runtime.sendMessage({ action, ...payload }, (response) => {
        if (chrome.runtime?.lastError) {
          resolve({
            ok: false,
            error: normalizeMessagingError(chrome.runtime.lastError)
          });
          return;
        }
        resolve(normalizeMessageResponse(response));
      });
    } catch (error) {
      resolve({ ok: false, error: normalizeMessagingError(error) });
    }
  });
}

function safeSendMessage(payload, callback) {
  if (!canUseExtensionRuntime()) {
    if (typeof callback === 'function') {
      try { callback({ error: { message: '拡張との接続が切れました。このページを再読み込みしてから翻訳してください。' } }); } catch {}
    }
    return false;
  }

  const { action, ...data } = payload || {};
  sendBackgroundMessage(action, data).then((result) => {
    const response = result.ok ? result.data : { error: result.error };
    if (typeof callback === 'function') {
      try { callback(response); } catch {}
    }
  });
  return true;
}

window.LLMT = window.LLMT || {};
window.LLMT.messaging = {
  canUseExtensionRuntime,
  normalizeMessageResponse,
  sendBackgroundMessage,
  safeSendMessage
};
window.canUseExtensionRuntime = canUseExtensionRuntime;
window.safeSendMessage = safeSendMessage;
})();
