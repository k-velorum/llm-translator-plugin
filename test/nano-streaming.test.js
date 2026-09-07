import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/background/logging.js', () => ({ appendLog: vi.fn(async () => {}), getProviderMeta: () => ({}) }));
const settings = { apiProvider: 'chromePrompt' };
const source = name => readFileSync(new URL(`../src/content/${name}.js`, import.meta.url), 'utf8');
let listeners, controllers, sessions, api, handlers, view, render, sender;

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  listeners = new Set(); controllers = []; sessions = [];
  sender = { tab: { id: 1 }, frameId: 3 };
  const runtime = {
    id: 'extension', getURL: path => `chrome-extension://extension/${path}`,
    getContexts: vi.fn(async () => [{}]),
    onMessage: { addListener: listener => listeners.add(listener), removeListener: listener => listeners.delete(listener) },
    sendMessage(message, callback) {
      const promise = new Promise(resolve => {
        let pending = false;
        const from = { id: runtime.id, url: runtime.getURL(message.target === 'chromePromptClient' ? 'offscreen.html' : 'background.js') };
        for (const listener of [...listeners]) {
          if (listener(message, from, resolve) === true) pending = true;
        }
        if (!pending) resolve(undefined);
      });
      if (callback) { promise.then(callback); return; }
      return promise;
    }
  };
  vi.stubGlobal('chrome', { runtime, offscreen: { createDocument: vi.fn() },
    storage: { sync: { get: (defaults, callback) => callback({ ...defaults, ...settings }) } },
    tabs: { sendMessage: vi.fn(async (_tabId, message) => {
      let result;
      view.LLMT.runtime.runtimeMessageHandlers[message.action]?.(message, sender, value => { result = value; });
      return result;
    }) }
  });
  vi.stubGlobal('self', globalThis);
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('No HTTP requests expected')));
  vi.stubGlobal('LanguageModel', {
    availability: vi.fn(async () => 'available'),
    create: vi.fn(async () => {
      const session = { destroy: vi.fn(), prompt: vi.fn(async () => '一括結果'),
        promptStreaming: vi.fn((_input, { signal }) => new ReadableStream({
          start(controller) {
            controllers.push(controller);
            signal.addEventListener('abort', () => controller.error(new DOMException('aborted', 'AbortError')), { once: true });
          }
        })) };
      sessions.push(session);
      return session;
    })
  });
  await import('../src/offscreen/chrome-prompt-runtime.js');
  api = await import('../src/background/api.js');
  handlers = await import('../src/background/message-handlers.js');
  view = { LLMT: {} };
  render = vi.fn();
  const context = { window: view, chrome: globalThis.chrome, setTimeout, clearTimeout,
    safeSendMessage: (message, callback) => handlers.handleBackgroundMessage(message, sender, callback) };
  runInNewContext(source('streaming'), context);
  Object.assign(context, view);
  runInNewContext(source('runtime'), context);
  view.prepareSelectionTranslationStream = () => {
    const id = view.createTranslationRequestId('popup');
    view.registerStreamSession(id, { render, withPromise: false });
    return id;
  };
  view.resolveImageAnchorRect = () => ({ left: 0, top: 0, right: 5, bottom: 5, width: 5, height: 5 });
  view.showLoadingPopup = vi.fn();
  view.LLMT.messaging = { sendBackgroundMessage: (action, payload) => new Promise(resolve => {
    handlers.handleBackgroundMessage({ action, ...payload }, sender, data => resolve({ ok: true, data }));
  }) };
});

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

async function startGeneration() {
  await vi.advanceTimersByTimeAsync(0);
  expect(controllers).toHaveLength(1);
  return controllers[0];
}

describe('Nano: offscreenから各表示経路までのストリーム', () => {
  it.each(['selection', 'image', 'tweet', 'youtube'])('%sで完了前に表示し、セッションを解放する', async kind => {
    const before = listeners.size;
    const running = kind === 'selection'
      ? (await import('../src/background/selection-translation.js')).translateAndNotify(1, 'hello', 3)
      : kind === 'image'
        ? (await import('../src/background/image-translation.js')).translateImageAndNotify(1, 'data:image/png;base64,AA==', 3)
        : view.startEmbeddedTranslationStream({ kind, text: 'hello', render }).promise;
    const controller = await startGeneration();
    controller.enqueue('こん');
    await vi.advanceTimersByTimeAsync(100);
    expect(render).toHaveBeenLastCalledWith('こん', expect.objectContaining({ isCompleted: false }));
    expect(sessions[0].destroy).not.toHaveBeenCalled();
    controller.enqueue('にちは'); controller.close();
    await running;
    expect(render).toHaveBeenLastCalledWith('こんにちは', expect.objectContaining({ isCompleted: true }));
    expect(view.streamViewSessions.size).toBe(0);
    expect(listeners.size).toBe(before);
    expect(sessions[0].destroy).toHaveBeenCalledOnce();
    expect(fetch).not.toHaveBeenCalled();
    if (kind === 'image') expect(sessions[0].promptStreaming.mock.calls[0][0][0].content[1].value).toBeInstanceOf(Blob);
  });

  it.each(['initial', 'shorter', 'longer'])('要約 %s も途中表示する', async adjustment => {
    const running = view.requestSelectionSummary({ text: '原文', currentSummary: '現在の要約', adjustment,
      popup: { dataset: {}, isConnected: true }, render });
    const controller = await startGeneration();
    controller.enqueue('要点');
    await vi.advanceTimersByTimeAsync(100);
    expect(render).toHaveBeenLastCalledWith('要点');
    const system = globalThis.LanguageModel.create.mock.calls[0][0].initialPrompts[0].content;
    expect(system).toContain('日本語で要約');
    expect(system).not.toContain('翻訳結果のみ');
    controller.enqueue('と根拠'); controller.close();
    expect(await running).toEqual({ ok: true, data: { summary: '要点と根拠' } });
  });

  it('ページ翻訳は途中の訳文をプレビューし、完了したJSONだけを返す', async () => {
    const { translateChunk } = await import('../src/background/page-translation/translator.js');
    const preview = vi.fn();
    let completed = false;
    const running = translateChunk(['one', 'two'], settings, { delayMs: 0 }, { timeoutMs: 5000, onPreview: preview })
      .then(result => { completed = true; return result; });
    const controller = await startGeneration();
    controller.enqueue('{"items":[[0,"一');
    await vi.advanceTimersByTimeAsync(100);
    // 最初の差分が時刻0の場合も、次の差分でプレビューが更新される。
    controller.enqueue('番');
    await vi.advanceTimersByTimeAsync(100);
    expect(preview).toHaveBeenLastCalledWith('一番');
    expect(completed).toBe(false);
    controller.enqueue('"],[1,"二番"]]}'); controller.close();
    expect(await running).toMatchObject({ parts: ['一番', '二番'], method: 'structured' });
  });

  it('選択置換はHTMLをプレビューに挿入せず、完了後だけ確定処理へ送る', async () => {
    const { translateSelectionReplacement } = await import('../src/background/selection-replacement.js');
    globalThis.chrome.tabs.sendMessage.mockImplementation(async (_tab, message) => {
      if (message.action === 'prepareSelectionReplacement') return { requestId: 'replace', paragraphs: [{ id: 0, children: ['hello'] }] };
      if (message.action === 'finishSelectionReplacement') return { ok: true };
    });
    const running = translateSelectionReplacement(1, 'hello', 3, settings);
    const controller = await startGeneration();
    controller.enqueue('<p id="p0">こん');
    await vi.advanceTimersByTimeAsync(100);
    expect(globalThis.chrome.tabs.sendMessage).toHaveBeenCalledWith(1,
      { action: 'previewSelectionReplacement', requestId: 'replace', previewText: 'こん' }, { frameId: 3 });
    expect(globalThis.chrome.tabs.sendMessage.mock.calls.some(([, message]) => message.action === 'finishSelectionReplacement')).toBe(false);
    controller.enqueue('にちは</p>'); controller.close(); await running;
    expect(globalThis.chrome.tabs.sendMessage).toHaveBeenLastCalledWith(1, {
      action: 'finishSelectionReplacement', requestId: 'replace', translations: [{ id: 0, children: ['こんにちは'] }], error: ''
    }, { frameId: 3 });
  });

  it('閉じた後は中断をNanoへ伝え、遅延した完了で再表示しない', async () => {
    const { translateAndNotify, cancelSelectionStream } = await import('../src/background/selection-translation.js');
    const running = translateAndNotify(1, 'hello', 3);
    await startGeneration();
    const id = [...view.streamViewSessions.keys()][0];
    expect(cancelSelectionStream(id)).toBe(true);
    view.cancelLocalStreamSession(id);
    await running; await vi.advanceTimersByTimeAsync(0);
    expect(sessions[0].destroy).toHaveBeenCalledOnce();
    expect(render).not.toHaveBeenCalled();
    expect(view.streamViewSessions.size).toBe(0);
  });

  it('途中エラーを一括で再生成せず、表示にも伝える', async () => {
    const running = view.startEmbeddedTranslationStream({ kind: 'tweet', text: 'hello', render }).promise;
    const rejected = expect(running).rejects.toThrow('model failure');
    const controller = await startGeneration();
    controller.enqueue('途中'); await vi.advanceTimersByTimeAsync(100);
    controller.error(new Error('model failure'));
    await rejected;
    expect(sessions[0].prompt).not.toHaveBeenCalled();
    expect(sessions[0].destroy).toHaveBeenCalledOnce();
    expect(render).toHaveBeenLastCalledWith(expect.stringContaining('model failure'), expect.objectContaining({ isError: true }));
  });

  it('promptStreamingのない環境では一括結果を同じ契約で返す', async () => {
    globalThis.LanguageModel.create.mockImplementationOnce(async () => ({ prompt: async () => '一括結果', destroy: vi.fn() }));
    const onDelta = vi.fn();
    expect(await api.translateTextStream('hello', settings, { onDelta })).toBe('一括結果');
    expect(onDelta).toHaveBeenCalledWith('一括結果', '一括結果');
  });

  it('タイムアウト時はNanoを中断し、メッセージリスナーを解放する', async () => {
    const before = listeners.size;
    const running = api.translateTextStream('hello', settings, {}, { timeoutMs: 250 });
    const rejected = expect(running).rejects.toMatchObject({ name: 'TimeoutError' });
    await startGeneration();
    await vi.advanceTimersByTimeAsync(300);
    await rejected;
    expect(listeners.size).toBe(before);
    expect(sessions[0].destroy).toHaveBeenCalledOnce();
  });
});
