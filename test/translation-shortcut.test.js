import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../src/background/selection-translation.js', () => ({
  translateAndNotify: vi.fn(), cancelSelectionStream: vi.fn()
}));
import { translateAndNotify } from '../src/background/selection-translation.js';
import { handleBackgroundMessage } from '../src/background/message-handlers.js';

const source = readFileSync(new URL('../src/content/runtime.js', import.meta.url), 'utf8');
function frame(focused, text, sender, activeElement = null) {
  const remember = vi.fn();
  const showTranslationPopup = vi.fn();
  const sendBackgroundMessage = vi.fn((action, payload) => new Promise(resolve => {
    handleBackgroundMessage({ action, ...payload }, sender, response => {
      resolve(response.error ? { ok: false, error: response.error } : { ok: true, data: response });
    });
  }));
  const window = { LLMT: { selectionReplacement: { remember }, messaging: { sendBackgroundMessage } },
    getSelection: () => ({ toString: () => text }), showTranslationPopup };
  runInNewContext(source, { window, document: { hasFocus: () => focused, activeElement },
    chrome: { runtime: { onMessage: { addListener() {} } } } });
  return { run: () => window.LLMT.runtime.runtimeMessageHandlers.translateFocusedSelection({}, {}, vi.fn()),
    remember, sendBackgroundMessage, showTranslationPopup };
}

describe('翻訳ショートカットのフレーム振り分け', () => {
  beforeEach(() => vi.resetAllMocks());
  it.each([false, true])('空iframeが先着=%sでも本文から一度だけ翻訳する', async emptyFirst => {
    const selected = frame(true, ' Selected text ', { tab: { id: 42 }, frameId: 0 });
    const empty = frame(false, '', { tab: { id: 42 }, frameId: 3 });
    for (const view of emptyFirst ? [empty, selected] : [selected, empty]) view.run();
    await vi.waitFor(() => expect(translateAndNotify).toHaveBeenCalledExactlyOnceWith(42, 'Selected text', 0, 'shortcut'));
    expect(selected.remember).toHaveBeenCalledWith('shortcut');
    expect(empty.sendBackgroundMessage).not.toHaveBeenCalled();
  });
  it('非フォーカス本文に古い選択があっても選択iframeへ返す', async () => {
    frame(true, 'Old selection', { tab: { id: 42 }, frameId: 0 }, { tagName: 'IFRAME' }).run();
    frame(true, 'Iframe selection', { tab: { id: 42 }, frameId: 7 }).run();
    await vi.waitFor(() => expect(translateAndNotify).toHaveBeenCalledExactlyOnceWith(42, 'Iframe selection', 7, 'shortcut'));
  });
  it('空の選択では翻訳も置換準備も開始しない', () => {
    const view = frame(true, '  ', { tab: { id: 42 }, frameId: 0 });
    view.run();
    expect(view.remember).not.toHaveBeenCalled();
    expect(view.sendBackgroundMessage).not.toHaveBeenCalled();
  });
  it('翻訳開始エラーを選択元で表示する', async () => {
    translateAndNotify.mockRejectedValue(new Error('接続できません'));
    const view = frame(true, 'Selected', { tab: { id: 42 }, frameId: 7 });
    view.run();
    await vi.waitFor(() => expect(view.showTranslationPopup).toHaveBeenCalledWith(expect.stringContaining('接続できません')));
  });
  it('送信元のないメッセージは拒否する', () => {
    const respond = vi.fn();
    handleBackgroundMessage({ action: 'translateSelection', text: 'Selected', tabId: 42, frameId: 7 }, {}, respond);
    expect(respond).toHaveBeenCalledWith({ error: expect.any(Object) });
    expect(translateAndNotify).not.toHaveBeenCalled();
  });
});
