import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getProviderCapabilities } from '../src/background/api/registry.js';

let listener;
let session;
let model;
const imageInput = { dataUrl: 'data:image/png;base64,aGVsbG8=', mimeType: 'image/png' };

beforeEach(async () => {
  vi.resetModules();
  session = { prompt: vi.fn().mockResolvedValue(' 翻訳済み '), destroy: vi.fn() };
  model = {
    availability: vi.fn().mockResolvedValue('available'),
    create: vi.fn().mockResolvedValue(session)
  };
  vi.stubGlobal('self', globalThis);
  vi.stubGlobal('LanguageModel', model);
  vi.stubGlobal('chrome', { runtime: {
    onMessage: { addListener: (handler) => { listener = handler; } },
    sendMessage: vi.fn()
  } });
  await import('../src/offscreen/chrome-prompt-runtime.js');
});

afterEach(() => vi.unstubAllGlobals());

function request(action = 'translateImage', payload = { imageInput, settings: {} }) {
  return new Promise((resolve) => {
    listener({ target: 'chromePromptRuntime', requestId: 'test', action, payload }, {}, resolve);
  });
}

describe('Chrome Prompt image translation', () => {
  it('advertises support and passes an image Blob with matching modality options', async () => {
    expect(getProviderCapabilities({ apiProvider: 'chromePrompt' }).supportsImageTranslation).toBe(true);
    expect(await request()).toMatchObject({ result: '翻訳済み' });
    const options = model.availability.mock.calls[0][0];
    expect(options.expectedInputs).toContainEqual({ type: 'image' });
    expect(model.create).toHaveBeenCalledWith(expect.objectContaining(options));
    const content = session.prompt.mock.calls[0][0][0].content;
    expect(content[1].type).toBe('image');
    expect(content[1].value).toBeInstanceOf(Blob);
    expect(content[1].value.type).toBe('image/png');
    expect(await content[1].value.text()).toBe('hello');
    expect(session.destroy).toHaveBeenCalledOnce();
  });

  it('reports unavailable image support without creating a session', async () => {
    model.availability.mockResolvedValue('unavailable');
    expect(await request()).toMatchObject({ error: { message: expect.stringContaining('画像入力を利用できません') } });
    expect(model.create).not.toHaveBeenCalled();
  });

  it('does not fetch arbitrary remote URLs passed as image data', async () => {
    expect(await request('translateImage', { imageInput: { dataUrl: 'https://example.com/image.png' } }))
      .toMatchObject({ error: { message: '画像入力データが不正です' } });
    expect(model.create).not.toHaveBeenCalled();
  });

  it('destroys the session on inference failure', async () => {
    session.prompt.mockRejectedValue(new Error('inference failed'));
    expect(await request()).toMatchObject({ error: { message: 'inference failed' } });
    expect(session.destroy).toHaveBeenCalledOnce();
  });

  it('rejects empty output and destroys the session', async () => {
    session.prompt.mockResolvedValue('  ');
    expect(await request()).toMatchObject({ error: { message: expect.stringContaining('結果を取得できません') } });
    expect(session.destroy).toHaveBeenCalledOnce();
  });

  it('preserves text-only translation without image requirements', async () => {
    expect(await request('translate', { text: 'hello', settings: {} })).toMatchObject({ result: '翻訳済み' });
    expect(model.create.mock.calls[0][0].expectedInputs).toBeUndefined();
    expect(session.prompt).toHaveBeenCalledWith('hello', { signal: expect.any(AbortSignal) });
  });
});
