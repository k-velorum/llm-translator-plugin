import { loadSettings, DEFAULT_SETTINGS } from './settings.js';
import { appendLog, getProviderMeta } from './logging.js';
import { log } from '../shared/logger.js';
import { chunkByEstimatedOutputAndItems } from './page-translation/chunking.js';
import { processPageTranslationPass } from './page-translation/processor.js';
import { buildSeparatorFallbackPrompt, clampInt } from './page-translation/translator.js';

const pageTranslationSessions = new Map(); // key: `${tabId}:${snapshotId}` -> session

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
      await processPageTranslationPass(session, session.params.chunksPerPass, {
        showControls,
        deleteSession: deletePageTranslationSession
      });
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

async function continuePageTranslation(message, sender, sendResponse) {
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
        session.params?.chunksPerPass || DEFAULT_SETTINGS.pageTranslationChunksPerPass,
        {
          showControls,
          deleteSession: deletePageTranslationSession
        }
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
}

async function cancelPageTranslation(message, sender, sendResponse) {
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
