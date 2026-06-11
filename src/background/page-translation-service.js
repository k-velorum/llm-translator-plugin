import {
  loadSettings,
  DEFAULT_SETTINGS,
  DEFAULT_TRANSLATION_SYSTEM_PROMPT,
  DEFAULT_PAGE_TRANSLATION_SEPARATOR_PROMPT
} from './settings.js';
import { translateText, translateBatchStructured } from './api.js';
import { appendLog, getProviderMeta } from './logging.js';
import {
  PAGE_TRANSLATION_TIMEOUT_LONG_MS,
  PAGE_TRANSLATION_TIMEOUT_LONG_THRESHOLD_CHARS,
  PAGE_TRANSLATION_TIMEOUT_SHORT_MS
} from '../shared/constants.js';
import { sleep } from '../shared/async-utils.js';
import { log } from '../shared/logger.js';

const STRUCTURED_RESPONSE_BUDGET_MULTIPLIER = 2.2;
const STRUCTURED_ITEMS_MULTIPLIER = 4;
const STRUCTURED_MAX_ITEMS_CAP = 500;

const pageTranslationSessions = new Map(); // key: `${tabId}:${snapshotId}` -> session

function getTimeoutMsForPromptLen(len) {
  return len > PAGE_TRANSLATION_TIMEOUT_LONG_THRESHOLD_CHARS
    ? PAGE_TRANSLATION_TIMEOUT_LONG_MS
    : PAGE_TRANSLATION_TIMEOUT_SHORT_MS;
}

function clampInt(value, min, max, fallback) {
  const n = parseInt(value, 10);
  if (Number.isFinite(n)) {
    if (typeof min === 'number' && n < min) return min;
    if (typeof max === 'number' && n > max) return max;
    return n;
  }
  return fallback;
}

function buildSeparatorFallbackPrompt(settings) {
  const base = (
    settings?.translationSystemPrompt ||
    DEFAULT_TRANSLATION_SYSTEM_PROMPT ||
    DEFAULT_SETTINGS.translationSystemPrompt ||
    ''
  ).trim();
  const extra = (
    settings?.pageTranslationSeparatorPrompt ||
    DEFAULT_PAGE_TRANSLATION_SEPARATOR_PROMPT ||
    DEFAULT_SETTINGS.pageTranslationSeparatorPrompt ||
    ''
  ).trim();

  if (!base) return extra;
  if (!extra) return base;
  if (base.includes(extra)) return base;
  return `${base}\n${extra}`;
}

function estimateTranslatedLength(text) {
  const s = (typeof text === 'string' ? text : '').trim();
  if (!s.length) return 0;

  const len = s.length;
  const latin = (s.match(/[A-Za-z]/g) || []).length;
  const cjk = (s.match(/[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]/g) || []).length;
  let ratio = 1.08;
  if (latin / len > 0.45) ratio = 1.18;
  else if (cjk / len > 0.45) ratio = 1.02;

  return Math.ceil((len * ratio) + 16);
}

function splitTextByNaturalBoundaries(text, maxChars) {
  if (typeof text !== 'string' || text.length <= maxChars) return [text || ''];
  const out = [];
  const minPreferred = Math.max(1, Math.floor(maxChars * 0.6));

  const findBoundary = (src, start, end) => {
    const segment = src.slice(start, end);
    const patterns = [
      /[\.\!\?。！？]+\s*/g,
      /\n{2,}/g,
      /[,，;；:：、]\s*/g,
      /\s+/g
    ];

    for (const re of patterns) {
      re.lastIndex = 0;
      let best = -1;
      let m;
      while ((m = re.exec(segment)) !== null) {
        const pos = m.index + m[0].length;
        if (pos > best) best = pos;
      }
      if (best >= minPreferred) return start + best;
    }
    return -1;
  };

  let i = 0;
  while (i < text.length) {
    const end = Math.min(text.length, i + maxChars);
    if (end >= text.length) {
      out.push(text.slice(i));
      break;
    }

    const boundary = findBoundary(text, i, end);
    if (boundary > i) {
      out.push(text.slice(i, boundary));
      i = boundary;
      continue;
    }

    out.push(text.slice(i, end));
    i = end;
  }

  return out.filter((s) => s.length > 0);
}

function chunkByEstimatedOutputAndItems(items, maxChars, maxItems, sep, useStructuredOutput = false) {
  const chunks = [];
  let current = [];
  let currentInputLen = 0;
  let currentEstimatedOutputLen = 0;
  const sepLen = sep.length;
  const responseBudget = useStructuredOutput
    ? Math.max(2000, Math.floor(maxChars * STRUCTURED_RESPONSE_BUDGET_MULTIPLIER))
    : maxChars;
  const perItemOverhead = useStructuredOutput ? 32 : 0;
  // structured 出力は区切りトークン不要なので同梱数を増やしてリクエスト数を抑える
  const effectiveMaxItems = useStructuredOutput
    ? Math.min(STRUCTURED_MAX_ITEMS_CAP, maxItems * STRUCTURED_ITEMS_MULTIPLIER)
    : maxItems;

  for (const s of items) {
    const sLen = s.length;
    const estimatedOut = estimateTranslatedLength(s) + perItemOverhead;
    const projectedInput = currentInputLen + (current.length ? sepLen : 0) + sLen;
    const projectedEstimatedOutput = currentEstimatedOutputLen + estimatedOut;
    const wouldExceedInput = current.length > 0 && projectedInput > maxChars;
    const wouldExceedOutput = current.length > 0 && projectedEstimatedOutput > responseBudget;
    const wouldExceedItems = current.length >= effectiveMaxItems;

    if (current.length > 0 && (wouldExceedInput || wouldExceedOutput || wouldExceedItems)) {
      chunks.push(current);
      current = [s];
      currentInputLen = sLen;
      currentEstimatedOutputLen = estimatedOut;
    } else {
      current.push(s);
      currentInputLen = projectedInput;
      currentEstimatedOutputLen = projectedEstimatedOutput;
    }
  }

  if (current.length) chunks.push(current);
  return chunks;
}

async function translateJoinedOrSplit(chunk, settings, params, depth = 0, requestOptions = {}) {
  const sep = params?.sep || DEFAULT_SETTINGS.pageTranslationSeparator;
  const delayMs =
    typeof params?.delayMs === 'number' ? params.delayMs : DEFAULT_SETTINGS.pageTranslationDelayMs;
  const maxChars =
    typeof params?.maxChars === 'number' ? params.maxChars : DEFAULT_SETTINGS.pageTranslationMaxChars;
  const structuredDisabled = params?.runtime?.structuredDisabled === true;
  const useStructuredOutput = params?.useStructuredOutput !== false && !structuredDisabled;
  const separatorSystemPrompt = (params?.separatorSystemPrompt || '').trim();
  const separatorSettings = separatorSystemPrompt
    ? { ...settings, translationSystemPrompt: separatorSystemPrompt }
    : settings;

  if (depth === 0) {
    try {
      await appendLog({
        level: 'info',
        type: 'page-translation',
        event: 'chunk_start',
        ...getProviderMeta(settings),
        items: chunk.length,
        len: chunk.join(sep).length
      });
    } catch (_) {
      // no-op
    }
  }

  if (depth === 0 && chunk.length === 1 && typeof chunk[0] === 'string' && chunk[0].length > maxChars) {
    const s = chunk[0];

    await appendLog({
      level: 'warn',
      type: 'page-translation',
      event: 'oversized_single_node',
      ...getProviderMeta(settings),
      len: s.length,
      maxChars
    });

    const signal = requestOptions.signal;
    const translatePiece = async (piece) => {
      const timeoutMs = getTimeoutMsForPromptLen(piece.length);
      return translateText(piece, settings, { timeoutMs, signal });
    };

    const paragraphs = s.split(/\n{2,}/).filter((x) => x.trim().length);
    if (paragraphs.length > 1) {
      const out = [];
      for (const p of paragraphs) {
        const parts = splitTextByNaturalBoundaries(p, maxChars);
        const translatedParts = [];
        for (const part of parts) {
          translatedParts.push(await translatePiece(part));
          await sleep(delayMs);
        }
        out.push(translatedParts.join(''));
      }
      return [out.join('\n\n')];
    }

    const slices = splitTextByNaturalBoundaries(s, maxChars);

    const out = [];
    for (const part of slices) {
      out.push(await translatePiece(part));
      await sleep(delayMs);
    }
    return [out.join('')];
  }

  if (useStructuredOutput && depth === 0 && chunk.length > 1) {
    const structuredStartedAt = Date.now();
    try {
      const arr = await translateBatchStructured(chunk, settings, requestOptions);
      if (!Array.isArray(arr) || arr.length !== chunk.length) {
        throw new Error('構造化出力の件数が不一致です');
      }
      await appendLog({
        level: 'info',
        type: 'page-translation',
        event: 'chunk_translated',
        ...getProviderMeta(settings),
        method: 'structured',
        items: chunk.length,
        len: chunk.join(sep).length,
        ms: Date.now() - structuredStartedAt,
        timeoutMs: requestOptions.timeoutMs
      });
      return arr;
    } catch (e) {
      const shouldDisableForSession = !!(params && params.disableStructuredAfterFailure !== false);
      const structuredDisabledBefore = params?.runtime?.structuredDisabled === true;
      if (shouldDisableForSession) {
        if (params && !params.runtime) params.runtime = {};
        if (params?.runtime) params.runtime.structuredDisabled = true;
      }
      log.warn('pageTranslation', '構造化バッチ翻訳が失敗したため連結方式にフォールバックします', e);
      await appendLog({
        level: 'warn',
        type: 'page-translation',
        event: 'structured_batch_failed',
        ...getProviderMeta(settings),
        disableStructuredForSession: shouldDisableForSession,
        structuredDisabledBefore,
        structuredDisabledAfter: params?.runtime?.structuredDisabled === true,
        items: chunk.length,
        len: chunk.join(sep).length,
        message: e?.message || String(e)
      });
    }
  }

  const joined = chunk.join(sep);
  const startedAt = Date.now();
  const translated = await translateText(joined, separatorSettings, requestOptions);

  if (depth === 0) {
    await appendLog({
      level: 'info',
      type: 'page-translation',
      event: 'chunk_translated',
      ...getProviderMeta(settings),
      method: 'separator',
      items: chunk.length,
      len: joined.length,
      ms: Date.now() - startedAt,
      timeoutMs: requestOptions.timeoutMs
    });
  }

  const parts = translated.split(sep);
  if (parts.length === chunk.length) return parts;

  log.warn('pageTranslation', '区切り数不一致のためサブ分割を試行', {
    expected: chunk.length,
    actual: parts.length,
    depth
  });

  if (depth >= 3 || chunk.length <= 1) {
    const perItem = [];
    for (const s of chunk) {
      const t = await translateText(s, separatorSettings, requestOptions);
      perItem.push(t);
      await sleep(delayMs);
    }
    return perItem;
  }

  const mid = Math.floor(chunk.length / 2);
  const left = await translateJoinedOrSplit(chunk.slice(0, mid), settings, params, depth + 1, requestOptions);
  await sleep(delayMs);
  const right = await translateJoinedOrSplit(chunk.slice(mid), settings, params, depth + 1, requestOptions);
  return [...left, ...right];
}

function makeSessionKey(tabId, snapshotId) {
  return `${tabId}:${snapshotId}`;
}

function registerPageTranslationSession(session) {
  const key = makeSessionKey(session.tabId, session.snapshotId);
  pageTranslationSessions.set(key, session);
}

function getPageTranslationSession(tabId, snapshotId) {
  return pageTranslationSessions.get(makeSessionKey(tabId, snapshotId));
}

function deletePageTranslationSession(tabId, snapshotId) {
  pageTranslationSessions.delete(makeSessionKey(tabId, snapshotId));
}

async function processPageTranslationPass(session, chunksPerPass) {
  const { tabId, snapshotId, settings, chunks } = session;
  const delayMs = typeof session.params?.delayMs === 'number'
    ? session.params.delayMs
    : DEFAULT_SETTINGS.pageTranslationDelayMs;
  const concurrency = clampInt(session.params?.concurrency, 1, 20, DEFAULT_SETTINGS.pageTranslationConcurrency);
  const sep = session.params?.sep || DEFAULT_SETTINGS.pageTranslationSeparator;

  let processed = 0;

  while (!session.canceled && session.nextIndex < chunks.length && processed < chunksPerPass) {
    const remainingThisPass = chunksPerPass - processed;
    const batchCount = Math.min(concurrency, remainingThisPass, chunks.length - session.nextIndex);

    const batch = [];
    let baseOffset = session.offset;
    for (let i = 0; i < batchCount; i++) {
      const idx = session.nextIndex + i;
      const chunk = chunks[idx];
      batch.push({ idx, chunk, offset: baseOffset });
      baseOffset += chunk.length;
    }

    const signal = session.abortController?.signal;

    const results = await Promise.all(
      batch.map(async (b) => {
        const promptLen = b.chunk.join(sep).length;
        const timeoutMs = getTimeoutMsForPromptLen(promptLen);
        try {
          const parts = await translateJoinedOrSplit(
            b.chunk,
            settings,
            session.params,
            0,
            { timeoutMs, signal }
          );
          return { ...b, ok: true, parts, timeoutMs, promptLen };
        } catch (e) {
          return { ...b, ok: false, error: e, timeoutMs, promptLen };
        }
      })
    );

    for (const r of results) {
      if (session.canceled) break;

      if (!r.ok) {
        if (session.canceled || r.error?.name === 'AbortError') return;

        const msg = r.error?.message || String(r.error);
        session.lastError = msg;
        session.failedAt = r.idx;

        await appendLog({
          level: 'error',
          type: 'page-translation',
          event: 'chunk_failed',
          ...getProviderMeta(settings),
          tabId,
          snapshotId,
          chunkIndex: r.idx,
          offset: r.offset,
          items: r.chunk.length,
          len: r.promptLen,
          timeoutMs: r.timeoutMs,
          message: msg
        });

        return;
      }

      try {
        await chrome.tabs.sendMessage(tabId, {
          action: 'applyPageTranslationChunk',
          snapshotId,
          offset: r.offset,
          translations: r.parts
        });
      } catch (e) {
        log.warn('pageTranslation', 'applyPageTranslationChunk 送信に失敗しました', e);
      }

      session.offset += r.chunk.length;
      session.nextIndex += 1;
      processed += 1;

      try {
        await showControls(tabId, snapshotId, {
          remainingChunks: chunks.length - session.nextIndex,
          processedItems: session.offset,
          totalItems: session.totalItems,
          totalChunks: chunks.length,
          canContinue: false
        });
      } catch (_) {
        // no-op
      }

      await appendLog({
        level: 'info',
        type: 'page-translation',
        event: 'chunk_applied',
        ...getProviderMeta(settings),
        tabId,
        snapshotId,
        chunkIndex: r.idx,
        processedItems: session.offset,
        totalItems: session.totalItems,
        timeoutMs: r.timeoutMs
      });

      if (delayMs > 0) await sleep(delayMs);
    }
  }

  if (!session.canceled && session.nextIndex >= chunks.length) {
    deletePageTranslationSession(tabId, snapshotId);
    await appendLog({
      level: 'info',
      type: 'page-translation',
      event: 'complete',
      ...getProviderMeta(settings),
      tabId,
      snapshotId,
      totalItems: session.totalItems,
      totalChunks: chunks.length
    });
  }
}

async function resolveTabIdFromSenderOrActive(sender) {
  return sender?.tab?.id || (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id;
}

async function showControls(tabId, snapshotId, state) {
  await chrome.tabs.sendMessage(tabId, {
    action: 'showPageTranslationControls',
    snapshotId,
    ...state
  });
}

async function hideControls(tabId, snapshotId) {
  await chrome.tabs.sendMessage(tabId, {
    action: 'hidePageTranslationControls',
    snapshotId
  });
}

async function logPassFailed(session, tabId, snapshotId, error) {
  const msg = error?.message || String(error);
  session.lastError = msg;
  await appendLog({
    level: 'error',
    type: 'page-translation',
    event: 'pass_failed',
    ...getProviderMeta(session.settings),
    tabId,
    snapshotId,
    message: msg
  });
}

async function logStoppedWithError(session, tabId, snapshotId) {
  if (!session.lastError) return;

  await appendLog({
    level: 'warn',
    type: 'page-translation',
    event: 'stopped_with_error',
    ...getProviderMeta(session.settings),
    tabId,
    snapshotId,
    message: session.lastError
  });
}

export async function startPageTranslation(tabId) {
  log.info('pageTranslation', 'ページ全体翻訳リクエストを受信');
  try {
    const response = await chrome.tabs.sendMessage(tabId, { action: 'getPageTexts' });
    const pageTexts = response.texts || [];
    const snapshotId = response.snapshotId;
    const settings = await loadSettings();

    const sep = (settings.pageTranslationSeparator || DEFAULT_SETTINGS.pageTranslationSeparator).toString();
    const separatorSystemPrompt = buildSeparatorFallbackPrompt(settings);
    const maxChars = clampInt(
      settings.pageTranslationMaxChars,
      500,
      32000,
      DEFAULT_SETTINGS.pageTranslationMaxChars
    );
    const maxItems = clampInt(
      settings.pageTranslationMaxItemsPerChunk,
      5,
      500,
      DEFAULT_SETTINGS.pageTranslationMaxItemsPerChunk
    );
    const chunksPerPass = clampInt(
      settings.pageTranslationChunksPerPass,
      1,
      100,
      DEFAULT_SETTINGS.pageTranslationChunksPerPass
    );
    const delayMs = clampInt(
      settings.pageTranslationDelayMs,
      0,
      60000,
      DEFAULT_SETTINGS.pageTranslationDelayMs
    );
    const concurrency = clampInt(
      settings.pageTranslationConcurrency,
      1,
      20,
      DEFAULT_SETTINGS.pageTranslationConcurrency
    );
    const useStructuredOutput = settings.pageTranslationUseStructuredOutput !== false;

    const chunks = chunkByEstimatedOutputAndItems(pageTexts, maxChars, maxItems, sep, useStructuredOutput);

    const totalItems = pageTexts.length;
    const session = {
      tabId,
      snapshotId,
      settings,
      chunks,
      nextIndex: 0,
      offset: 0,
      totalItems,
      canceled: false,
      lastError: null,
      failedAt: null,
      abortController: new AbortController(),
      params: {
        sep,
        separatorSystemPrompt,
        maxChars,
        maxItemsPerChunk: maxItems,
        chunksPerPass,
        delayMs,
        concurrency,
        useStructuredOutput,
        disableStructuredAfterFailure: true,
        runtime: { structuredDisabled: false }
      }
    };

    registerPageTranslationSession(session);

    await appendLog({
      level: 'info',
      type: 'page-translation',
      event: 'start',
      ...getProviderMeta(settings),
      tabId,
      snapshotId,
      totalItems: session.totalItems,
      totalChunks: session.chunks.length,
      params: { maxChars, maxItemsPerChunk: maxItems, chunksPerPass, delayMs, concurrency, useStructuredOutput }
    });

    try {
      await showControls(tabId, snapshotId, {
        remainingChunks: session.chunks.length,
        processedItems: 0,
        totalItems: session.totalItems,
        totalChunks: session.chunks.length,
        canContinue: false
      });
    } catch (e) {
      log.warn('pageTranslation', '初期コントロール表示に失敗', e);
    }

    try {
      await processPageTranslationPass(session, session.params.chunksPerPass);
    } catch (e) {
      await logPassFailed(session, tabId, snapshotId, e);
    }

    if (!session.canceled && session.nextIndex < session.chunks.length) {
      await showControls(tabId, snapshotId, {
        remainingChunks: session.chunks.length - session.nextIndex,
        processedItems: session.offset,
        totalItems: session.totalItems,
        totalChunks: session.chunks.length,
        canContinue: true
      });
    } else {
      await hideControls(tabId, snapshotId);
    }

    await logStoppedWithError(session, tabId, snapshotId);
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

export function handlePageTranslationRuntimeMessage(message, sender, sendResponse) {
  if (message && message.action === 'continuePageTranslation') {
    (async () => {
      try {
        const tabId = await resolveTabIdFromSenderOrActive(sender);
        if (!tabId) return sendResponse && sendResponse({ ok: false, error: 'tab not found' });

        const { snapshotId } = message;
        const session = getPageTranslationSession(tabId, snapshotId);
        if (!session) return sendResponse && sendResponse({ ok: false, error: 'session not found' });

        try {
          await showControls(tabId, snapshotId, {
            remainingChunks: session.chunks.length - session.nextIndex,
            processedItems: session.offset,
            totalItems: session.totalItems,
            totalChunks: session.chunks.length,
            canContinue: false
          });
        } catch (_) {
          // no-op
        }

        try {
          await processPageTranslationPass(
            session,
            session.params?.chunksPerPass || DEFAULT_SETTINGS.pageTranslationChunksPerPass
          );
        } catch (e) {
          await logPassFailed(session, tabId, snapshotId, e);
        }

        if (!session.canceled && session.nextIndex < session.chunks.length) {
          await showControls(tabId, snapshotId, {
            remainingChunks: session.chunks.length - session.nextIndex,
            processedItems: session.offset,
            totalItems: session.totalItems,
            totalChunks: session.chunks.length,
            canContinue: true
          });
        } else {
          await hideControls(tabId, snapshotId);
        }

        await logStoppedWithError(session, tabId, snapshotId);

        sendResponse && sendResponse({ ok: true });
      } catch (e) {
        log.error('pageTranslation', 'continuePageTranslation エラー', e);
        sendResponse && sendResponse({ ok: false, error: e?.message || String(e) });
      }
    })();
    return true;
  }

  if (message && message.action === 'cancelPageTranslation') {
    (async () => {
      try {
        const tabId = await resolveTabIdFromSenderOrActive(sender);
        if (!tabId) return sendResponse && sendResponse({ ok: false, error: 'tab not found' });

        const { snapshotId } = message;
        const session = getPageTranslationSession(tabId, snapshotId);
        if (!session) return sendResponse && sendResponse({ ok: true });

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

        await hideControls(tabId, snapshotId);
        sendResponse && sendResponse({ ok: true });
      } catch (e) {
        log.error('pageTranslation', 'cancelPageTranslation エラー', e);
        sendResponse && sendResponse({ ok: false, error: e?.message || String(e) });
      }
    })();
    return true;
  }

  return false;
}
