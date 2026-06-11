import { normalizeError } from '../shared/errors.js';

function buildFrameSendOptions(frameId) {
  return Number.isInteger(frameId) && frameId >= 0 ? { frameId } : undefined;
}

export async function sendMessageToFrame(tabId, frameId, payload) {
  return chrome.tabs.sendMessage(tabId, payload, buildFrameSendOptions(frameId));
}

export function normalizeStreamError(error) {
  return normalizeError(error);
}

export function createStreamEventEmitter({
  tabId,
  frameId,
  requestId,
  kind,
  flushIntervalMs = 50,
  onFatalError
}) {
  let seq = 0;
  let deltaBuffer = '';
  let flushTimer = null;
  let closed = false;
  let sendChain = Promise.resolve();

  const handleFatalError = (error) => {
    if (typeof onFatalError === 'function') {
      try { onFatalError(error); } catch (_) {}
    }
  };

  const enqueue = (task) => {
    sendChain = sendChain.then(task);
    sendChain.catch(handleFatalError);
    return sendChain;
  };

  const flushNow = () => enqueue(async () => {
    if (closed || !deltaBuffer) return;
    const deltaText = deltaBuffer;
    deltaBuffer = '';
    seq += 1;
    await sendMessageToFrame(tabId, frameId, {
      action: 'translationStreamDelta',
      requestId,
      seq,
      deltaText
    });
  });

  const clearPendingFlush = () => {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
  };

  const scheduleFlush = () => {
    if (closed || flushTimer) return;
    flushTimer = setTimeout(() => {
      flushTimer = null;
      flushNow().catch(handleFatalError);
    }, flushIntervalMs);
  };

  return {
    async start(meta) {
      await enqueue(async () => {
        await sendMessageToFrame(tabId, frameId, {
          action: 'translationStreamStart',
          requestId,
          kind,
          meta
        });
      });
    },
    async pushDelta(deltaText) {
      if (closed || typeof deltaText !== 'string' || !deltaText.length) return;
      deltaBuffer += deltaText;
      scheduleFlush();
    },
    async flush() {
      clearPendingFlush();
      await flushNow();
    },
    async complete(finalText) {
      if (closed) return;
      clearPendingFlush();
      await flushNow();
      closed = true;
      await enqueue(async () => {
        await sendMessageToFrame(tabId, frameId, {
          action: 'translationStreamComplete',
          requestId,
          finalText
        });
      });
    },
    async error(error) {
      if (closed) return;
      clearPendingFlush();
      deltaBuffer = '';
      closed = true;
      await enqueue(async () => {
        await sendMessageToFrame(tabId, frameId, {
          action: 'translationStreamError',
          requestId,
          error: normalizeStreamError(error)
        });
      });
    },
    async cancelled() {
      if (closed) return;
      clearPendingFlush();
      deltaBuffer = '';
      closed = true;
      await enqueue(async () => {
        await sendMessageToFrame(tabId, frameId, {
          action: 'translationStreamCancelled',
          requestId
        });
      });
    },
    async dispose() {
      clearPendingFlush();
      deltaBuffer = '';
      closed = true;
      try {
        await sendChain;
      } catch (_) {
        // no-op
      }
    }
  };
}
