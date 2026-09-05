import { beforeEach, describe, expect, it, vi } from 'vitest';

import { translateBatchStructured, translateText } from '../src/background/api.js';
import { translateChunk } from '../src/background/page-translation/translator.js';
import { LEGACY_SEPARATOR_INSTRUCTION } from '../src/shared/translation-policy.js';

vi.mock('../src/background/api.js', () => ({
  translateBatchStructured: vi.fn(),
  translateText: vi.fn()
}));

function makeParams(overrides = {}) {
  return {
    sep: '|||',
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

describe('翻訳経路ごとの形式指示', () => {
  const oldSettings = { ...settings, translationSystemPrompt: '敬体。' + LEGACY_SEPARATOR_INSTRUCTION };
  const oldParams = () => makeParams({ separatorSystemPrompt: '古いセッションのSEP指示' });

  it('JSONには翻訳方針だけ、フォールバックにのみ実際の区切り文字の指示を付ける', async () => {
    translateBatchStructured.mockRejectedValue(new Error('bad json'));
    translateText.mockResolvedValue('一|||二');
    await translateChunk(['one', 'two'], oldSettings, oldParams());
    expect(translateBatchStructured.mock.calls[0][1].translationSystemPrompt).toBe('敬体。');
    const prompt = translateText.mock.calls[0][1].translationSystemPrompt;
    expect(prompt).toContain('敬体。');
    expect(prompt).toContain('"|||"');
    expect(prompt).not.toContain('SEP');
  });

  it('単一項目には形式の指示を付けない', async () => {
    translateText.mockResolvedValue('一');
    await translateChunk(['one'], oldSettings, oldParams());
    expect(translateText.mock.calls[0][1].translationSystemPrompt).toBe('敬体。');
  });

  it('セパレータ失敗後の個別翻訳にも形式の指示を残さない', async () => {
    translateBatchStructured.mockRejectedValue(new Error('bad json'));
    translateText.mockImplementation(async text => text.includes('|||') ? 'bad separator' : '訳');
    await translateChunk(['one', 'two'], oldSettings, oldParams());
    const singles = translateText.mock.calls.filter(([text]) => !text.includes('|||'));
    expect(singles).toHaveLength(2);
    singles.forEach(([, config]) => expect(config.translationSystemPrompt).toBe('敬体。'));
  });

  it('巨大ノードの断片にも形式の指示を付けない', async () => {
    translateText.mockResolvedValue('訳');
    await translateChunk(['A'.repeat(80)], oldSettings, { ...oldParams(), maxChars: 40 });
    expect(translateText.mock.calls).toHaveLength(2);
    translateText.mock.calls.forEach(([, config]) => expect(config.translationSystemPrompt).toBe('敬体。'));
  });
});

describe('translateChunk', () => {
  it('課金エラーでセパレータや分割へ再送せず、対処可能なエラーを返す', async () => {
    translateBatchStructured.mockRejectedValue(Object.assign(new Error('Insufficient credits'), { status: 402 }));
    const params = makeParams();
    const result = await translateChunk(['one', 'two'], settings, params);
    expect(result).toMatchObject({ parts: [null, null], error: { status: 402, code: 'payment_required' } });
    expect(translateText).not.toHaveBeenCalled();
    expect(params.runtime.structuredDisabled).toBe(false);
  });

  it('分割途中でAPIが利用不可になっても成功済みの訳文を残す', async () => {
    translateText.mockImplementation(async (text) => {
      if (text.includes('|||')) return 'separator missing';
      if (text === 'one') return '一';
      throw Object.assign(new Error('credits exhausted'), { status: 402 });
    });
    const result = await translateChunk(['one', 'two', 'three', 'four'], settings, makeParams({ useStructuredOutput: false }));
    expect(result).toMatchObject({ parts: ['一', null, null, null], failedItems: 3, error: { status: 402 } });
    expect(translateText.mock.calls.map(([text]) => text)).not.toContain('three');
  });

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

  it('時間予算を使い切っていたら API を呼ばず全 item を失敗(null)で返す', async () => {
    const result = await translateChunk(['one', 'two'], settings, makeParams(), {
      deadlineAt: Date.now() - 1
    });

    expect(result).toEqual({
      parts: [null, null],
      method: 'budget-exhausted',
      failedItems: 2
    });
    expect(translateBatchStructured).not.toHaveBeenCalled();
    expect(translateText).not.toHaveBeenCalled();
  });

  it('item 単位翻訳の途中で予算が切れたら残りを失敗にして打ち切る', async () => {
    translateBatchStructured.mockRejectedValue(new Error('bad json'));
    const deadline = { at: Date.now() + 60000 };
    translateText.mockImplementation(async (text) => {
      if (text.includes('|||')) return 'セパレータ消失';
      // 最初の item 翻訳後に予算切れへ切り替える
      deadline.at = Date.now() - 1;
      return `${text}訳`;
    });

    const requestOptions = {
      get deadlineAt() {
        return deadline.at;
      }
    };
    const result = await translateChunk(['one', 'two'], settings, makeParams(), requestOptions);

    expect(result.parts[0]).toBe('one訳');
    expect(result.parts[1]).toBeNull();
    expect(result.failedItems).toBe(1);
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

describe('translateChunk: 応答の期限と整合性', () => {
  it('欠落・空の訳文を失敗にし、インライン要素の前後空白を保つ', async () => {
    translateBatchStructured.mockResolvedValue([' 一 ', null, '  ']);
    const result = await translateChunk([' one ', 'two', 'three'], settings, makeParams());
    expect(result.parts).toEqual([' 一 ', null, null]);
    expect(result.failedItems).toBe(2);
  });

  it('残り3秒なら5秒へ引き延ばさず、応答しないproviderも中断する', async () => {
    vi.useFakeTimers();
    try {
      let signal;
      translateBatchStructured.mockImplementation((_texts, _settings, options) => {
        signal = options.signal;
        expect(options.timeoutMs).toBe(3000);
        return new Promise(() => {});
      });
      const params = makeParams();
      const running = translateChunk(['one', 'two'], settings, params, { deadlineAt: Date.now() + 3000 });
      await vi.advanceTimersByTimeAsync(3000);
      expect(await running).toMatchObject({ parts: [null, null], failedItems: 2 });
      expect(signal.aborted).toBe(true);
      expect(translateText).not.toHaveBeenCalled();
      expect(params.runtime.structuredDisabled).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('空の単一訳文で原文を消さない', async () => {
    translateText.mockResolvedValue('');
    expect(await translateChunk(['one'], settings, makeParams())).toMatchObject({ parts: [null], failedItems: 1 });
  });
});
