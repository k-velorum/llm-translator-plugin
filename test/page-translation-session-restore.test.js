import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// service 経由の再試行を検証するため、実際の API 呼び出し直前の translateChunk のみ差し替える
vi.mock('../src/background/page-translation/translator.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, translateChunk: vi.fn() };
});

import {
  handlePageTranslationRuntimeMessage,
  startPageTranslation,
  discardPageTranslationSessionsForTab
} from '../src/background/page-translation-service.js';
import { translateChunk } from '../src/background/page-translation/translator.js';
import {
  loadPersistedSession,
  persistSession
} from '../src/background/page-translation/session-persistence.js';

function createMockStorageArea() {
  const store = new Map();
  return {
    get(keyOrKeys, callback) {
      const keys = keyOrKeys === null
        ? [...store.keys()]
        : Array.isArray(keyOrKeys) ? keyOrKeys : [keyOrKeys];
      const result = {};
      for (const key of keys) {
        if (store.has(key)) result[key] = store.get(key);
      }
      callback(result);
    },
    set(items, callback) {
      for (const [key, value] of Object.entries(items)) store.set(key, value);
      if (typeof callback === 'function') callback();
    },
    remove(keyOrKeys, callback) {
      const keys = Array.isArray(keyOrKeys) ? keyOrKeys : [keyOrKeys];
      for (const key of keys) store.delete(key);
      if (typeof callback === 'function') callback();
    }
  };
}

function installChromeStub(sessionArea, { pageSnapshot = null, settings = {} } = {}) {
  const localStore = new Map();
  const sentMessages = [];
  vi.stubGlobal('chrome', {
    runtime: {
      lastError: null,
      getPlatformInfo: (callback) => callback && callback({})
    },
    storage: {
      local: {
        get: (key, callback) => {
          const result = {};
          if (localStore.has(key)) result[key] = localStore.get(key);
          callback(result);
        },
        set: (items, callback) => {
          for (const [key, value] of Object.entries(items)) localStore.set(key, value);
          if (typeof callback === 'function') callback();
        }
      },
      sync: {
        get: (defaults, callback) => callback({
          ...defaults,
          apiProvider: 'gemini',
          geminiModel: 'test',
          pageTranslationDelayMs: 0,
          pageTranslationConcurrency: 1,
          pageTranslationUseStructuredOutput: false,
          ...settings
        }),
        set: (_items, callback) => {
          if (typeof callback === 'function') callback();
        }
      },
      session: sessionArea
    },
    tabs: {
      sendMessage: async (tabId, message, options) => {
        expect(options).toEqual({ frameId: 0 });
        sentMessages.push({ tabId, message });
        if (message?.action === 'getPageTexts') return pageSnapshot;
        if (message?.action === 'applyPageTranslationChunk') return { ok: true };
      },
      query: async () => [{ id: 1 }]
    }
  });
  return { sentMessages };
}

function makePartialSession(overrides = {}) {
  return {
    tabId: 1,
    snapshotId: 7,
    settings: { apiProvider: 'gemini', geminiModel: 'test' },
    chunks: [['a', 'b'], ['c']],
    chunkOffsets: [0, 2],
    chunkResults: [
      { status: 'done', items: 2, failedItems: 0 },
      { status: 'failed', items: 1, failedItems: 1 }
    ],
    totalItems: 3,
    lastError: 'model output failure',
    params: { sep: '|||', delayMs: 0, concurrency: 1, useStructuredOutput: false },
    ...overrides
  };
}

function sendRuntimeMessage(message, sender) {
  return new Promise((resolve) => {
    handlePageTranslationRuntimeMessage(message, sender, resolve);
  });
}

describe('continuePageTranslation: SW再起動後のセッション復元', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await discardPageTranslationSessionsForTab(1);
    await discardPageTranslationSessionsForTab(2);
    vi.unstubAllGlobals();
  });

  it('退避済みpartialセッションを復元し失敗チャンクのみ再試行する', async () => {
    const sessionArea = createMockStorageArea();
    const { sentMessages } = installChromeStub(sessionArea);
    await persistSession(makePartialSession(), sessionArea);

    translateChunk.mockImplementation(async (chunk) => ({
      parts: chunk.map((text) => `${text}訳`),
      method: 'structured',
      failedItems: 0
    }));

    let response = null;
    handlePageTranslationRuntimeMessage(
      { action: 'continuePageTranslation', snapshotId: 7 },
      { tab: { id: 1 } },
      (r) => { response = r; }
    );

    await new Promise((resolve, reject) => {
      const startedAt = Date.now();
      const poll = () => {
        if (sentMessages.some(({ message }) => message?.status === 'completed')) return resolve();
        if (Date.now() - startedAt > 4000) return reject(new Error('完了通知が届きませんでした'));
        setTimeout(poll, 10);
      };
      poll();
    });

    expect(response).toEqual({ ok: true, retryChunks: 1 });
    expect(translateChunk).toHaveBeenCalledTimes(1);
    expect(translateChunk).toHaveBeenCalledWith(
      ['c'],
      expect.anything(),
      expect.anything(),
      expect.anything()
    );
    expect(await loadPersistedSession(1, 7, sessionArea)).toBeNull();

    const statuses = sentMessages.map(({ message }) => message?.status);
    expect(statuses).toContain('running');
    expect(statuses).toContain('completed');
  });

  it('退避セッションもない場合は従来どおり session not found を返す', async () => {
    installChromeStub(createMockStorageArea());

    let response = null;
    handlePageTranslationRuntimeMessage(
      { action: 'continuePageTranslation', snapshotId: 99 },
      { tab: { id: 1 } },
      (r) => { response = r; }
    );

    await vi.waitFor(() => {
      expect(response).toEqual({ ok: false, error: 'session not found' });
    });
    expect(translateChunk).not.toHaveBeenCalled();
  });
});

describe('page translation service: セッションの退避と破棄', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await discardPageTranslationSessionsForTab(1);
    await discardPageTranslationSessionsForTab(2);
    vi.unstubAllGlobals();
  });

  it('新規startで旧snapshotを掃除し、partialになった新snapshotを退避する', async () => {
    const sessionArea = createMockStorageArea();
    const { sentMessages } = installChromeStub(sessionArea, {
      pageSnapshot: { texts: ['new text'], snapshotId: 8 }
    });
    await persistSession(makePartialSession({ snapshotId: 7 }), sessionArea);
    translateChunk.mockResolvedValue({
      parts: [null],
      method: 'per-item',
      failedItems: 1
    });

    await startPageTranslation(1);

    expect(await loadPersistedSession(1, 7, sessionArea)).toBeNull();
    const persisted = await loadPersistedSession(1, 8, sessionArea);
    expect(persisted?.chunkResults[0]).toMatchObject({ status: 'failed', items: 1, failedItems: 1 });
    expect(sentMessages.some(({ message }) => message?.status === 'partial')).toBe(true);

    await sendRuntimeMessage(
      { action: 'cancelPageTranslation', snapshotId: 8 },
      { tab: { id: 1 } }
    );
    await vi.waitFor(async () => {
      expect(await loadPersistedSession(1, 8, sessionArea)).toBeNull();
    });
  });

  it('メモリにない退避セッションもcancelで削除する', async () => {
    const sessionArea = createMockStorageArea();
    const { sentMessages } = installChromeStub(sessionArea);
    await persistSession(makePartialSession({ tabId: 2, snapshotId: 9 }), sessionArea);

    expect(await sendRuntimeMessage(
      { action: 'cancelPageTranslation', snapshotId: 9 },
      { tab: { id: 2 } }
    )).toEqual({ ok: true });

    await vi.waitFor(async () => {
      expect(await loadPersistedSession(2, 9, sessionArea)).toBeNull();
    });
    expect(sentMessages).toContainEqual({
      tabId: 2,
      message: { action: 'hidePageTranslationControls', snapshotId: 9 }
    });
  });
});

describe('page translation service: LM Studioの同時実行設定', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(async () => {
    await discardPageTranslationSessionsForTab(1);
    vi.unstubAllGlobals();
  });

  it.each([1, 3])('LM Studioで設定値 %i 件までチャンクを同時実行する', async (concurrency) => {
    installChromeStub(createMockStorageArea(), {
      pageSnapshot: { texts: Array.from({ length: 20 }, (_, i) => `text ${i}`), snapshotId: 'lmstudio' },
      settings: {
        apiProvider: 'lmstudio',
        pageTranslationConcurrency: concurrency,
        pageTranslationMaxItemsPerChunk: 5
      }
    });
    // 応答を保留し、先行チャンク完了前に起動したワーカー数を検証する。
    translateChunk.mockImplementation(() => new Promise(() => {}));
    const running = startPageTranslation(1);
    try {
      await vi.waitFor(() => expect(translateChunk).toHaveBeenCalledTimes(concurrency));
      expect(await sendRuntimeMessage({ action: 'getPageTranslationStatus', snapshotId: 'lmstudio' },
        { tab: { id: 1 } })).toMatchObject({ activeChunks: concurrency, totalChunks: 4 });
      expect(translateChunk.mock.calls[0][2]).toMatchObject({ concurrency });
    } finally {
      await discardPageTranslationSessionsForTab(1);
      await running;
    }
  });
});

describe('page translation service: 実行途中の復帰と競合', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(async () => {
    await discardPageTranslationSessionsForTab(1);
    vi.unstubAllGlobals();
  });

  it('実行中にチェックポイントを保存し、停止後は再保存しない', async () => {
    const area = createMockStorageArea();
    installChromeStub(area, { pageSnapshot: { texts: ['one'], snapshotId: 'running' } });
    translateChunk.mockImplementation(() => new Promise(() => {}));
    const running = startPageTranslation(1);
    await vi.waitFor(() => expect(translateChunk).toHaveBeenCalledTimes(1));
    expect(await loadPersistedSession(1, 'running', area)).not.toBeNull();
    expect(await sendRuntimeMessage({ action: 'getPageTranslationStatus', snapshotId: 'running' },
      { tab: { id: 1 } })).toMatchObject({ ok: true, status: 'running', activeChunks: 1 });
    await sendRuntimeMessage({ action: 'cancelPageTranslation', snapshotId: 'running' }, { tab: { id: 1 } });
    await running;
    await vi.waitFor(async () => expect(await loadPersistedSession(1, 'running', area)).toBeNull());
  });

  it('worker消失時は未処理分のあるチェックポイントを再試行可能と表示する', async () => {
    const area = createMockStorageArea();
    installChromeStub(area);
    await persistSession(makePartialSession({ snapshotId: 'interrupted', chunkResults: [
      { status: 'done', items: 2, failedItems: 0 }, null
    ] }), area);
    expect(await sendRuntimeMessage({ action: 'getPageTranslationStatus', snapshotId: 'interrupted' },
      { tab: { id: 1 } })).toMatchObject({ ok: true, status: 'partial', processedItems: 2, remainingChunks: 1 });
    translateChunk.mockResolvedValue({ parts: ['三'], method: 'per-item' });
    expect(await sendRuntimeMessage({ action: 'continuePageTranslation', snapshotId: 'interrupted' },
      { tab: { id: 1 } })).toMatchObject({ ok: true, retryChunks: 1 });
    await vi.waitFor(() => expect(translateChunk).toHaveBeenCalledTimes(1));
    expect(translateChunk.mock.calls[0][0]).toEqual(['c']);
  });

  it('復元と再試行を連打しても同一チャンクを二重送信しない', async () => {
    const area = createMockStorageArea();
    installChromeStub(area);
    await persistSession(makePartialSession({ snapshotId: 'double' }), area);
    translateChunk.mockImplementation(() => new Promise(() => {}));
    const message = { action: 'continuePageTranslation', snapshotId: 'double' };
    const responses = await Promise.all([
      sendRuntimeMessage(message, { tab: { id: 1 } }),
      sendRuntimeMessage(message, { tab: { id: 1 } })
    ]);
    expect(responses).toContainEqual({ ok: true, alreadyRunning: true });
    await vi.waitFor(() => expect(translateChunk).toHaveBeenCalledTimes(1));
  });

  it('開始を連打した場合は最後の要求だけ実行する', async () => {
    const area = createMockStorageArea();
    installChromeStub(area, { pageSnapshot: { texts: ['one'], snapshotId: 'latest' } });
    translateChunk.mockResolvedValue({ parts: ['一'], method: 'per-item' });
    await Promise.all([startPageTranslation(1), startPageTranslation(1)]);
    expect(translateChunk).toHaveBeenCalledTimes(1);
  });

  it('iframeからの操作を拒否する', async () => {
    installChromeStub(createMockStorageArea());
    expect(await sendRuntimeMessage({ action: 'continuePageTranslation', snapshotId: 7 },
      { tab: { id: 1 }, frameId: 2 })).toMatchObject({ ok: false });
    expect(translateChunk).not.toHaveBeenCalled();
  });
});

describe('page translation service: 復元中のキャンセル', () => {
  afterEach(async () => {
    await discardPageTranslationSessionsForTab(1);
    vi.unstubAllGlobals();
  });

  it('古いstorage応答が遅れて届いてもキャンセル済みセッションを復活させない', async () => {
    vi.clearAllMocks();
    const area = createMockStorageArea();
    installChromeStub(area);
    await persistSession(makePartialSession({ snapshotId: 'cancel-loading' }), area);
    const originalGet = area.get;
    let release;
    area.get = (key, callback) => {
      area.get = originalGet;
      originalGet(key, (value) => { release = () => callback(value); });
    };
    const retry = sendRuntimeMessage({ action: 'continuePageTranslation', snapshotId: 'cancel-loading' },
      { tab: { id: 1 } });
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    await sendRuntimeMessage({ action: 'cancelPageTranslation', snapshotId: 'cancel-loading' },
      { tab: { id: 1 } });
    release();
    expect(await retry).toMatchObject({ ok: false });
    expect(translateChunk).not.toHaveBeenCalled();
    await vi.waitFor(async () => expect(await loadPersistedSession(1, 'cancel-loading', area)).toBeNull());
  });
});
