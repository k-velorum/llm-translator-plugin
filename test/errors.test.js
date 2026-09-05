import { describe, expect, it } from 'vitest';

import { canFallbackAfterError, formatUserError, normalizeError, serializeError } from '../src/shared/errors.js';

describe('normalizeError', () => {
  it('normalizes Error objects', () => {
    const error = new Error('失敗しました');
    error.status = 503;

    expect(normalizeError(error)).toMatchObject({
      name: 'Error',
      message: '失敗しました',
      status: 503
    });
  });

  it('normalizes plain strings', () => {
    expect(normalizeError('plain failure')).toEqual({
      message: 'plain failure',
      details: ''
    });
  });

  it('preserves existing message/details shapes', () => {
    expect(normalizeError({ message: 'bad request', details: 'stack', statusCode: 400 })).toMatchObject({
      message: 'bad request',
      details: 'stack',
      status: 400
    });
  });
});

describe('エラーの分類と対処方法', () => {
  it.each([
    [401, 'authentication', false], [402, 'payment_required', false],
    [403, 'permission_denied', false], [404, 'not_found', false],
    [429, 'rate_limited', true], [503, 'service_unavailable', true]
  ])('HTTP %s は形式変更で再送せず、分類をシリアライズ後も保持する', (status, code, retryable) => {
    const original = Object.assign(new Error('provider detail'), { status });
    const restored = JSON.parse(JSON.stringify(serializeError(original)));
    expect(restored).toMatchObject({ status, code, retryable, message: 'provider detail' });
    expect(canFallbackAfterError(restored)).toBe(false);
    expect(formatUserError(restored)).toContain(restored.hint);
    expect(normalizeError(restored).hint).toBe(restored.hint);
  });

  it('入力形式・サイズの問題は形式変更や分割を許可する', () => {
    for (const status of [400, 413, 422]) expect(canFallbackAfterError({ status })).toBe(true);
    expect(canFallbackAfterError(new Error('bad json'))).toBe(true);
  });

  it.each([
    ['TimeoutError', 'timeout', 'timeout'],
    ['AbortError', 'cancelled', 'cancelled'],
    ['TypeError', 'Failed to fetch', 'network']
  ])('%s の種別をメッセージ送受信後も維持する', (name, message, code) => {
    const restored = JSON.parse(JSON.stringify(serializeError({ name, message })));
    expect(normalizeError(restored).code).toBe(code);
    expect(canFallbackAfterError(restored)).toBe(false);
  });
});

describe('serializeError', () => {
  it('keeps a name field for offscreen responses', () => {
    expect(serializeError('failed')).toEqual({
      name: 'Error',
      message: 'failed',
      details: ''
    });
  });
});
