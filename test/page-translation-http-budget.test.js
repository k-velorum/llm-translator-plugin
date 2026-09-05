import { afterEach, describe, expect, it, vi } from 'vitest';
import { translateChunk } from '../src/background/page-translation/translator.js';

const settings = { apiProvider: 'lmstudio', lmstudioServer: 'http://localhost:1234', lmstudioModel: 'test' };
const params = { sep: '|||', maxChars: 3500, delayMs: 0, useStructuredOutput: true };

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('ページ翻訳のHTTP再試行を含めた期限', () => {
  it('HTTP 500の待機中に期限を迎えたら再試行・形式切替を止める', async () => {
    vi.useFakeTimers();
    const signals = [];
    const fetch = vi.fn(async (_url, options) => {
      signals.push(options.signal);
      if (signals.length === 2) await new Promise((resolve) => setTimeout(resolve, 2700));
      return { ok: false, status: 500 };
    });
    vi.stubGlobal('fetch', fetch);
    const running = translateChunk(['one', 'two'], settings, params, { deadlineAt: Date.now() + 3000 });
    await vi.advanceTimersByTimeAsync(3000);
    expect(await running).toMatchObject({ parts: [null, null], method: 'timeout' });
    expect(signals[1].aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(10000);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('レスポンス本文が返らなくても期限で次の処理へ戻る', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(async () => ({ ok: true, json: () => new Promise(() => {}) }));
    vi.stubGlobal('fetch', fetch);
    const running = translateChunk(['one', 'two'], settings, params, { deadlineAt: Date.now() + 3000 });
    await vi.advanceTimersByTimeAsync(3000);
    expect(await running).toMatchObject({ parts: [null, null], failedItems: 2 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
