import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  loadPersistedSession,
  persistSession,
  removePersistedSession,
  removePersistedSessionsForTab,
  reviveSession,
  serializeSession
} from '../src/background/page-translation/session-persistence.js';
import { log } from '../src/shared/logger.js';

function createMockStorageArea({ asyncCallbacks = false, deferFirstSet = false } = {}) {
  const store = new Map();
  let pendingSetCallback = null;
  const invoke = (callback) => {
    if (asyncCallbacks) queueMicrotask(callback);
    else callback();
  };
  const area = {
    get(keyOrKeys, callback) {
      invoke(() => {
        const keys = keyOrKeys === null
          ? [...store.keys()]
          : Array.isArray(keyOrKeys) ? keyOrKeys : [keyOrKeys];
        const result = {};
        for (const key of keys) {
          if (store.has(key)) result[key] = store.get(key);
        }
        callback(result);
      });
    },
    set(items, callback) {
      invoke(() => {
        for (const [key, value] of Object.entries(items)) store.set(key, value);
        if (deferFirstSet && pendingSetCallback === null) {
          pendingSetCallback = callback;
          return;
        }
        if (typeof callback === 'function') callback();
      });
    },
    remove(keyOrKeys, callback) {
      invoke(() => {
        const keys = Array.isArray(keyOrKeys) ? keyOrKeys : [keyOrKeys];
        for (const key of keys) store.delete(key);
        if (typeof callback === 'function') callback();
      });
    },
    hasPendingSet() {
      return pendingSetCallback !== null;
    },
    releasePendingSet() {
      const callback = pendingSetCallback;
      pendingSetCallback = null;
      if (typeof callback === 'function') callback();
    }
  };
  return area;
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

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

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

  it('異なるタブへの同時保存が相互のセッションを失わない', async () => {
    const area = createMockStorageArea({ asyncCallbacks: true });

    await Promise.all([
      persistSession(makeSession({ tabId: 1, snapshotId: 1 }), area),
      persistSession(makeSession({ tabId: 2, snapshotId: 1 }), area)
    ]);

    expect(await loadPersistedSession(1, 1, area)).not.toBeNull();
    expect(await loadPersistedSession(2, 1, area)).not.toBeNull();
  });

  it('storage callback の lastError を退避失敗として記録する', async () => {
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => {});
    vi.stubGlobal('chrome', { runtime: { lastError: null } });
    const area = createMockStorageArea();
    area.set = (_items, callback) => {
      globalThis.chrome.runtime.lastError = { message: 'quota exceeded' };
      callback();
      globalThis.chrome.runtime.lastError = null;
    };

    await persistSession(makeSession(), area);

    expect(warn).toHaveBeenCalledWith(
      'pageTranslation',
      'partialセッションの退避に失敗しました',
      expect.objectContaining({ message: 'quota exceeded' })
    );
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

  it('進行中の旧セッション保存後に同一タブの一掃を実行する', async () => {
    const area = createMockStorageArea({ deferFirstSet: true });
    const persistPromise = persistSession(makeSession({ tabId: 1, snapshotId: 4 }), area);
    await vi.waitFor(() => expect(area.hasPendingSet()).toBe(true));

    const removePromise = removePersistedSessionsForTab(1, area);
    area.releasePendingSet();
    await Promise.all([persistPromise, removePromise]);

    expect(await loadPersistedSession(1, 4, area)).toBeNull();
  });
});
