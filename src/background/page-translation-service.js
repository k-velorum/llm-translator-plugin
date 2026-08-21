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
  abortSessionsForTab(tabId);
  await removePersistedSessionsForTab(tabId);
}

async function resolveTabIdFromSenderOrActive(sender) {
  return sender?.tab?.id || (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id;
}

// 進捗・状態は background から content へ一方向 push する。
// status: 'running' | 'completed' | 'partial' | 'canceled'
async function notifyControls(session, status) {
  const summary = summarizeSession(session);
  await chrome.tabs.sendMessage(session.tabId, {
    action: 'showPageTranslationControls',
    snapshotId: session.snapshotId,
    status,
    processedItems: summary.processedItems,
    totalItems: session.totalItems,
    failedItems: summary.failedItems,
    failedChunks: summary.failedChunks,
    remainingChunks: summary.pendingChunks,
    totalChunks: session.chunks.length
  });
}

async function hideControls(tabId, snapshotId) {
  await chrome.tabs.sendMessage(tabId, {
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
  await chrome.tabs.sendMessage(session.tabId, {
    action: 'applyPageTranslationChunk',
    snapshotId: session.snapshotId,
    offset: session.chunkOffsets[chunkIndex],
    translations: parts
  });
}

// 指定チャンク群を実行し、終了時の状態を content へ通知する共通経路。
// start / retry のどちらからも呼ばれる。
async function runSession(session, chunkIndexes) {
  session.running = true;
  updateKeepAlive();

  // 再試行直後もパネルを即「実行中」へ切り替える（以降はチャンク完了ごとに push）
  await notifyControls(session, 'running').catch(() => {});

  try {
    await runChunkQueue(session, chunkIndexes, {
      applyChunk: (idx, parts) => applyChunkToTab(session, idx, parts),
      notifyProgress: () => notifyControls(session, 'running')
    });
  } finally {
    session.running = false;
    updateKeepAlive();
  }

  if (session.canceled) return; // cancel ハンドラ側で後始末済み

  const summary = summarizeSession(session);
  const finished = summary.failedChunks === 0;

  if (finished) {
    deletePageTranslationSession(session.tabId, session.snapshotId);
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

  try {
    await notifyControls(session, finished ? 'completed' : 'partial');
  } catch (e) {
    log.warn('pageTranslation', '完了状態の通知に失敗しました', e);
  }
}

export async function startPageTranslation(tabId) {
  log.info('pageTranslation', 'ページ全体翻訳リクエストを受信');
  if (!tabId) return;

  try {
    // 旧スナップショット宛の退避セッションが残っていても新規実行では使わない
    await discardPageTranslationSessionsForTab(tabId);

    const response = await chrome.tabs.sendMessage(tabId, { action: 'getPageTexts' });
    const pageTexts = response?.texts || [];
    const snapshotId = response?.snapshotId;
    const settings = await loadSettings();
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

    await runSession(session, chunks.map((_, i) => i));
  } catch (error) {
    log.error('pageTranslation', 'ページ全体翻訳エラー', error);
    await appendLog({
      level: 'error',
      type: 'page-translation',
      event: 'fatal',
      ...getProviderMeta(await loadSettings().catch(() => ({}))),
      tabId,
      message: error?.message || String(error)
    });
  }
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
      session = await loadPersistedSession(tabId, snapshotId);
      if (!session) {
        return sendResponse && sendResponse({ ok: false, error: 'session not found' });
      }
      pageTranslationSessions.set(makeSessionKey(tabId, snapshotId), session);
      await appendLog({
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
    sendResponse && sendResponse({ ok: true, retryChunks: failedIndexes.length });
    if (failedIndexes.length === 0) {
      deletePageTranslationSession(tabId, snapshotId);
      await removePersistedSession(tabId, snapshotId);
      await notifyControls(session, 'completed').catch(() => {});
      return;
    }

    await appendLog({
      level: 'info',
      type: 'page-translation',
      event: 'retry',
      ...getProviderMeta(session.settings),
      tabId,
      snapshotId,
      retryChunks: failedIndexes.length
    });

    session.lastError = null;
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
    const session = getPageTranslationSession(tabId, snapshotId);
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

const PAGE_TRANSLATION_RUNTIME_HANDLERS = {
  continuePageTranslation,
  cancelPageTranslation
};

export function handlePageTranslationRuntimeMessage(message, sender, sendResponse) {
  const handler = PAGE_TRANSLATION_RUNTIME_HANDLERS[message?.action];
  if (!handler) return false;
  handler(message, sender, sendResponse);
  return true;
}
