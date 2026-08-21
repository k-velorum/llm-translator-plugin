import { log } from '../../shared/logger.js';

// partial 完了セッションの退避先。MV3 service worker は idle 停止でメモリ上の
// セッションを失うため、「失敗分を再試行」を機能させるには別ストアへの退避が要る。
// chrome.storage.session はディスクに書かれないブラウザセッション限定のストアで、
// settings（APIキー含む）を保持しても chrome.storage.local 永続化より露出面を増やさない。
const STORAGE_KEY = 'pageTranslationSessions';

function resolveStorageArea(storageArea) {
  return storageArea ?? globalThis.chrome?.storage?.session ?? null;
}

function makeSessionKey(tabId, snapshotId) {
  return `${tabId}:${snapshotId}`;
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

async function readSessionMap(storageArea) {
  const area = resolveStorageArea(storageArea);
  if (!area) return {};
  const data = await new Promise((resolve) => {
    try {
      area.get(STORAGE_KEY, (result) => resolve(result || {}));
    } catch (_) {
      resolve({});
    }
  });
  const map = data?.[STORAGE_KEY];
  return map && typeof map === 'object' ? map : {};
}

async function writeSessionMap(map, storageArea) {
  const area = resolveStorageArea(storageArea);
  if (!area) return;
  await new Promise((resolve) => {
    try {
      area.set({ [STORAGE_KEY]: map }, () => resolve());
    } catch (_) {
      resolve();
    }
  });
}

export async function persistSession(session, storageArea) {
  try {
    const map = await readSessionMap(storageArea);
    map[makeSessionKey(session.tabId, session.snapshotId)] = serializeSession(session);
    await writeSessionMap(map, storageArea);
  } catch (e) {
    // 退避失敗は翻訳機能を壊さない。SW再起動後の再試行が使えなくなるだけ。
    log.warn('pageTranslation', 'partialセッションの退避に失敗しました', e);
  }
}

export async function loadPersistedSession(tabId, snapshotId, storageArea) {
  try {
    const map = await readSessionMap(storageArea);
    return reviveSession(map[makeSessionKey(tabId, snapshotId)]);
  } catch (e) {
    log.warn('pageTranslation', '退避セッションの読み込みに失敗しました', e);
    return null;
  }
}

export async function removePersistedSession(tabId, snapshotId, storageArea) {
  try {
    const map = await readSessionMap(storageArea);
    const key = makeSessionKey(tabId, snapshotId);
    if (!(key in map)) return;
    delete map[key];
    await writeSessionMap(map, storageArea);
  } catch (e) {
    log.warn('pageTranslation', '退避セッションの削除に失敗しました', e);
  }
}

// 同一タブで翻訳をやり直す際、旧スナップショットの退避セッションを一掃する。
export async function removePersistedSessionsForTab(tabId, storageArea) {
  try {
    const map = await readSessionMap(storageArea);
    const prefix = `${tabId}:`;
    let changed = false;
    for (const key of Object.keys(map)) {
      if (key.startsWith(prefix)) {
        delete map[key];
        changed = true;
      }
    }
    if (changed) await writeSessionMap(map, storageArea);
  } catch (e) {
    log.warn('pageTranslation', 'タブの退避セッション削除に失敗しました', e);
  }
}
