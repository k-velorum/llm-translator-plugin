export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function sleepWithSignal(ms, signal) {
  if (!ms || ms <= 0) return Promise.resolve();
  if (!signal) return sleep(ms);

  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(createAbortError());
      return;
    }

    const timeoutId = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);

    const onAbort = () => {
      clearTimeout(timeoutId);
      cleanup();
      reject(createAbortError());
    };

    const cleanup = () => {
      try {
        signal.removeEventListener('abort', onAbort);
      } catch (_) {}
    };

    signal.addEventListener('abort', onAbort, { once: true });
  });
}

export function createAbortError() {
  const error = new Error('The operation was aborted');
  error.name = 'AbortError';
  return error;
}

// API実装やメッセージ受信側が応答しなくても呼び出し元を解放する。
// signal も渡すことで、時間切れ後の通信・推論・再試行を中断する。
export async function withTimeout(operation, timeoutMs, signal) {
  const controller = new AbortController();
  let timer;
  let onAbort;
  const interrupted = new Promise((_, reject) => {
    onAbort = () => {
      reject(createAbortError());
      controller.abort();
    };
    if (signal?.aborted) return onAbort();
    signal?.addEventListener('abort', onAbort, { once: true });
    timer = setTimeout(() => {
      const error = new Error(`応答が ${timeoutMs}ms 以内に返りませんでした`);
      error.name = 'TimeoutError';
      reject(error);
      controller.abort();
    }, Math.max(0, timeoutMs));
  });
  try {
    if (signal?.aborted) return await interrupted;
    return await Promise.race([interrupted, operation(controller.signal)]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}
