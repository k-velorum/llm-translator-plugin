import { formatUserError, shouldPauseTranslationQueue } from '../../shared/errors.js';
import { DEFAULT_SETTINGS } from '../settings.js';
import { appendLog, getProviderMeta } from '../logging.js';
import { sleepWithSignal, withTimeout } from '../../shared/async-utils.js';
import { clampInt, getTimeoutMsForPromptLen, translateChunk } from './translator.js';

// チャンクは snapshot 内で連続した item 範囲を持つため、開始オフセットを
// 事前計算しておくことで完了順序に依存せず独立に適用できる。
export function computeChunkOffsets(chunks) {
  const offsets = new Array(chunks.length);
  let offset = 0;
  for (let i = 0; i < chunks.length; i += 1) {
    offsets[i] = offset;
    offset += chunks[i].length;
  }
  return offsets;
}

export function summarizeSession(session) {
  let doneChunks = 0;
  let failedChunks = 0;
  let processedItems = 0;
  let failedItems = 0;

  for (const result of session.chunkResults) {
    if (!result || result.status === 'pending') continue;
    if (result.status === 'done') doneChunks += 1;
    else failedChunks += 1;
    processedItems += result.items;
    failedItems += result.failedItems;
  }

  return {
    doneChunks,
    failedChunks,
    processedItems,
    failedItems,
    pendingChunks: session.chunks.length - doneChunks - failedChunks
  };
}

export function getFailedChunkIndexes(session) {
  const indexes = [];
  for (let i = 0; i < session.chunkResults.length; i += 1) {
    if (session.chunkResults[i]?.status !== 'done') indexes.push(i);
  }
  return indexes;
}

// チャンク全体の時間予算 = 単発タイムアウトの2倍。フォールバック各段が
// それぞれフルタイムアウトを持つと最悪所要時間が際限なく伸びるため、
// 予算切れは失敗チャンク（後で再試行可能）として全体の進行を優先する。
const CHUNK_BUDGET_MULTIPLIER = 2;

function chunkLogMeta(session, idx, extra) {
  return {
    type: 'page-translation',
    ...getProviderMeta(session.settings),
    tabId: session.tabId,
    snapshotId: session.snapshotId,
    chunkIndex: idx,
    ...extra
  };
}

function mergeTranslatedParts(parts, indexes, translated) {
  indexes.forEach((index, i) => {
    const part = translated?.[i];
    parts[index] = typeof part === 'string' && part.trim() ? part : null;
  });
}

async function translateMissingParts(session, chunk, parts, timeoutMs) {
  const missing = chunk.map((_, i) => i).filter((i) => typeof parts[i] !== 'string');
  if (missing.length === 0) return { method: 'cached' };
  const budgetMs = timeoutMs * CHUNK_BUDGET_MULTIPLIER;
  const result = await withTimeout(
    (signal) => translateChunk(missing.map((i) => chunk[i]), session.settings, session.params, {
      timeoutMs,
      deadlineAt: Date.now() + budgetMs,
      signal
    }),
    budgetMs,
    session.abortController?.signal
  );
  mergeTranslatedParts(parts, missing, result.parts);
  return result;
}

// 1チャンクを翻訳して結果を session に記録し、成功分をページへ適用する。
// 翻訳失敗・適用失敗のどちらでも例外は外へ出さない（キャンセルのみ上位で判定）。
async function processChunk(session, idx, hooks) {
  const chunk = session.chunks[idx];
  const sep = session.params?.sep || DEFAULT_SETTINGS.pageTranslationSeparator;
  const promptLen = chunk.join(sep).length;
  const timeoutMs = getTimeoutMsForPromptLen(promptLen);
  const startedAt = Date.now();
  const parts = session.chunkResults[idx]?.parts?.slice() || new Array(chunk.length).fill(null);
  try {
    const result = await translateMissingParts(session, chunk, parts, timeoutMs);
    if (session.canceled) return;

    if (result.error) recordSessionError(session, result.error);
    const failedItems = parts.filter((part) => part === null).length;

    await withTimeout(() => hooks.applyChunk(idx, parts), 10000, session.abortController?.signal);
    if (session.canceled) return;
    session.chunkResults[idx] = {
      status: failedItems > 0 ? 'failed' : 'done',
      items: chunk.length,
      failedItems,
      parts
    };

    await appendLog({
      level: failedItems > 0 ? 'warn' : 'info',
      event: 'chunk_done',
      ...chunkLogMeta(session, idx, {
        method: result.method,
        ...(result.error ? { error: result.error, message: formatUserError(result.error) } : {}),
        items: chunk.length,
        failedItems,
        len: promptLen,
        ms: Date.now() - startedAt,
        timeoutMs
      })
    });
  } catch (e) {
    if (session.canceled || session.abortController?.signal.aborted) return;
    await recordChunkFailure(session, idx, e, { promptLen, timeoutMs, parts });
  }
}

function recordSessionError(session, error) {
  session.lastError = formatUserError(error);
  if (shouldPauseTranslationQueue(error)) session.queuePaused = true;
}

async function recordChunkFailure(session, idx, error, { promptLen, timeoutMs, parts }) {
  const chunk = session.chunks[idx];
  recordSessionError(session, error);
  session.chunkResults[idx] = {
    status: 'failed',
    items: chunk.length,
    failedItems: chunk.length,
    ...(parts ? { parts } : {})
  };

  await appendLog({
    level: 'error',
    event: 'chunk_failed',
    ...chunkLogMeta(session, idx, {
      items: chunk.length,
      len: promptLen,
      timeoutMs,
      message: session.lastError
    })
  });
}

// 指定チャンク群をワーカープールで連続処理する。チャンク失敗は記録して
// 続行する。API全体の利用障害では新規送信を止め、未処理分を再試行用に残す。
export async function runChunkQueue(session, chunkIndexes, hooks) {
  const queue = [...chunkIndexes];
  session.queuePaused = false;
  const concurrency = clampInt(
    session.params?.concurrency,
    1,
    20,
    DEFAULT_SETTINGS.pageTranslationConcurrency
  );
  const delayMs = typeof session.params?.delayMs === 'number'
    ? session.params.delayMs
    : DEFAULT_SETTINGS.pageTranslationDelayMs;
  const signal = session.abortController?.signal;

  // 再試行対象は集計上 pending に戻す
  for (const idx of queue) {
    session.chunkResults[idx] = { ...session.chunkResults[idx], status: 'pending' };
  }

  const worker = async () => {
    while (!session.canceled && !session.queuePaused) {
      const idx = queue.shift();
      if (idx === undefined) return;

      session.activeChunks = (session.activeChunks || 0) + 1;
      try {
        await processChunk(session, idx, hooks);
      } finally {
        session.activeChunks -= 1;
      }
      if (session.canceled) return;

      try {
        await hooks.notifyProgress();
      } catch (_) {
        // 進捗通知の失敗で翻訳は止めない
      }

      if (delayMs > 0 && queue.length > 0) {
        try {
          await sleepWithSignal(delayMs, signal);
        } catch (_) {
          return; // abort
        }
      }
    }
  };

  const workerCount = Math.max(1, Math.min(concurrency, queue.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
}
