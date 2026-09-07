import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
const source = readFileSync(new URL('../src/content/streaming.js', import.meta.url), 'utf8');

function setup(sendBackgroundMessage) {
  const window = { LLMT: { messaging: { sendBackgroundMessage } } };
  const safeSendMessage = vi.fn();
  runInNewContext(source, { window, safeSendMessage, setTimeout, clearTimeout });
  const popup = { dataset: {}, isConnected: true };
  const render = vi.fn();
  return { window, popup, render, safeSendMessage, start: () => window.requestSelectionSummary({
    text: '原文', currentSummary: '現在の要約', adjustment: 'shorter', popup, render
  }) };
}

describe('要約ストリームの終了とフォールバック', () => {
  it('非対応の場合だけ一括応答へ戻し原文と調整を保持する', async () => {
    const send = vi.fn().mockResolvedValueOnce({ ok: true, data: { accepted: false, reason: 'unsupported' } })
      .mockResolvedValueOnce({ ok: true, data: { summary: '短い要約' } });
    const view = setup(send);
    expect(await view.start()).toEqual({ ok: true, data: { summary: '短い要約' } });
    expect(send).toHaveBeenLastCalledWith('summarizeSelection', { text: '原文', currentSummary: '現在の要約', adjustment: 'shorter' });
    expect(view.window.streamViewSessions.size).toBe(0);
    expect(view.popup.dataset.requestId).toBe('');
  });
  it('開始エラーを再リクエストせず返す', async () => {
    const send = vi.fn().mockResolvedValue({ ok: false, error: { message: '接続エラー' } });
    const view = setup(send);
    expect(await view.start()).toMatchObject({ ok: false, error: { message: '接続エラー' } });
    expect(send).toHaveBeenCalledOnce();
    expect(view.window.streamViewSessions.size).toBe(0);
  });
  it('開始応答を待つ間に閉じた場合も受理後にキャンセルする', async () => {
    let accept;
    const view = setup(() => new Promise(resolve => { accept = resolve; }));
    const result = view.start();
    const requestId = view.popup.dataset.requestId;
    view.popup.isConnected = false;
    view.window.cancelLocalStreamSession(requestId);
    accept({ ok: true, data: { accepted: true } });
    expect(await result).toMatchObject({ ok: false });
    expect(view.safeSendMessage).toHaveBeenCalledWith({ action: 'cancelTranslationStream', requestId }, expect.any(Function));
    expect(view.window.streamViewSessions.size).toBe(0);
  });
  it('受理後のキャンセルで待機を解放し遅延差分を無視する', async () => {
    const view = setup(async () => ({ ok: true, data: { accepted: true } }));
    const result = view.start();
    await Promise.resolve();
    const requestId = view.popup.dataset.requestId;
    view.window.cancelLocalStreamSession(requestId);
    view.window.appendStreamSessionDelta(requestId, '遅延差分');
    expect(await result).toMatchObject({ ok: false, error: { message: 'cancelled' } });
    expect(view.render).not.toHaveBeenCalled();
  });
});
