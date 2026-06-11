function canUseExtensionRuntime() {
  try {
    return !!(chrome?.runtime?.id && chrome?.runtime?.sendMessage);
  } catch {
    return false;
  }
}

function normalizeMessageResponse(response) {
  if (!response) {
    return { ok: false, error: { message: 'No response from background script' } };
  }
  if (response.error) {
    return { ok: false, error: response.error };
  }
  return { ok: true, data: response };
}

function sendBackgroundMessage(action, payload = {}) {
  return new Promise((resolve) => {
    if (!canUseExtensionRuntime()) {
      resolve({ ok: false, error: { message: 'Extension context invalidated' } });
      return;
    }

    try {
      chrome.runtime.sendMessage({ action, ...payload }, (response) => {
        if (chrome.runtime?.lastError) {
          resolve({
            ok: false,
            error: { message: chrome.runtime.lastError.message || 'sendMessage failed' }
          });
          return;
        }
        resolve(normalizeMessageResponse(response));
      });
    } catch (error) {
      resolve({ ok: false, error: { message: error?.message || 'sendMessage failed' } });
    }
  });
}

function safeSendMessage(payload, callback) {
  if (!canUseExtensionRuntime()) {
    if (typeof callback === 'function') {
      try { callback({ error: { message: 'Extension context invalidated' } }); } catch {}
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
