import { loadSettings, DEFAULT_SETTINGS } from './settings.js';
import { appendLog, getProviderMeta } from './logging.js';
import { log } from '../shared/logger.js';
import { chunkByEstimatedOutputAndItems } from './page-translation/chunking.js';
import {
  computeChunkOffsets,
  getFailedChunkIndexes,
  runChunkQueue,
  summarizeSession
} from './page-translation/runner.js';
import {
  loadPersistedSession,
  persistSession,
  removePersistedSession,
  removePersistedSessionsForTab
} from './page-translation/session-persistence.js';
import { buildSeparatorFallbackPrompt, clampInt } from './page-translation/translator.js';
import { getProviderCapabilities } from './api/registry.js';
import { withTimeout } from '../shared/async-utils.js';

const startingTabs = new Map();
const restoringSessions = new Map();
const pageTranslationSessions = new Map(); // key: `${tabId}:${snapshotId}` -> session

// MV3 service worker は拡張 API 呼び出しがないと約30秒で停止されるため、
// 翻訳実行中は定期的に no-op の API を呼んで idle kill を防ぐ。
const KEEP_ALIVE_INTERVAL_MS = 20000;
let keepAliveTimer = null;

function updateKeepAlive() {
  const anyRunning = [...pageTranslationSessions.values()].some((s) => s.running);
  if (anyRunning && keepAliveTimer === null) {
    keepAliveTimer = setInterval(() => {
      try {
        chrome.runtime.getPlatformInfo(() => {});
      } catch (_) {
        // no-op
      }
    }, KEEP_ALIVE_INTERVAL_MS);
  } else if (!anyRunning && keepAliveTimer !== null) {
    clearInterval(keepAliveTimer);
    keepAliveTimer = null;
  }
}

function makeSessionKey(tabId, snapshotId) {
  return `${tabId}:${snapshotId}`;
}

function getPageTranslationSession(tabId, snapshotId) {
  return pageTranslationSessions.get(makeSessionKey(tabId, snapshotId));
}

function deletePageTranslationSession(tabId, snapshotId) {
  pageTranslationSessions.delete(makeSessionKey(tabId, snapshotId));
  updateKeepAlive();
}

// 同一タブで翻訳をやり直したとき、旧セッションの結果が新スナップショットへ
// 混ざらないよう先に中断・破棄する。
function abortSessionsForTab(tabId) {
  const prefix = `${tabId}:`;
  for (const key of restoringSessions.keys()) {
    if (key.startsWith(prefix)) restoringSessions.delete(key);
  }
  for (const [key, session] of pageTranslationSessions) {
    if (!key.startsWith(prefix)) continue;
    session.canceled = true;
    try {
      session.abortController?.abort();
    } catch (_) {
      // no-op
    }
    pageTranslationSessions.delete(key);
  }
  updateKeepAlive();
}

// 新規実行・タブ終了のどちらでも、メモリと storage のセッションを同じ順序で破棄する。
// abort は同期的に canceled を立て、storage 側はタブ単位の操作列で進行中 persist の後に並ぶ。
export async function discardPageTranslationSessionsForTab(tabId) {
  if (!tabId) return;
  startingTabs.delete(tabId);
  abortSessionsForTab(tabId);
  await removePersistedSessionsForTab(tabId);
}

async function resolveTabIdFromSenderOrActive(sender) {
  return sender?.tab?.id || (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id;
}

// 進捗・状態は background から content へ一方向 push する。
// status: 'running' | 'completed' | 'partial' | 'canceled'
function controlsState(session, status) {
  const summary = summarizeSession(session);
  return {
    snapshotId: session.snapshotId,
    status,
    noteText: status === 'partial'
      ? session.lastError || (summary.pendingChunks > 0 ? '処理が中断しました。未完了分を再試行できます。' : '')
      : '',
    processedItems: summary.processedItems,
    totalItems: session.totalItems,
    failedItems: summary.failedItems,
    failedChunks: summary.failedChunks,
    remainingChunks: summary.pendingChunks,
    totalChunks: session.chunks.length,
    activeChunks: session.activeChunks || 0,
    elapsedSeconds: Math.floor((Date.now() - (session.startedAt || Date.now())) / 1000)
  };
}

// all_frames の content script のうち、本文があるトップフレームだけへ送る。
function sendToPage(tabId, message) {
  return withTimeout(() => chrome.tabs.sendMessage(tabId, message, { frameId: 0 }), 10000);
}

async function notifyControls(session, status) {
  if (session.canceled) return;
  await sendToPage(session.tabId, {
    action: 'showPageTranslationControls',
    ...controlsState(session, status)
  });
}

async function hideControls(tabId, snapshotId) {
  await sendToPage(tabId, {
    action: 'hidePageTranslationControls',
    snapshotId
  });
}

function resolveConcurrency(settings) {
  const userConcurrency = clampInt(
    settings.pageTranslationConcurrency,
    1,
    20,
    DEFAULT_SETTINGS.pageTranslationConcurrency
  );
  // ローカル推論サーバー（LM Studio / Ollama 等）はリクエストを逐次処理する
  // ため、並列に投げると互いを待たせてタイムアウト連鎖を起こす。provider の
  // 上限 capability でユーザー設定を抑える。
  const maxConcurrency = getProviderCapabilities(settings).maxPageTranslationConcurrency;
  return maxConcurrency ? Math.min(userConcurrency, maxConcurrency) : userConcurrency;
}

function buildSessionParams(settings) {
  const sep = (settings.pageTranslationSeparator || DEFAULT_SETTINGS.pageTranslationSeparator).toString();
  return {
    sep,
    separatorSystemPrompt: buildSeparatorFallbackPrompt(settings),
    maxChars: clampInt(settings.pageTranslationMaxChars, 500, 32000, DEFAULT_SETTINGS.pageTranslationMaxChars),
    maxItemsPerChunk: clampInt(
      settings.pageTranslationMaxItemsPerChunk,
      5,
      500,
      DEFAULT_SETTINGS.pageTranslationMaxItemsPerChunk
    ),
    delayMs: clampInt(settings.pageTranslationDelayMs, 0, 60000, DEFAULT_SETTINGS.pageTranslationDelayMs),
    concurrency: resolveConcurrency(settings),
    useStructuredOutput: settings.pageTranslationUseStructuredOutput !== false,
    disableStructuredAfterFailure: true,
    runtime: { structuredDisabled: false }
  };
}

async function applyChunkToTab(session, chunkIndex, parts) {
  const response = await sendToPage(session.tabId, {
    action: 'applyPageTranslationChunk',
    snapshotId: session.snapshotId,
    offset: session.chunkOffsets[chunkIndex],
    translations: parts
  });
  if (!response?.ok) {
    throw new Error(response?.error || '訳文をページに反映できませんでした。ページの変更を確認してください。');
  }
}

// 指定チャンク群を実行し、終了時の状態を content へ通知する共通経路。
// start / retry のどちらからも呼ばれる。
async function runSession(session, chunkIndexes) {
  const runToken = {};
  session.runToken = runToken;
  session.running = true;
  session.startedAt = Date.now();
  updateKeepAlive();

  // 再試行直後もパネルを即「実行中」へ切り替える（以降はチャンク完了ごとに push）
  try {
    await persistSession(session);
    await notifyControls(session, 'running').catch(() => {});
    await runChunkQueue(session, chunkIndexes, {
      applyChunk: (idx, parts) => applyChunkToTab(session, idx, parts),
      notifyProgress: async () => {
        if (session.canceled) return;
        await persistSession(session);
        await notifyControls(session, 'running');
      }
    });
    if (!session.canceled) await finishSession(session);
  } catch (error) {
    if (!session.canceled) {
      session.lastError = error?.message || String(error);
      session.running = false;
      await persistSession(session);
      await notifyControls(session, 'partial').catch(() => {});
    }
  } finally {
    if (session.runToken === runToken) session.running = false;
    updateKeepAlive();
  }
}

async function finishSession(session) {
  const summary = summarizeSession(session);
  const finished = summary.failedChunks === 0 && summary.pendingChunks === 0;

  if (finished) {
    // 完了pushを取り逃しても状態照会で回復できるよう、最後の状態はメモリに残す。
    // 本文・APIキーは不要になった時点で解放する。
    await removePersistedSession(session.tabId, session.snapshotId);
  } else {
    // SW の idle 停止でメモリ上のセッションが失われても「失敗分を再試行」が
    // 使えるよう、partial 完了時点で状態を退避しておく。
    await persistSession(session);
  }

  await appendLog({
    level: finished ? 'info' : 'warn',
    type: 'page-translation',
    event: finished ? 'complete' : 'completed_with_failures',
    ...getProviderMeta(session.settings),
    tabId: session.tabId,
    snapshotId: session.snapshotId,
    totalItems: session.totalItems,
    totalChunks: session.chunks.length,
    failedChunks: summary.failedChunks,
    failedItems: summary.failedItems,
    message: session.lastError || undefined
  });

  if (session.canceled) return;
  session.running = false;
  updateKeepAlive();
  try {
    await notifyControls(session, finished ? 'completed' : 'partial');
  } catch (e) {
    log.warn('pageTranslation', '完了状態の通知に失敗しました', e);
  }
  if (finished) {
    session.settings = {};
    session.params = {};
    session.chunks = session.chunks.map(() => []);
    session.chunkResults = session.chunkResults.map(({ parts: _parts, ...result }) => result);
  }
}

export async function startPageTranslation(tabId) {
  log.info('pageTranslation', 'ページ全体翻訳リクエストを受信');
  if (!tabId) return;
  const startToken = {};
  let snapshotId;

  try {
    // 旧スナップショット宛の退避セッションが残っていても新規実行では使わない
    const discarded = discardPageTranslationSessionsForTab(tabId);
    startingTabs.set(tabId, startToken);
    await discarded;
    if (startingTabs.get(tabId) !== startToken) return;

    const response = await sendToPage(tabId, { action: 'getPageTexts' });
    snapshotId = response?.snapshotId;
    if (!snapshotId || !Array.isArray(response?.texts)) throw new Error('ページの文章を取得できませんでした');
    const pageTexts = response.texts;
    const settings = await withTimeout(() => loadSettings(), 10000);
    if (startingTabs.get(tabId) !== startToken) return;
    const params = buildSessionParams(settings);

    const chunks = chunkByEstimatedOutputAndItems(
      pageTexts,
      params.maxChars,
      params.maxItemsPerChunk,
      params.sep,
      params.useStructuredOutput
    );

    const session = {
      tabId,
      snapshotId,
      settings,
      chunks,
      chunkOffsets: computeChunkOffsets(chunks),
      chunkResults: new Array(chunks.length).fill(null),
      totalItems: pageTexts.length,
      canceled: false,
      running: false,
      lastError: null,
      abortController: new AbortController(),
      params
    };

    pageTranslationSessions.set(makeSessionKey(tabId, snapshotId), session);

    await appendLog({
      level: 'info',
      type: 'page-translation',
      event: 'start',
      ...getProviderMeta(settings),
      tabId,
      snapshotId,
      totalItems: session.totalItems,
      totalChunks: chunks.length,
      params: {
        maxChars: params.maxChars,
        maxItemsPerChunk: params.maxItemsPerChunk,
        delayMs: params.delayMs,
        concurrency: params.concurrency,
        useStructuredOutput: params.useStructuredOutput
      }
    });

    if (session.canceled) return;
    await runSession(session, chunks.map((_, i) => i));
  } catch (error) {
    if (startingTabs.get(tabId) !== startToken) return;
    if (snapshotId) {
      await sendToPage(tabId, { action: 'showPageTranslationControls', snapshotId,
        status: 'lost', noteText: '翻訳を開始できませんでした。ページを再読み込みしてお試しください。' }).catch(() => {});
    }
    log.error('pageTranslation', 'ページ全体翻訳エラー', error);
    await appendLog({
      level: 'error',
      type: 'page-translation',
      event: 'fatal',
      ...getProviderMeta(await loadSettings().catch(() => ({}))),
      tabId,
      message: error?.message || String(error)
    });
  } finally {
    if (startingTabs.get(tabId) === startToken) startingTabs.delete(tabId);
  }
}

// 同じsnapshotの復元を共有し、復元中のキャンセル・新規開始に追い越された
// 古いロード結果がセッションを復活させないようにする。
async function restoreForRetry(tabId, snapshotId) {
  const key = makeSessionKey(tabId, snapshotId);
  if (startingTabs.has(tabId)) return null;
  if (!restoringSessions.has(key)) {
    const pending = loadPersistedSession(tabId, snapshotId).then((restored) => {
      if (restoringSessions.get(key) !== pending) return null;
      restoringSessions.delete(key);
      if (restored) pageTranslationSessions.set(key, restored);
      return restored;
    });
    restoringSessions.set(key, pending);
  }
  return restoringSessions.get(key);
}

// 失敗チャンクのみ再実行する。応答は受理時点で即返し、進捗は push で届ける
// （完了まで sendResponse を待たせると message channel がタイムアウトするため）。
async function continuePageTranslation(message, sender, sendResponse) {
  try {
    const tabId = await resolveTabIdFromSenderOrActive(sender);
    if (!tabId) return sendResponse && sendResponse({ ok: false, error: 'tab not found' });

    const { snapshotId } = message;
    let session = getPageTranslationSession(tabId, snapshotId);
    if (!session) {
      // service worker 再起動でメモリ上のセッションを失った場合、partial 完了時に
      // 退避した状態から復元して再試行を可能にする。
      session = await restoreForRetry(tabId, snapshotId);
      if (!session) {
        return sendResponse && sendResponse({ ok: false, error: 'session not found' });
      }
      void appendLog({
        level: 'info',
        type: 'page-translation',
        event: 'session_restored_from_storage',
        ...getProviderMeta(session.settings),
        tabId,
        snapshotId
      });
    }

    if (session.running) {
      return sendResponse && sendResponse({ ok: true, alreadyRunning: true });
    }

    const failedIndexes = getFailedChunkIndexes(session);
    if (session.canceled) return sendResponse({ ok: false, error: 'session canceled' });
    session.running = failedIndexes.length > 0;
    sendResponse && sendResponse({ ok: true, retryChunks: failedIndexes.length });
    if (failedIndexes.length === 0) {
      deletePageTranslationSession(tabId, snapshotId);
      await removePersistedSession(tabId, snapshotId);
      await notifyControls(session, 'completed').catch(() => {});
      return;
    }

    void appendLog({
      level: 'info',
      type: 'page-translation',
      event: 'retry',
      ...getProviderMeta(session.settings),
      tabId,
      snapshotId,
      retryChunks: failedIndexes.length
    });

    session.lastError = null;
    session.params.runtime = { structuredDisabled: false };
    await runSession(session, failedIndexes);
  } catch (e) {
    log.error('pageTranslation', 'continuePageTranslation エラー', e);
    sendResponse && sendResponse({ ok: false, error: e?.message || String(e) });
  }
}

async function cancelPageTranslation(message, sender, sendResponse) {
  try {
    const tabId = await resolveTabIdFromSenderOrActive(sender);
    if (!tabId) return sendResponse && sendResponse({ ok: false, error: 'tab not found' });

    const { snapshotId } = message;
    restoringSessions.delete(makeSessionKey(tabId, snapshotId));
    const session = getPageTranslationSession(tabId, snapshotId);
    if (session || ![...pageTranslationSessions.values()].some((s) => s.tabId === tabId)) startingTabs.delete(tabId);
    sendResponse && sendResponse({ ok: true });

    if (session) {
      session.canceled = true;
      try {
        session.abortController?.abort();
      } catch (_) {
        // no-op
      }
      deletePageTranslationSession(tabId, snapshotId);

      await appendLog({
        level: 'info',
        type: 'page-translation',
        event: 'canceled',
        ...getProviderMeta(session.settings),
        tabId,
        snapshotId
      });
    }

    // メモリ側セッションが SW 再起動で失われていたケースでも、退避済みセッションを残さない
    await removePersistedSession(tabId, snapshotId);

    await hideControls(tabId, snapshotId).catch(() => {});
  } catch (e) {
    log.error('pageTranslation', 'cancelPageTranslation エラー', e);
    sendResponse && sendResponse({ ok: false, error: e?.message || String(e) });
  }
}

async function getPageTranslationStatus(message, sender, sendResponse) {
  const tabId = sender?.tab?.id;
  if (!tabId) return sendResponse({ ok: false });
  let session = getPageTranslationSession(tabId, message.snapshotId);
  if (!session && startingTabs.has(tabId)) return sendResponse({ ok: true, starting: true });
  if (!session) session = await loadPersistedSession(tabId, message.snapshotId);
  if (!session) return sendResponse({ ok: false });
  const summary = summarizeSession(session);
  const status = session.running ? 'running'
    : summary.pendingChunks || summary.failedChunks ? 'partial' : 'completed';
  sendResponse({ ok: true, ...controlsState(session, status) });
}

const PAGE_TRANSLATION_RUNTIME_HANDLERS = {
  getPageTranslationStatus,
  continuePageTranslation,
  cancelPageTranslation
};

export function handlePageTranslationRuntimeMessage(message, sender, sendResponse) {
  const handler = PAGE_TRANSLATION_RUNTIME_HANDLERS[message?.action];
  if (!handler) return false;
  // 古いiframeからページ翻訳の操作を受け付けない。
  if (sender?.frameId !== undefined && sender.frameId !== 0) {
    sendResponse({ ok: false, error: 'top frame only' });
    return true;
  }
  let responded = false;
  const respond = (response) => {
    if (responded) return;
    responded = true;
    sendResponse(response);
  };
  handler(message, sender, respond).catch((error) => {
    respond({ ok: false, error: error?.message || String(error) });
  });
  return true;
}
