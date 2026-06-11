import { DEFAULT_SETTINGS } from '../settings.js';
import { appendLog, getProviderMeta } from '../logging.js';
import { sleep } from '../../shared/async-utils.js';
import { log } from '../../shared/logger.js';
import { clampInt, getTimeoutMsForPromptLen, translateJoinedOrSplit } from './translator.js';

export async function processPageTranslationPass(session, chunksPerPass, { showControls, deleteSession }) {
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
    deleteSession(tabId, snapshotId);
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
