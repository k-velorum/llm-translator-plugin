import { afterEach, describe, expect, it, vi } from 'vitest';
import { translateTextStream, translateImageStream, translateBatchStructured, readOpenAICompatibleSSE } from '../src/background/api.js';
import { handleBackgroundMessage } from '../src/background/message-handlers.js';
import { structuredBatchPreview } from '../src/shared/translation-preview.js';
import { selectionDocumentPreview } from '../src/shared/selection-document.js';

const connection = { apiProvider: 'openai', openaiPreset: 'custom',
  openaiConnections: { custom: { baseUrl: 'https://example.test/v1', model: 'vision', streaming: true } } };
const image = { dataUrl: 'data:image/png;base64,AA==', mimeType: 'image/png' };
const sse = text => `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`;
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('表示APIのストリーム優先方針', () => {
  it('DONEを受けたら、HTTP接続の終了待ちを残さずreaderを解放する', async () => {
    const cancel = vi.fn();
    const body = new ReadableStream({ start(controller) {
      controller.enqueue(new TextEncoder().encode(sse('訳文') + 'data: [DONE]\n\n'));
    }, cancel });
    expect(await readOpenAICompatibleSSE(body)).toBe('訳文');
    expect(cancel).toHaveBeenCalledOnce();
    expect(body.locked).toBe(false);
  });
  it('stream指定にJSONを返す互換サーバーは、再送せず一括表示する', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ choices: [{ message: { content: '一括応答' } }] })));
    const onDelta = vi.fn();
    expect(await translateTextStream('hello', connection, { onDelta })).toBe('一括応答');
    expect(onDelta).toHaveBeenCalledWith('一括応答', '一括応答', expect.any(Object));
    expect(fetch).toHaveBeenCalledOnce();
  });
  it('非対応のGemini APIは一括結果を同じ更新・完了コールバックで返す', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '訳文' }] } }] }))));
    const onDelta = vi.fn(), onDone = vi.fn();
    expect(await translateTextStream('hello', { apiProvider: 'gemini', geminiApiKey: 'test', geminiModel: 'm' }, { onDelta, onDone })).toBe('訳文');
    expect(onDelta).toHaveBeenCalledExactlyOnceWith('訳文', '訳文');
    expect(onDone).toHaveBeenCalledExactlyOnceWith('訳文');
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('ストリームOFFでも表示側からの開始を受理し、一括結果で完了する', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: '一括' } }] }))));
    let finish;
    const completed = new Promise(resolve => { finish = resolve; });
    vi.stubGlobal('chrome', {
      storage: { sync: { get: (_keys, callback) => callback({ ...connection,
        openaiConnections: { custom: { ...connection.openaiConnections.custom, streaming: false } } }) } },
      tabs: { sendMessage: vi.fn(async (_tab, message) => {
        if (message.action === 'translationStreamComplete') finish(message);
      }) }
    });
    const accepted = await new Promise(resolve => handleBackgroundMessage({
      action: 'startTranslationStream', requestId: 'fallback', text: 'hello'
    }, { tab: { id: 1 }, frameId: 0 }, resolve));
    expect(accepted.accepted).toBe(true);
    expect(await completed).toMatchObject({ finalText: '一括' });
    expect(JSON.parse(fetch.mock.calls[0][1].body).stream).toBe(false);
  });

  it('OpenAI互換の画像も差分を返し、最後の全文で確定する', async () => {
    let controller;
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, body: new ReadableStream({ start(c) { controller = c; } }) })));
    const onDelta = vi.fn(), onDone = vi.fn();
    const running = translateImageStream(image, connection, { onDelta, onDone });
    await vi.waitFor(() => expect(controller).toBeDefined());
    controller.enqueue(new TextEncoder().encode(sse('画像')));
    await vi.waitFor(() => expect(onDelta).toHaveBeenCalledWith('画像', '画像', expect.any(Object)));
    expect(onDone).not.toHaveBeenCalled();
    controller.enqueue(new TextEncoder().encode(sse('翻訳') + 'data: [DONE]\n\n')); controller.close();
    expect(await running).toBe('画像翻訳');
    expect(onDone).toHaveBeenCalledExactlyOnceWith('画像翻訳');
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({ stream: true,
      messages: [{ role: 'system' }, { role: 'user', content: [
        { type: 'text' }, { type: 'image_url', image_url: { url: image.dataUrl } }
      ] }] });
  });

  it('構造化ストリームも既存のID検証を通し、壊れたJSONを成功にしない', async () => {
    const onDelta = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(sse('{"items":[[1,"二"],[0,"一"]]}') + 'data: [DONE]\n\n')));
    expect(await translateBatchStructured(['one', 'two'], connection, { onDelta })).toEqual(['一', '二']);
    expect(onDelta).toHaveBeenCalled();
    fetch.mockImplementation(async () => new Response(sse('{"items":[') + 'data: [DONE]\n\n'));
    await expect(translateBatchStructured(['one', 'two'], connection, { onDelta })).rejects.toThrow('解析');
  });

  it('途中の通信エラーから一括APIへ自動再送しない', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(sse('途中') + 'data: {"error":{"message":"connection lost"}}\n\n')));
    await expect(translateImageStream(image, connection)).rejects.toThrow('connection lost');
    expect(fetch).toHaveBeenCalledOnce();
  });
});

describe('未確定出力のテキストプレビュー', () => {
  it('分割されたJSON文字列とエスケープから本文だけを表示する', () => {
    expect(structuredBatchPreview('{"items":[[0,"こん')).toBe('こん');
    expect(structuredBatchPreview('{"items":[[0,"一\\n二"],[1,"三\\u65')).toBe('一\n二\n\n三');
    expect(structuredBatchPreview('{"items":[[0,"引用\\"と\\\\記号"],[1,"次')).toBe('引用"と\\記号\n\n次');
  });
  it('HTMLタグや途中の属性を見せず、文字参照を一度だけ復元する', () => {
    expect(selectionDocumentPreview('<p id="p0">こん<a id="a')).toBe('こん');
    expect(selectionDocumentPreview('<p id="p0">&lt;img&gt; &amp;lt;</p>')).toBe('<img> &lt;');
    expect(selectionDocumentPreview('<p id="p0">hello &am')).toBe('hello');
  });
});
