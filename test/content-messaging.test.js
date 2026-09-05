import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const script = readFileSync(new URL('../src/content/messaging.js', import.meta.url), 'utf8');

function loadMessaging(runtime) {
  const context = { window: {}, chrome: { runtime } };
  runInNewContext(script, context);
  return context.window.LLMT.messaging;
}

describe('contentとbackground間のエラー表示', () => {
  it.each(['missing', 'callback', 'throw'])('拡張接続切れ (%s) はページ再読み込みを案内する', async (mode) => {
    const runtime = mode === 'missing' ? {} : {
      id: 'test',
      sendMessage: vi.fn((_payload, callback) => {
        if (mode === 'throw') throw new Error('Extension context invalidated.');
        runtime.lastError = { message: 'Extension context invalidated.' };
        callback();
      })
    };
    const result = await loadMessaging(runtime).sendBackgroundMessage('test');
    expect(result).toMatchObject({ ok: false, error: { message: expect.stringContaining('再読み込み') } });
  });

  it('従来のmessageだけを表示する画面にも対処方法を渡す', async () => {
    const messaging = loadMessaging({ id: 'test', sendMessage: (_payload, cb) => cb({
      error: { status: 402, message: 'Insufficient credits', hint: '残高を確認してください。' }
    }) });
    const result = await messaging.sendBackgroundMessage('test');
    expect(result.error.message).toBe('Insufficient credits\n残高を確認してください。');
    expect(result.error.status).toBe(402);
  });
});
