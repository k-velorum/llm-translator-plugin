import { beforeEach, describe, expect, it, vi } from 'vitest';

import { translateBatchStructured, translateText } from '../src/background/api.js';
import { translateChunk } from '../src/background/page-translation/translator.js';

vi.mock('../src/background/api.js', () => ({
  translateBatchStructured: vi.fn(),
  translateText: vi.fn()
}));

function makeParams(overrides = {}) {
  return {
    sep: '|||',
    separatorSystemPrompt: '',
    maxChars: 3500,
    delayMs: 0,
    useStructuredOutput: true,
    disableStructuredAfterFailure: true,
    runtime: { structuredDisabled: false },
    ...overrides
  };
}

const settings = { apiProvider: 'gemini', geminiModel: 'gemini-test' };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('translateChunk', () => {
  it('構造化出力が成功したらそのまま返す', async () => {
    translateBatchStructured.mockResolvedValue(['一', '二']);

    const result = await translateChunk(['one', 'two'], settings, makeParams());

    expect(result).toEqual({ parts: ['一', '二'], method: 'structured', failedItems: 0 });
    expect(translateText).not.toHaveBeenCalled();
  });

  it('構造化出力の失敗時はセパレータ方式へフォールバックし、セッション内で構造化を無効化する', async () => {
    translateBatchStructured.mockRejectedValue(new Error('bad json'));
    translateText.mockResolvedValue('一|||二');
    const params = makeParams();

    const result = await translateChunk(['one', 'two'], settings, params);

    expect(result.parts).toEqual(['一', '二']);
    expect(result.method).toBe('separator');
    expect(params.runtime.structuredDisabled).toBe(true);
  });

  it('セパレータ数の不一致が続いたら item 単位へ落とし、失敗 item は null で返す', async () => {
    translateBatchStructured.mockRejectedValue(new Error('bad json'));
    translateText.mockImplementation(async (text) => {
      if (text.includes('|||')) return 'セパレータ消失';
      if (text === 'two') throw new Error('model output failure');
      return `${text}訳`;
    });

    const result = await translateChunk(['one', 'two'], settings, makeParams());

    expect(result.parts).toEqual(['one訳', null]);
    expect(result.failedItems).toBe(1);
  });

  it('AbortError は伝播させる', async () => {
    const abortError = new Error('aborted');
    abortError.name = 'AbortError';
    translateBatchStructured.mockRejectedValue(abortError);

    await expect(translateChunk(['one', 'two'], settings, makeParams())).rejects.toMatchObject({
      name: 'AbortError'
    });
  });

  it('maxChars 超の単一ノードは分割翻訳し、断片失敗時は原文維持(null)にする', async () => {
    const longText = 'A'.repeat(30) + '. ' + 'B'.repeat(30) + '.';
    translateText.mockRejectedValue(new Error('model output failure'));

    const result = await translateChunk([longText], settings, makeParams({ maxChars: 40 }));

    expect(result).toEqual({ parts: [null], method: 'oversized', failedItems: 1 });
  });

  it('maxChars 超の単一ノードの分割翻訳が成功したら結合して返す', async () => {
    const longText = 'A'.repeat(30) + '. ' + 'B'.repeat(30) + '.';
    translateText.mockResolvedValue('訳');

    const result = await translateChunk([longText], settings, makeParams({ maxChars: 40 }));

    expect(result.failedItems).toBe(0);
    expect(result.parts).toHaveLength(1);
    expect(result.parts[0]).toContain('訳');
  });
});
