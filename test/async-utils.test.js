import { afterEach, describe, expect, it, vi } from 'vitest';
import { withTimeout } from '../src/shared/async-utils.js';

afterEach(() => vi.useRealTimers());

describe('withTimeout', () => {
  it('期限で処理用signalをabortし、後からの応答は採用しない', async () => {
    vi.useFakeTimers();
    let signal;
    let resolve;
    const result = withTimeout((s) => {
      signal = s;
      return new Promise((r) => { resolve = r; });
    }, 100);
    const assertion = expect(result).rejects.toMatchObject({ name: 'TimeoutError' });
    await vi.advanceTimersByTimeAsync(100);
    await assertion;
    expect(signal.aborted).toBe(true);
    resolve('late');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('中断済みsignalでは処理を開始しない', async () => {
    const controller = new AbortController();
    controller.abort();
    const operation = vi.fn();
    await expect(withTimeout(operation, 100, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(operation).not.toHaveBeenCalled();
  });

  it('成功時と同期例外でもtimerを残さない', async () => {
    vi.useFakeTimers();
    await expect(withTimeout(() => Promise.resolve('ok'), 100)).resolves.toBe('ok');
    await expect(withTimeout(() => { throw new Error('bad'); }, 100)).rejects.toThrow('bad');
    expect(vi.getTimerCount()).toBe(0);
  });
});
