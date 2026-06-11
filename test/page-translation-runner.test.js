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
