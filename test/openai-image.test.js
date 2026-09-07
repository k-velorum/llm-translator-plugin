import { afterEach, describe, expect, it, vi } from 'vitest';
import { translateImage } from '../src/background/api.js';
import { CONNECTION_PRESETS, getConnectionCapabilities } from '../src/shared/connections.js';

const image = { dataUrl: 'data:image/png;base64,AA==', mimeType: 'image/png' };
const settingsFor = (id, overrides = {}) => ({
  apiProvider: 'openai', openaiPreset: id,
  openaiConnections: { [id]: {
    baseUrl: 'https://example.test/gateway/v4/', model: 'vision', apiKey: 'selected-key', ...overrides
  } },
  lmstudioApiKey: 'stale-key', lmstudioModel: 'stale-model',
  translationSystemPrompt: '固有名詞は原文のままにしてください。'
});
const response = content => new Response(JSON.stringify({ choices: [{ message: { content } }] }));
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('OpenAI互換の画像入力', () => {
  it.each(Object.keys(CONNECTION_PRESETS))('%sも任意のベースURLと選択中の設定で送信する', async id => {
    const settings = settingsFor(id);
    const fetch = vi.fn(async () => response(' 翻訳結果 '));
    vi.stubGlobal('fetch', fetch);
    expect(getConnectionCapabilities(settings).supportsImageTranslation).toBe(true);
    await expect(translateImage(image, settings)).resolves.toBe('翻訳結果');
    const [url, options] = fetch.mock.calls[0];
    expect(url).toBe('https://example.test/gateway/v4/chat/completions');
    expect(options).toMatchObject({ redirect: 'error', headers: { Authorization: 'Bearer selected-key' } });
    const body = JSON.parse(options.body);
    expect(body).toMatchObject({ model: 'vision', messages: [
      { role: 'system', content: expect.stringContaining(settings.translationSystemPrompt) },
      { role: 'user', content: [
        { type: 'text', text: expect.stringContaining('画像') },
        { type: 'image_url', image_url: { url: image.dataUrl } }
      ] }
    ] });
    expect(JSON.stringify(options)).not.toContain('stale-');
    expect(body).not.toHaveProperty('input');
  });

  it('プリセット固有のヘッダー・推論・最小リクエスト形式も共通処理で適用する', async () => {
    const fetch = vi.fn(async () => response([{ type: 'text', text: '訳文' }]));
    vi.stubGlobal('fetch', fetch);
    await expect(translateImage(image, settingsFor('openrouter', { reasoning: 'off' }))).resolves.toBe('訳文');
    const options = fetch.mock.calls[0][1];
    expect(options.headers).toMatchObject(CONNECTION_PRESETS.openrouter.headers);
    const body = JSON.parse(options.body);
    expect(body.reasoning).toEqual({ enabled: false });
    expect(body).not.toHaveProperty('temperature');
  });

  it('旧Ollama設定からも共通の画像経路へ到達する', async () => {
    const fetch = vi.fn(async () => response('訳文'));
    vi.stubGlobal('fetch', fetch);
    await translateImage(image, { apiProvider: 'ollama', ollamaServer: 'http://localhost:11434', ollamaModel: 'vision' });
    expect(fetch.mock.calls[0][0]).toBe('http://localhost:11434/v1/chat/completions');
    expect(fetch.mock.calls[0][1].headers).not.toHaveProperty('Authorization');
  });

  it('画像非対応のモデルのエラーを保持し、別APIへ再送しない', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ error: { message: 'model does not support image input' } }), { status: 400 }));
    vi.stubGlobal('fetch', fetch);
    await expect(translateImage(image, settingsFor('custom'))).rejects.toMatchObject({
      status: 400, message: expect.stringContaining('model does not support image input')
    });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('不正な画像と未設定のモデルは送信前に拒否する', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await expect(translateImage({ dataUrl: 'https://example.test/image.png' }, settingsFor('custom'))).rejects.toThrow('画像入力');
    await expect(translateImage(image, settingsFor('custom', { model: '' }))).rejects.toThrow('モデル');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('空の出力を成功にしない', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response(' ')));
    await expect(translateImage(image, settingsFor('custom'))).rejects.toThrow('翻訳結果が空');
  });

  it('中断をHTTPリクエストまで伝える', async () => {
    const controller = new AbortController();
    vi.stubGlobal('fetch', vi.fn(async (_url, { signal }) => {
      controller.abort();
      signal.throwIfAborted();
    }));
    await expect(translateImage(image, settingsFor('custom'), { signal: controller.signal }))
      .rejects.toMatchObject({ name: 'AbortError' });
  });
});
