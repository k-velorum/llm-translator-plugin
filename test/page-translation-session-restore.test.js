import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// service 経由の再試行を検証するため、実際の API 呼び出し直前の translateChunk のみ差し替える
vi.mock('../src/background/page-translation/translator.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, translateChunk: vi.fn() };
});

import {
  handlePageTranslationRuntimeMessage,
  startPageTranslation
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

function installChromeStub(sessionArea, { pageSnapshot = null } = {}) {
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
          pageTranslationUseStructuredOutput: false
        }),
        set: (_items, callback) => {
          if (typeof callback === 'function') callback();
        }
      },
      session: sessionArea
    },
    tabs: {
      sendMessage: async (tabId, message) => {
        sentMessages.push({ tabId, message });
        if (message?.action === 'getPageTexts') return pageSnapshot;
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

  afterEach(() => {
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

  afterEach(() => {
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
    expect(persisted?.chunkResults[0]).toEqual({ status: 'failed', items: 1, failedItems: 1 });
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
