import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  computeChunkOffsets,
  getFailedChunkIndexes,
  runChunkQueue,
  summarizeSession
} from '../src/background/page-translation/runner.js';
import { translateChunk } from '../src/background/page-translation/translator.js';

vi.mock('../src/background/page-translation/translator.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, translateChunk: vi.fn() };
});

function makeSession(chunks, overrides = {}) {
  return {
    tabId: 1,
    snapshotId: 1,
    settings: { apiProvider: 'gemini', geminiModel: 'gemini-test' },
    chunks,
    chunkOffsets: computeChunkOffsets(chunks),
    chunkResults: new Array(chunks.length).fill(null),
    totalItems: chunks.reduce((acc, c) => acc + c.length, 0),
    canceled: false,
    running: false,
    lastError: null,
    abortController: new AbortController(),
    params: { sep: '|||', delayMs: 0, concurrency: 2 },
    ...overrides
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('computeChunkOffsets', () => {
  it('チャンク先頭の item オフセットを事前計算する', () => {
    expect(computeChunkOffsets([['a', 'b'], ['c'], ['d', 'e', 'f']])).toEqual([0, 2, 3]);
  });
});

describe('runChunkQueue', () => {
  it('利用不可でキューを止めても送信済みチャンクの成功は反映する', async () => {
    const session = makeSession([['blocked'], ['in-flight'], ['pending']]);
    let completeInFlight;
    translateChunk.mockImplementation(async (chunk) => {
      if (chunk[0] === 'blocked') return { parts: [null], error: { status: 402, message: 'Insufficient credits' } };
      return new Promise((resolve) => { completeInFlight = resolve; });
    });
    const applyChunk = vi.fn();
    const running = runChunkQueue(session, [0, 1, 2], {
      applyChunk,
      notifyProgress: async () => { completeInFlight({ parts: ['成功'], method: 'per-item' }); }
    });
    await running;
    expect(translateChunk).toHaveBeenCalledTimes(2);
    expect(applyChunk).toHaveBeenCalledWith(1, ['成功']);
    expect(summarizeSession(session)).toMatchObject({ doneChunks: 1, failedChunks: 1, pendingChunks: 1 });
  });

  it('課金エラーで未着手チャンクを残して停止し、手動再試行で続行する', async () => {
    const session = makeSession([['a'], ['b'], ['c']], { params: { concurrency: 1, delayMs: 0 } });
    translateChunk.mockResolvedValueOnce({ parts: [null], method: 'api-error', error: { status: 402, message: 'Insufficient credits' } });
    const hooks = { applyChunk: vi.fn(), notifyProgress: vi.fn() };
    await runChunkQueue(session, [0, 1, 2], hooks);
    expect(translateChunk).toHaveBeenCalledTimes(1);
    expect(summarizeSession(session)).toMatchObject({ failedChunks: 1, pendingChunks: 2 });
    expect(session.lastError).toContain('請求設定');
    translateChunk.mockResolvedValue({ parts: ['訳'], method: 'per-item' });
    await runChunkQueue(session, getFailedChunkIndexes(session), hooks);
    expect(summarizeSession(session).doneChunks).toBe(3);
  });

  it('一部チャンクの失敗では止まらず、成功分を適用して失敗分を記録する', async () => {
    const chunks = [['a', 'b'], ['c'], ['d', 'e']];
    const session = makeSession(chunks);
    translateChunk.mockImplementation(async (chunk) => {
      if (chunk[0] === 'c') throw new Error('model output failure');
      return { parts: chunk.map((s) => `${s}訳`), method: 'structured', failedItems: 0 };
    });

    const applied = [];
    await runChunkQueue(session, [0, 1, 2], {
      applyChunk: async (idx, parts) => applied.push({ idx, parts }),
      notifyProgress: async () => {}
    });

    expect(applied.map((a) => a.idx).sort()).toEqual([0, 2]);
    expect(getFailedChunkIndexes(session)).toEqual([1]);
    expect(session.lastError).toContain('model output failure');

    const summary = summarizeSession(session);
    expect(summary.failedChunks).toBe(1);
    expect(summary.processedItems).toBe(5); // 失敗チャンクの item も処理済みとして数える
    expect(summary.failedItems).toBe(1);
    expect(summary.pendingChunks).toBe(0);
  });

  it('部分失敗チャンク（failedItems > 0）も適用しつつ失敗として記録する', async () => {
    const chunks = [['a', 'b']];
    const session = makeSession(chunks);
    translateChunk.mockResolvedValue({ parts: ['a訳', null], method: 'per-item', failedItems: 1 });

    const applied = [];
    await runChunkQueue(session, [0], {
      applyChunk: async (idx, parts) => applied.push({ idx, parts }),
      notifyProgress: async () => {}
    });

    expect(applied).toEqual([{ idx: 0, parts: ['a訳', null] }]);
    expect(getFailedChunkIndexes(session)).toEqual([0]);
    expect(summarizeSession(session).failedItems).toBe(1);
  });

  it('失敗チャンクのみ再実行すると完了状態になる', async () => {
    const chunks = [['a'], ['b']];
    const session = makeSession(chunks);
    translateChunk
      .mockRejectedValueOnce(new Error('一時的な失敗'))
      .mockResolvedValue({ parts: ['訳'], method: 'separator', failedItems: 0 });

    await runChunkQueue(session, [0, 1], {
      applyChunk: async () => {},
      notifyProgress: async () => {}
    });
    const failed = getFailedChunkIndexes(session);
    expect(failed).toHaveLength(1);

    await runChunkQueue(session, failed, {
      applyChunk: async () => {},
      notifyProgress: async () => {}
    });

    expect(getFailedChunkIndexes(session)).toEqual([]);
    expect(summarizeSession(session).failedChunks).toBe(0);
    expect(summarizeSession(session).doneChunks).toBe(2);
  });

  it('キャンセルされたら残りのチャンクを処理せず結果も適用しない', async () => {
    const chunks = [['a'], ['b'], ['c']];
    const session = makeSession(chunks, { params: { sep: '|||', delayMs: 0, concurrency: 1 } });
    translateChunk.mockImplementation(async () => {
      session.canceled = true;
      return { parts: ['訳'], method: 'separator', failedItems: 0 };
    });

    const applied = [];
    await runChunkQueue(session, [0, 1, 2], {
      applyChunk: async (idx) => applied.push(idx),
      notifyProgress: async () => {}
    });

    expect(applied).toEqual([]);
    expect(translateChunk).toHaveBeenCalledTimes(1);
  });
});

describe('runChunkQueue: 停滞と再試行', () => {
  it('応答しない翻訳も期限で中断し、次のチャンクへ進む', async () => {
    vi.useFakeTimers();
    try {
      const session = makeSession([['slow'], ['next']], { params: { concurrency: 1, delayMs: 0 } });
      let stuckSignal;
      translateChunk.mockImplementation((chunk, _settings, _params, { signal }) => {
        if (chunk[0] === 'slow') {
          stuckSignal = signal;
          return new Promise(() => {});
        }
        return Promise.resolve({ parts: ['次'], method: 'per-item' });
      });
      const applyChunk = vi.fn();
      const running = runChunkQueue(session, [0, 1], { applyChunk, notifyProgress: vi.fn() });
      await vi.advanceTimersByTimeAsync(240000);
      await running;
      expect(stuckSignal.aborted).toBe(true);
      expect(getFailedChunkIndexes(session)).toEqual([0]);
      expect(applyChunk).toHaveBeenCalledWith(1, ['次']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('応答しないモデルのキャンセルを待たずに終了する', async () => {
    const session = makeSession([['slow']]);
    translateChunk.mockImplementation(() => new Promise(() => {}));
    const applyChunk = vi.fn();
    const running = runChunkQueue(session, [0], { applyChunk, notifyProgress: vi.fn() });
    session.canceled = true;
    session.abortController.abort();
    await running;
    expect(applyChunk).not.toHaveBeenCalled();
  });

  it('部分成功の訳文を保持して未翻訳の項目だけ再送する', async () => {
    const session = makeSession([['one', 'two', 'three']]);
    translateChunk.mockResolvedValueOnce({ parts: ['一', null, '三'], method: 'structured' });
    const applyChunk = vi.fn();
    const hooks = { applyChunk, notifyProgress: vi.fn() };
    await runChunkQueue(session, [0], hooks);
    translateChunk.mockResolvedValueOnce({ parts: ['二'], method: 'per-item' });
    await runChunkQueue(session, getFailedChunkIndexes(session), hooks);
    expect(translateChunk.mock.calls[1][0]).toEqual(['two']);
    expect(applyChunk).toHaveBeenLastCalledWith(0, ['一', '二', '三']);
    expect(summarizeSession(session).failedItems).toBe(0);
  });

  it('反映失敗は完了にせず、再試行ではモデルを再呼び出しせず反映する', async () => {
    const session = makeSession([['one']]);
    translateChunk.mockResolvedValue({ parts: ['一'], method: 'per-item' });
    const applyChunk = vi.fn().mockRejectedValueOnce(new Error('反映失敗')).mockResolvedValue(undefined);
    const hooks = { applyChunk, notifyProgress: vi.fn() };
    await runChunkQueue(session, [0], hooks);
    expect(getFailedChunkIndexes(session)).toEqual([0]);
    await runChunkQueue(session, [0], hooks);
    expect(translateChunk).toHaveBeenCalledTimes(1);
    expect(getFailedChunkIndexes(session)).toEqual([]);
  });

  it('反映の応答が途絶えても次へ進む', async () => {
    vi.useFakeTimers();
    try {
      const session = makeSession([['one'], ['two']], { params: { concurrency: 1, delayMs: 0 } });
      translateChunk.mockImplementation(async (chunk) => ({ parts: chunk, method: 'per-item' }));
      const applyChunk = vi.fn().mockImplementationOnce(() => new Promise(() => {})).mockResolvedValue(undefined);
      const running = runChunkQueue(session, [0, 1], { applyChunk, notifyProgress: vi.fn() });
      await vi.advanceTimersByTimeAsync(10000);
      await running;
      expect(getFailedChunkIndexes(session)).toEqual([0]);
      expect(applyChunk).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('復元した未着手・処理中のチャンクも再試行対象にする', () => {
    const session = makeSession([['one'], ['two'], ['three']]);
    session.chunkResults = [{ status: 'done', items: 1, failedItems: 0 }, null, { status: 'pending' }];
    expect(getFailedChunkIndexes(session)).toEqual([1, 2]);
    expect(summarizeSession(session)).toMatchObject({ pendingChunks: 2, processedItems: 1 });
  });
});
