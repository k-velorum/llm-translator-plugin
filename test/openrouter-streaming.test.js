import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { translateTextStream } from '../src/background/api.js';
import { translateAndNotify } from '../src/background/selection-translation.js';
import { handleBackgroundMessage } from '../src/background/message-handlers.js';

vi.mock('../src/background/settings.js', async (importOriginal) => ({
  ...await importOriginal(),
  loadSettings: async () => ({
    apiProvider: 'openrouter',
    openrouterApiKey: 'test-key',
    openrouterModel: 'test/model'
  })
}));
vi.mock('../src/background/logging.js', () => ({
  appendLog: vi.fn(async () => {}),
  getProviderMeta: () => ({})
}));

const settings = {
  apiProvider: 'openrouter', openrouterApiKey: 'test-key', openrouterModel: 'test/model'
};
const source = (name) => readFileSync(new URL(`../src/content/${name}.js`, import.meta.url), 'utf8');
const event = (content) => `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\r\n\r\n`;

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function setupStream() {
  let controller;
  const body = new ReadableStream({ start(value) { controller = value; } });
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, body })));
  return {
    send(text) { controller.enqueue(new TextEncoder().encode(text)); },
    finish() { controller.enqueue(new TextEncoder().encode('data: [DONE]\r\n\r\n')); controller.close(); }
  };
}

function setupView() {
  const window = { tweetTranslationCacheSettings: settings };
  const render = vi.fn();
  const sender = { tab: { id: 1 }, frameId: 0 };
  const chrome = {
    runtime: { onMessage: { addListener: vi.fn() } },
    tabs: { sendMessage: vi.fn(async (_tab, message) => {
      let response;
      window.LLMT.runtime.runtimeMessageHandlers[message.action](message, sender, (value) => { response = value; });
      return response;
    }) }
  };
  vi.stubGlobal('chrome', chrome);
  const context = {
    window, chrome, setTimeout, clearTimeout,
    safeSendMessage: (message, callback) => handleBackgroundMessage(message, sender, callback)
  };
  runInNewContext(source('streaming'), context);
  Object.assign(context, window);
  runInNewContext(source('runtime'), context);
  window.prepareSelectionTranslationStream = () => {
    window.registerStreamSession('selection-test', { kind: 'selection', render, withPromise: false });
    return 'selection-test';
  };
  return { window, render };
}

describe('OpenRouter streaming', () => {
  it.each(['selection', 'youtube', 'tweet'])('%s: 完了前の差分をbackgroundから表示へ送り、全文で確定する', async (kind) => {
    vi.useFakeTimers();
    const stream = setupStream();
    const { window, render } = setupView();
    expect(window.providerSupportsStreaming()).toBe(true);
    const completed = kind === 'selection'
      ? translateAndNotify(1, 'hello', 0)
      : window.startEmbeddedTranslationStream({ kind, text: 'hello', render, element: {} }).promise;
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0][0]).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({ stream: true, model: 'test/model' });
    expect(fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer test-key');

    stream.send(': OPENROUTER PROCESSING\r\n\r\n' + event('こん'));
    await vi.advanceTimersByTimeAsync(100);
    expect(render).toHaveBeenLastCalledWith('こん', expect.objectContaining({ isCompleted: false }));
    expect(window.streamViewSessions.size).toBe(1);

    stream.send(event('にちは') + 'data: {"choices":[],"usage":{"total_tokens":5}}\r\n\r\n');
    stream.finish();
    await completed;
    await vi.advanceTimersByTimeAsync(100);
    expect(render).toHaveBeenLastCalledWith('こんにちは', expect.objectContaining({ isCompleted: true }));
    expect(window.streamViewSessions.size).toBe(0);
  });

  it('UTF-8とSSEの境界が分割されても訳文を復元する', async () => {
    const bytes = new TextEncoder().encode(': OPENROUTER PROCESSING\n\n' + event('日本語') + 'data: [DONE]\n\n');
    const body = new ReadableStream({ start(controller) {
      for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
      controller.close();
    } });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, body })));
    const onDelta = vi.fn();
    await expect(translateTextStream('hello', settings, { onDelta })).resolves.toBe('日本語');
    expect(onDelta).toHaveBeenCalledExactlyOnceWith('日本語', '日本語', expect.any(Object));
  });

  it('途中のAPIエラーは完了扱いにせず、表示側にも失敗を伝える', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const stream = setupStream();
    const { window, render } = setupView();
    const { promise } = window.startEmbeddedTranslationStream({ kind: 'tweet', text: 'hello', render });
    const rejected = expect(promise).rejects.toThrow('Provider disconnected unexpectedly');
    await vi.advanceTimersByTimeAsync(0);
    stream.send(event('途中'));
    await vi.advanceTimersByTimeAsync(100);
    stream.send('data: {"error":{"code":"server_error","message":"Provider disconnected unexpectedly"},"choices":[{"delta":{},"finish_reason":"error"}]}\n\n');
    stream.finish();
    await rejected;
    expect(render).toHaveBeenLastCalledWith(expect.stringContaining('Provider disconnected unexpectedly'), expect.objectContaining({ isError: true, isCompleted: false }));
    expect(window.streamViewSessions.size).toBe(0);
  });
});
