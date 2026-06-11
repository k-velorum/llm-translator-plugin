(() => {
  'use strict';

const STREAM_RENDER_INTERVAL_MS = 50;
const streamViewSessions = new Map();

function createTranslationRequestId(kind = 'translate') {
  try {
    if (typeof crypto?.randomUUID === 'function') {
      return `${kind}-${crypto.randomUUID()}`;
    }
  } catch {}
  return `${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function providerSupportsStreaming() {
  return tweetTranslationCacheSettings.apiProvider === 'lmstudio'
    || tweetTranslationCacheSettings.apiProvider === 'cerebras';
}

function cancelTranslationStream(requestId) {
  if (!requestId) return;
  safeSendMessage({ action: 'cancelTranslationStream', requestId }, () => {});
}

function registerStreamSession(requestId, session) {
  const base = {
    requestId,
    renderedText: '',
    pendingText: '',
    renderTimer: null,
    closed: false,
    resolve: null,
    reject: null,
    render: null
  };
  const fullSession = { ...base, ...session };

  if (session.withPromise !== false && !fullSession.promise) {
    fullSession.promise = new Promise((resolve, reject) => {
      fullSession.resolve = resolve;
      fullSession.reject = reject;
    });
  } else if (!fullSession.promise) {
    fullSession.promise = Promise.resolve('');
  }

  streamViewSessions.set(requestId, fullSession);
  return fullSession;
}

function clearStreamSessionTimer(session) {
  if (session?.renderTimer) {
    clearTimeout(session.renderTimer);
    session.renderTimer = null;
  }
}

function discardStreamSession(requestId, { removeElement = false } = {}) {
  const session = streamViewSessions.get(requestId);
  if (!session) return;
  clearStreamSessionTimer(session);
  session.closed = true;
  if (removeElement && session.element?.parentNode) {
    session.element.parentNode.removeChild(session.element);
  }
  streamViewSessions.delete(requestId);
}

function findStreamSessionByElement(kind, element) {
  for (const session of streamViewSessions.values()) {
    if (session.kind === kind && session.element === element) {
      return session;
    }
  }
  return null;
}

function renderStreamSession(session, text, { isError = false, isCompleted = false } = {}) {
  if (!session?.render) return;
  session.render(text, { isError, isCompleted, session });
}

function flushStreamSession(requestId) {
  const session = streamViewSessions.get(requestId);
  if (!session || session.closed || !session.pendingText) return;
  session.renderedText += session.pendingText;
  session.pendingText = '';
  renderStreamSession(session, session.renderedText);
}

function scheduleStreamSessionRender(requestId) {
  const session = streamViewSessions.get(requestId);
  if (!session || session.closed || session.renderTimer) return;
  session.renderTimer = setTimeout(() => {
    session.renderTimer = null;
    flushStreamSession(requestId);
  }, STREAM_RENDER_INTERVAL_MS);
}

function appendStreamSessionDelta(requestId, deltaText) {
  const session = streamViewSessions.get(requestId);
  if (!session || session.closed || typeof deltaText !== 'string' || !deltaText.length) return;
  session.pendingText += deltaText;
  scheduleStreamSessionRender(requestId);
}

function completeStreamSession(requestId, finalText) {
  const session = streamViewSessions.get(requestId);
  if (!session || session.closed) return;
  clearStreamSessionTimer(session);
  session.pendingText = '';
  session.renderedText = typeof finalText === 'string' ? finalText : session.renderedText;
  session.state = 'completed';
  renderStreamSession(session, session.renderedText, { isCompleted: true });
  session.closed = true;
  session.resolve?.(session.renderedText);
  streamViewSessions.delete(requestId);
}

function failStreamSession(requestId, error) {
  const session = streamViewSessions.get(requestId);
  if (!session || session.closed) return;
  clearStreamSessionTimer(session);
  session.pendingText = '';
  const message = error?.message || 'ストリーム翻訳に失敗しました';
  const errorText = `翻訳エラー: ${message}`;
  session.renderedText = errorText;
  session.state = 'error';
  renderStreamSession(session, errorText, { isError: true });
  session.closed = true;
  session.reject?.(new Error(message));
  streamViewSessions.delete(requestId);
}

function cancelLocalStreamSession(requestId, { removeElement = false } = {}) {
  const session = streamViewSessions.get(requestId);
  if (!session) return;
  session.reject?.(new Error('cancelled'));
  discardStreamSession(requestId, { removeElement });
}

function startEmbeddedTranslationStream({ kind, text, render, element, meta }) {
  const requestId = createTranslationRequestId(kind);
  const session = registerStreamSession(requestId, {
    kind,
    element,
    render,
    state: 'running'
  });

  safeSendMessage(
    { action: 'startTranslationStream', requestId, kind, text, meta },
    (response) => {
      if (response?.error) {
        failStreamSession(requestId, response.error);
        return;
      }
      if (!response?.accepted) {
        const reason = response?.reason || 'unsupported';
        failStreamSession(requestId, { message: reason });
      }
    }
  );

  return {
    requestId,
    promise: session.promise
  };
}

window.LLMT = window.LLMT || {};
window.LLMT.streaming = {
  createTranslationRequestId,
  providerSupportsStreaming,
  cancelTranslationStream,
  registerStreamSession,
  discardStreamSession,
  findStreamSessionByElement,
  appendStreamSessionDelta,
  completeStreamSession,
  failStreamSession,
  cancelLocalStreamSession,
  startEmbeddedTranslationStream
};
Object.assign(window, window.LLMT.streaming);
})();
