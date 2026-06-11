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
