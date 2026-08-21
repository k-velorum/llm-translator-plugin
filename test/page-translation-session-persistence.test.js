import { describe, expect, it } from 'vitest';

import {
  loadPersistedSession,
  persistSession,
  removePersistedSession,
  removePersistedSessionsForTab,
  reviveSession,
  serializeSession
} from '../src/background/page-translation/session-persistence.js';

function createMockStorageArea() {
  const store = new Map();
  return {
    get(keyOrKeys, callback) {
      const keys = Array.isArray(keyOrKeys) ? keyOrKeys : [keyOrKeys];
      const result = {};
      for (const key of keys) {
        if (store.has(key)) result[key] = store.get(key);
      }
      callback(result);
    },
    set(items, callback) {
      for (const [key, value] of Object.entries(items)) store.set(key, value);
      if (typeof callback === 'function') callback();
    }
  };
}

function makeSession(overrides = {}) {
  return {
    tabId: 1,
    snapshotId: 3,
    settings: { apiProvider: 'gemini', geminiModel: 'test' },
    chunks: [['a', 'b'], ['c']],
    chunkOffsets: [0, 2],
    chunkResults: [
      { status: 'done', items: 2, failedItems: 0 },
      { status: 'failed', items: 1, failedItems: 1 }
    ],
    totalItems: 3,
    canceled: false,
    running: false,
    lastError: 'boom',
    abortController: new AbortController(),
    params: { sep: '|||', delayMs: 0, concurrency: 1 },
    ...overrides
  };
}

describe('serializeSession / reviveSession', () => {
  it('JSON化できないランタイム状態を除外してシリアライズする', () => {
    const serialized = serializeSession(makeSession());

    expect(serialized).not.toHaveProperty('abortController');
    expect(serialized).not.toHaveProperty('canceled');
    expect(serialized).not.toHaveProperty('running');
    expect(serialized).toEqual({
      tabId: 1,
      snapshotId: 3,
      settings: { apiProvider: 'gemini', geminiModel: 'test' },
      chunks: [['a', 'b'], ['c']],
      chunkOffsets: [0, 2],
      chunkResults: [
        { status: 'done', items: 2, failedItems: 0 },
        { status: 'failed', items: 1, failedItems: 1 }
      ],
      totalItems: 3,
      lastError: 'boom',
      params: { sep: '|||', delayMs: 0, concurrency: 1 }
    });
  });

  it('復元時に AbortController を再構築し実行状態をリセットする', () => {
    const revived = reviveSession(serializeSession(makeSession()));

    expect(revived.abortController).toBeInstanceOf(AbortController);
    expect(revived.canceled).toBe(false);
    expect(revived.running).toBe(false);
    expect(revived.chunks).toEqual([['a', 'b'], ['c']]);
    expect(revived.chunkResults[1]).toEqual({ status: 'failed', items: 1, failedItems: 1 });
  });

  it('不正なデータ（破損・スキーマ不一致）は null を返す', () => {
    expect(reviveSession(null)).toBeNull();
    expect(reviveSession({})).toBeNull();
    expect(reviveSession({ tabId: 1, snapshotId: 1, chunks: 'x', chunkOffsets: [0], chunkResults: [null] })).toBeNull();
    expect(reviveSession({ tabId: 1, snapshotId: 1, chunks: [[]], chunkOffsets: 'x', chunkResults: [null] })).toBeNull();
    expect(reviveSession({ tabId: 1, snapshotId: 1, chunks: [[]], chunkOffsets: [0], chunkResults: 'x' })).toBeNull();
  });
});

describe('persistSession / loadPersistedSession', () => {
  it('退避したセッションを復元できる', async () => {
    const area = createMockStorageArea();
    const session = makeSession();

    await persistSession(session, area);
    const restored = await loadPersistedSession(session.tabId, session.snapshotId, area);

    expect(restored).not.toBeNull();
    expect(restored.chunks).toEqual(session.chunks);
    expect(restored.chunkOffsets).toEqual(session.chunkOffsets);
    expect(restored.chunkResults).toEqual(session.chunkResults);
    expect(restored.settings).toEqual(session.settings);
    expect(restored.params).toEqual(session.params);
  });

  it('未退避のセッション読み込みは null を返す', async () => {
    const area = createMockStorageArea();
    expect(await loadPersistedSession(1, 9, area)).toBeNull();
  });

  it('storage が利用できない環境でも例外を投げず null を返す', async () => {
    expect(await loadPersistedSession(1, 3, null)).toBeNull();
  });
});

describe('removePersistedSession / removePersistedSessionsForTab', () => {
  it('対象セッションのみ削除する', async () => {
    const area = createMockStorageArea();
    await persistSession(makeSession({ tabId: 1, snapshotId: 1 }), area);
    await persistSession(makeSession({ tabId: 2, snapshotId: 5 }), area);

    await removePersistedSession(1, 1, area);

    expect(await loadPersistedSession(1, 1, area)).toBeNull();
    expect(await loadPersistedSession(2, 5, area)).not.toBeNull();
  });

  it('タブ単位で退避セッションを一掃する', async () => {
    const area = createMockStorageArea();
    await persistSession(makeSession({ tabId: 1, snapshotId: 1 }), area);
    await persistSession(makeSession({ tabId: 1, snapshotId: 2 }), area);
    await persistSession(makeSession({ tabId: 3, snapshotId: 1 }), area);

    await removePersistedSessionsForTab(1, area);

    expect(await loadPersistedSession(1, 1, area)).toBeNull();
    expect(await loadPersistedSession(1, 2, area)).toBeNull();
    expect(await loadPersistedSession(3, 1, area)).not.toBeNull();
  });
});
