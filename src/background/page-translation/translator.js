import {
  DEFAULT_PAGE_TRANSLATION_SEPARATOR_PROMPT,
  DEFAULT_SETTINGS,
  DEFAULT_TRANSLATION_SYSTEM_PROMPT
} from '../settings.js';
import { translateBatchStructured, translateText } from '../api.js';
import { appendLog, getProviderMeta } from '../logging.js';
import {
  PAGE_TRANSLATION_TIMEOUT_LONG_MS,
  PAGE_TRANSLATION_TIMEOUT_LONG_THRESHOLD_CHARS,
  PAGE_TRANSLATION_TIMEOUT_SHORT_MS
} from '../../shared/constants.js';
import { sleep } from '../../shared/async-utils.js';
import { log } from '../../shared/logger.js';
import { splitTextByNaturalBoundaries } from './chunking.js';

export function getTimeoutMsForPromptLen(len) {
  return len > PAGE_TRANSLATION_TIMEOUT_LONG_THRESHOLD_CHARS
    ? PAGE_TRANSLATION_TIMEOUT_LONG_MS
    : PAGE_TRANSLATION_TIMEOUT_SHORT_MS;
}

export function clampInt(value, min, max, fallback) {
  const n = parseInt(value, 10);
  if (Number.isFinite(n)) {
    if (typeof min === 'number' && n < min) return min;
    if (typeof max === 'number' && n > max) return max;
    return n;
  }
  return fallback;
}

export function buildSeparatorFallbackPrompt(settings) {
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

export async function translateJoinedOrSplit(chunk, settings, params, depth = 0, requestOptions = {}) {
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
