import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// service 経由の再試行を検証するため、実際の API 呼び出し直前の translateChunk のみ差し替える
vi.mock('../src/background/page-translation/translator.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, translateChunk: vi.fn() };
});

import { handlePageTranslationRuntimeMessage } from '../src/background/page-translation-service.js';
import { translateChunk } from '../src/background/page-translation/translator.js';
import {
  loadPersistedSession,
  persistSession
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

function installChromeStub(sessionArea) {
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
      session: sessionArea
    },
    tabs: {
      sendMessage: async (tabId, message) => {
        sentMessages.push({ tabId, message });
      },
      query: async () => [{ id: 1 }]
    }
  });
  return { sentMessages };
}

function makePartialSession() {
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
    params: { sep: '|||', delayMs: 0, concurrency: 1, useStructuredOutput: false }
  };
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
