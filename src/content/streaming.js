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
  return window.LLMT?.settings?.capabilities?.supportsStreaming === true;
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

function updateStreamSessionStatus(requestId, phase) {
  const session = streamViewSessions.get(requestId);
  if (!session || session.closed || session.renderedText || session.pendingText) return;
  renderStreamSession(session, phase === 'loading' ? 'モデルを読み込み中…' : '処理中…');
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
  const message = [error?.message || 'ストリーム翻訳に失敗しました', error?.hint].filter(Boolean).join('\n');
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

async function requestSelectionSummary({ text, currentSummary, adjustment, popup, render }) {
  const requestId = createTranslationRequestId('summary');
  popup.dataset.requestId = requestId;
  const session = registerStreamSession(requestId, {
    kind: 'summary', state: 'running',
    render: (value, state) => {
      if (!state.isError) render(value);
    }
  });
  // 開始応答より先に完了・エラー・キャンセルが届いても未処理のrejectを残さない。
  const completed = session.promise.then(
    summary => ({ ok: true, data: { summary } }),
    error => ({ ok: false, error: { message: error.message } })
  );
  // 割り当て済みの会話IDを渡し、既存の要約会話を引き継ぐ。
  const payload = { text, currentSummary, adjustment, ...(popup.dataset.conversationId ? { conversationId: popup.dataset.conversationId } : {}) };
  const response = await window.LLMT.messaging.sendBackgroundMessage('startSummaryStream', { ...payload, requestId });
  if (!popup.isConnected) {
    if (response.ok && response.data.accepted) cancelTranslationStream(requestId);
    cancelLocalStreamSession(requestId);
    return { ok: false, error: { message: 'cancelled' } };
  }
  if (response.ok && response.data.accepted) {
    const conversationId = typeof response.data.conversationId === 'string' ? response.data.conversationId : '';
    // 追加指示フォームは会話IDが割り当てられた場合のみ表示する。
    if (conversationId) window.LLMT?.selection?.attachSelectionConversation?.(popup, conversationId, false, { kind: 'summary' });
    return completed;
  }
  cancelLocalStreamSession(requestId);
  popup.dataset.requestId = '';
  if (response.ok && response.data.reason === 'unsupported') {
    return window.LLMT.messaging.sendBackgroundMessage('summarizeSelection', payload);
  }
  return { ok: false, error: response.error || response.data?.error || { message: '要約を開始できませんでした。' } };
}

async function requestSelectionConversation({ text, conversationId, popup, render }) {
  const requestId = createTranslationRequestId('conversation');
  popup.dataset.requestId = requestId;
  const session = registerStreamSession(requestId, {
    kind: 'conversation', state: 'running',
    render: (value, state) => {
      if (!state.isError) render(value);
    }
  });
  // 開始応答より先に完了・エラー・キャンセルが届いても未処理のrejectを残さない。
  const completed = session.promise.then(
    answer => ({ ok: true, data: { answer } }),
    error => ({ ok: false, error: { message: error.message } })
  );
  const payload = { text, conversationId };
  const response = await window.LLMT.messaging.sendBackgroundMessage('continueSelectionConversation', { ...payload, requestId });
  if (!popup.isConnected) {
    if (response.ok && response.data.accepted) cancelTranslationStream(requestId);
    cancelLocalStreamSession(requestId);
    return { ok: false, error: { message: 'cancelled' } };
  }
  if (response.ok && response.data.accepted) return completed;
  cancelLocalStreamSession(requestId);
  popup.dataset.requestId = '';
  return { ok: false, error: response.error || response.data?.error || { message: '回答を取得できませんでした。' } };
}

window.LLMT = window.LLMT || {};
window.LLMT.streaming = {
  streamViewSessions,
  createTranslationRequestId,
  providerSupportsStreaming,
  cancelTranslationStream,
  registerStreamSession,
  discardStreamSession,
  findStreamSessionByElement,
  updateStreamSessionStatus,
  appendStreamSessionDelta,
  completeStreamSession,
  failStreamSession,
  cancelLocalStreamSession,
  startEmbeddedTranslationStream,
  requestSelectionSummary,
  requestSelectionConversation
};
Object.assign(window, window.LLMT.streaming);
})();
