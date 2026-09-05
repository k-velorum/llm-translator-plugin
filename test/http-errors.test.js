import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeApiRequest, makeStreamingApiRequest } from '../src/background/api/http.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe.each([
  ['通常応答', () => makeApiRequest('https://api.example.test/v1/chat/completions', {}, 'test')],
  ['ストリーミング', () => makeStreamingApiRequest('https://api.example.test/v1/chat/completions', {}, {}, 'test')]
])('HTTPエラー詳細: %s', (_name, request) => {
  it.each([
    [402, '{"error":{"message":"Insufficient credits"}}', 'Insufficient credits'],
    [400, '{"message":"Unsupported parameter"}', 'Unsupported parameter'],
    [401, '{"error":"Invalid API key"}', 'Invalid API key'],
    [403, 'Access denied', 'Access denied'],
    [400, '{invalid JSON', '{invalid JSON'],
    [402, '', 'Payment Required']
  ])('HTTP %s の本文を消費後も詳細とステータスを保持する', async (status, body, detail) => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    // 実際のResponseを使い、本文の二重読み取りを再現する。
    const response = new Response(body, { status });
    const fetch = vi.fn(async () => response);
    vi.stubGlobal('fetch', fetch);

    await expect(request()).rejects.toMatchObject({
      status,
      message: expect.stringContaining(detail)
    });
    expect(response.bodyUsed).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('本文の読み取り失敗時もHTTP 402の案内を残す', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 402,
      text: async () => { throw new Error('body unavailable'); }
    })));
    await expect(request()).rejects.toMatchObject({
      status: 402,
      code: 'payment_required',
      retryable: false,
      hint: expect.stringContaining('残高・請求設定・モデルの利用条件')
    });
  });
});
