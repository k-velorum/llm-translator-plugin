import { afterEach, describe, expect, it, vi } from 'vitest';

import { log, sanitizeForLog } from '../src/shared/logger.js';

import { createConfigurationError, serializeError } from '../src/shared/errors.js';
import { appendLog } from '../src/background/logging.js';

vi.mock('../src/background/logging.js', () => ({ appendLog: vi.fn(async () => {}) }));
afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); });

describe('sanitizeForLog', () => {
  it('redacts sensitive keys recursively', () => {
    expect(
      sanitizeForLog({
        apiKey: 'abc',
        nested: {
          Authorization: 'Bearer secret',
          value: 'visible'
        },
        list: [{ token: 'secret-token' }]
      })
    ).toEqual({
      apiKey: '[redacted]',
      nested: {
        Authorization: '[redacted]',
        value: 'visible'
      },
      list: [{ token: '[redacted]' }]
    });
  });
});


describe('Chromeに出すエラーと拡張内の警告の分離', () => {
  function captureConsole() {
    for (const method of ['error', 'warn', 'info']) vi.spyOn(console, method).mockImplementation(() => {});
  }

  it.each([400, 401, 402, 403, 404, 409, 429, 503])('HTTP %s は拡張内に警告と詳細を残す', (status) => {
    captureConsole();
    const error = Object.assign(new Error('provider detail'), { status });
    log.error('popup.testApi', '翻訳失敗', { error });
    expect(console.error).not.toHaveBeenCalled();
    expect(console.warn).not.toHaveBeenCalled();
    expect(console.info).toHaveBeenCalledOnce();
    expect(appendLog).toHaveBeenCalledWith(expect.objectContaining({ level: 'warn',
      meta: { error: expect.objectContaining({ status, message: 'provider detail' }) } }));
  });

  it('設定不足はシリアライズ後も内部警告として扱う', () => {
    captureConsole();
    log.error('api', '設定不足', JSON.parse(JSON.stringify(serializeError(createConfigurationError('モデル未選択')))));
    expect(console.error).not.toHaveBeenCalled();
    expect(appendLog).toHaveBeenCalledWith(expect.objectContaining({ level: 'warn' }));
  });

  it.each(['TimeoutError', 'AbortError'])('%s はChromeにエラーとして出さない', (name) => {
    captureConsole();
    log.error('api', '翻訳終了', Object.assign(new Error('finished'), { name }));
    expect(console.error).not.toHaveBeenCalled();
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('回復処理の警告は内部WARNを保ち、console.warnは使わない', () => {
    captureConsole();
    log.warn('pageTranslation', '原文を維持', new Error('invalid model response'));
    expect(console.warn).not.toHaveBeenCalled();
    expect(appendLog).toHaveBeenCalledWith(expect.objectContaining({ level: 'warn' }));
  });

  it('未知の例外はChromeと拡張内の両方にエラーとして残す', () => {
    captureConsole();
    log.error('api', '内部不具合', new TypeError('Cannot read properties of undefined'));
    expect(console.error).toHaveBeenCalledOnce();
    expect(appendLog).toHaveBeenCalledWith(expect.objectContaining({ level: 'error' }));
  });
});
