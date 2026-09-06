import { afterEach, describe, expect, it, vi } from 'vitest';
import provider from '../src/background/api/providers/lmstudio.js';
import { normalizeConnectionSettings } from '../src/shared/connections.js';

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

describe('LM Studio推論設定の移行', () => {
  it.each(['default', 'off', 'on', 'low', 'medium', 'high'])('保存値を引き継ぐ: %s', value => {
    const migrated = normalizeConnectionSettings({ apiProvider: 'lmstudio', lmstudioReasoning: value });
    expect(migrated.openaiConnections.lmstudio.reasoning).toBe(value);
    expect(normalizeConnectionSettings(migrated)).toEqual(migrated);
  });
  it('保存値がない場合はモデルの既定にする', () => {
    expect(normalizeConnectionSettings({}).openaiConnections.lmstudio.reasoning).toBe('default');
  });
});
