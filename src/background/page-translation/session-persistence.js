import { log } from '../../shared/logger.js';

// 実行開始時・チャンク完了時のチェックポイント。MV3 worker 停止後も
// 成功済みの訳文を保ち、失敗・未処理分から再試行するために退避する。
// chrome.storage.session はディスクに書かれないブラウザセッション限定のストアで、
// settings（APIキー含む）を保持しても chrome.storage.local 永続化より露出面を増やさない。
const STORAGE_KEY_PREFIX = 'pageTranslationSession:';
const tabStorageOperations = new Map();

function resolveStorageArea(storageArea) {
  return storageArea ?? globalThis.chrome?.storage?.session ?? null;
}

function makeStorageKey(tabId, snapshotId) {
  return `${STORAGE_KEY_PREFIX}${tabId}:${snapshotId}`;
}

function makeTabStorageKeyPrefix(tabId) {
  return `${STORAGE_KEY_PREFIX}${tabId}:`;
}

function getRuntimeError() {
  const lastError = globalThis.chrome?.runtime?.lastError;
  if (!lastError) return null;
  return new Error(lastError.message || String(lastError));
}

function storageGet(area, keyOrKeys) {
  return new Promise((resolve, reject) => {
    try {
      area.get(keyOrKeys, (result) => {
        const error = getRuntimeError();
        if (error) return reject(error);
        resolve(result || {});
      });
    } catch (error) {
      reject(error);
    }
  });
}

function storageSet(area, items) {
  return new Promise((resolve, reject) => {
    try {
      area.set(items, () => {
        const error = getRuntimeError();
        if (error) return reject(error);
        resolve();
      });
    } catch (error) {
      reject(error);
    }
  });
}

function storageRemove(area, keyOrKeys) {
  return new Promise((resolve, reject) => {
    try {
      area.remove(keyOrKeys, () => {
        const error = getRuntimeError();
        if (error) return reject(error);
        resolve();
      });
    } catch (error) {
      reject(error);
    }
  });
}

// 同一タブでは旧 run の persist と新規 start/cancel の削除順を固定する。
// 異なるタブは独立キーのため、この待ち行列を共有せず並行実行できる。
async function runTabStorageOperation(tabId, operation) {
  const previous = tabStorageOperations.get(tabId) || Promise.resolve();
  const current = previous.catch(() => {}).then(operation);
  tabStorageOperations.set(tabId, current);
  try {
    return await current;
  } finally {
    if (tabStorageOperations.get(tabId) === current) {
      tabStorageOperations.delete(tabId);
    }
  }
}

// JSON 保存できないランタイム状態（AbortController 等）は退避対象から除外し、
// 復元時に再構築する。
export function serializeSession(session) {
  return {
    tabId: session.tabId,
    snapshotId: session.snapshotId,
    settings: session.settings,
    chunks: session.chunks,
    chunkOffsets: session.chunkOffsets,
    chunkResults: session.chunkResults,
    totalItems: session.totalItems,
    lastError: session.lastError ?? null,
    params: session.params
  };
}

// 復元データが不正な場合（スキーマ不一致・破損）は null を返し、呼び出し元で
// 「セッションなし」と同じ扱いにさせる。
export function reviveSession(data) {
  if (
    !data ||
    !Array.isArray(data.chunks) ||
    !Array.isArray(data.chunkOffsets) ||
    !Array.isArray(data.chunkResults) ||
    data.tabId === undefined ||
    data.snapshotId === undefined
  ) {
    return null;
  }
  return {
    ...data,
    canceled: false,
    running: false,
    abortController: new AbortController()
  };
}

export async function persistSession(session, storageArea) {
  const area = resolveStorageArea(storageArea);
  if (!area) return;
  try {
    await runTabStorageOperation(session.tabId, () => {
      if (session.canceled) return;
      return storageSet(area, {
        [makeStorageKey(session.tabId, session.snapshotId)]: serializeSession(session)
      });
    });
  } catch (error) {
    // 退避失敗は翻訳機能を壊さない。SW再起動後の再試行が使えなくなるだけ。
    log.warn('pageTranslation', 'partialセッションの退避に失敗しました', error);
  }
}

export async function loadPersistedSession(tabId, snapshotId, storageArea) {
  const area = resolveStorageArea(storageArea);
  if (!area) return null;
  try {
    return await runTabStorageOperation(tabId, async () => {
      const key = makeStorageKey(tabId, snapshotId);
      const result = await storageGet(area, key);
      const session = reviveSession(result[key]);
      if (!session || session.tabId !== tabId || session.snapshotId !== snapshotId) return null;
      return session;
    });
  } catch (error) {
    log.warn('pageTranslation', '退避セッションの読み込みに失敗しました', error);
    return null;
  }
}

export async function removePersistedSession(tabId, snapshotId, storageArea) {
  const area = resolveStorageArea(storageArea);
  if (!area) return;
  try {
    await runTabStorageOperation(tabId, () => storageRemove(area, makeStorageKey(tabId, snapshotId)));
  } catch (error) {
    log.warn('pageTranslation', '退避セッションの削除に失敗しました', error);
  }
}

// 同一タブで翻訳をやり直す際、旧スナップショットの退避セッションを一掃する。
export async function removePersistedSessionsForTab(tabId, storageArea) {
  const area = resolveStorageArea(storageArea);
  if (!area) return;
  try {
    await runTabStorageOperation(tabId, async () => {
      const stored = await storageGet(area, null);
      const prefix = makeTabStorageKeyPrefix(tabId);
      const keys = Object.keys(stored).filter((key) => key.startsWith(prefix));
      if (keys.length > 0) await storageRemove(area, keys);
    });
  } catch (error) {
    log.warn('pageTranslation', 'タブの退避セッション削除に失敗しました', error);
  }
}
