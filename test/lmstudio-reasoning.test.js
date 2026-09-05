import { afterEach, describe, expect, it, vi } from 'vitest';
import provider from '../src/background/api/providers/lmstudio.js';
import { collectSettings, loadSettings } from '../src/popup/settings-form.js';

const settings = { lmstudioModel: 'test-model' };
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function mockResponse(content = '訳文') {
  const fetch = vi.fn(async () => ({ ok: true, json: async () => ({
    choices: [{ message: { content } }], output: [{ type: 'message', content }]
  }) }));
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

describe('LM Studio推論設定のリクエスト', () => {
  it.each([[undefined, undefined], ['default', undefined], ['off', 'none'], ['on', 'medium'],
    ['low', 'low'], ['medium', 'medium'], ['high', 'high'], ['invalid', undefined]])(
    '通常翻訳で %s を %s に変換する', async (value, effort) => {
      const fetch = mockResponse();
      await provider.translate('text', { ...settings, lmstudioReasoning: value });
      expect(JSON.parse(fetch.mock.calls[0][1].body).reasoning_effort).toBe(effort);
    }
  );

  it('構造化バッチにもOFFを渡し、ID順で訳文を返す', async () => {
    const fetch = mockResponse('{"items":[[1,"二"],[0,"一"]]}');
    expect(await provider.translateBatchStructured(['one', 'two'], { ...settings, lmstudioReasoning: 'off' }))
      .toEqual(['一', '二']);
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({ reasoning_effort: 'none', stream: false });
  });

  it('ストリーミングでもOFFを渡す', async () => {
    const fetch = vi.fn(async () => new Response('data: {"choices":[{"delta":{"content":"訳文"}}]}\n\ndata: [DONE]\n\n'));
    vi.stubGlobal('fetch', fetch);
    expect(await provider.translateStream('text', { ...settings, lmstudioReasoning: 'off' })).toBe('訳文');
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({ reasoning_effort: 'none', stream: true });
  });

  it.each(['off', 'on', 'low', 'medium', 'high', 'default'])('画像翻訳ではNative API用の値を使う: %s', async (value) => {
    const fetch = mockResponse();
    await provider.translateImage({ dataUrl: 'data:image/png;base64,AA==', mimeType: 'image/png' },
      { ...settings, lmstudioReasoning: value });
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.reasoning).toBe(value === 'default' ? undefined : value);
    expect(body).not.toHaveProperty('reasoning_effort');
  });
});

describe('LM Studio推論設定の保存・復元', () => {
  it.each(['default', 'off', 'on', 'low', 'medium', 'high'])('保存対象の値を復元できる: %s', async (value) => {
    const elements = { apiProviderSelect: { value: 'lmstudio' }, lmstudioReasoningSelect: { value } };
    const saved = collectSettings(elements);
    expect(saved.lmstudioReasoning).toBe(value);
    vi.stubGlobal('chrome', { runtime: {}, storage: { sync: { get: (_keys, cb) => cb(saved) } } });
    elements.lmstudioReasoningSelect.value = '';
    await loadSettings(elements);
    expect(elements.lmstudioReasoningSelect.value).toBe(value);
  });

  it('保存値がない場合はモデルの既定にする', async () => {
    const elements = { apiProviderSelect: {}, lmstudioReasoningSelect: {} };
    vi.stubGlobal('chrome', { runtime: {}, storage: { sync: { get: (_keys, cb) => cb({}) } } });
    await loadSettings(elements);
    expect(elements.lmstudioReasoningSelect.value).toBe('default');
  });
});
