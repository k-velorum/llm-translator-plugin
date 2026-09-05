import { normalizeError, shouldPauseTranslationQueue } from '../../shared/errors.js';
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
import { createAbortError, sleepWithSignal, withTimeout } from '../../shared/async-utils.js';
import { log } from '../../shared/logger.js';
import { splitTextByNaturalBoundaries } from './chunking.js';

// 分割フォールバックの再帰上限。これを超えたら per-item 翻訳へ落とす。
const SPLIT_FALLBACK_MAX_DEPTH = 2;

// 時間予算の残りがこれ以下なら新規リクエストを発行しない（往復遅延の余裕分）
const BUDGET_SAFETY_MARGIN_MS = 2000;

function remainingBudgetMs(requestOptions) {
  const deadlineAt = requestOptions?.deadlineAt;
  if (!Number.isFinite(deadlineAt)) return Infinity;
  return deadlineAt - Date.now();
}

function isBudgetExhausted(requestOptions) {
  return remainingBudgetMs(requestOptions) <= BUDGET_SAFETY_MARGIN_MS;
}

// 各フォールバック段のタイムアウトを「残り予算」に丸める。これがないと
// structured → セパレータ → 分割 → per-item の各段が毎回フルタイムアウトを
// 持ち、1チャンクの最悪所要時間が際限なく伸びる（フリーズに見える原因）。
function stepRequestOptions(requestOptions, stepTimeoutMs) {
  const remaining = remainingBudgetMs(requestOptions);
  const timeoutMs = Number.isFinite(remaining)
    ? Math.max(0, Math.min(stepTimeoutMs, remaining))
    : stepTimeoutMs;
  return { ...requestOptions, timeoutMs };
}

function requestTranslation(operation, text, settings, options) {
  // provider 内部のフォーマット切替・HTTP再試行も一つの期限に含める。
  return withTimeout(
    (signal) => operation(text, settings, { ...options, signal }),
    options.timeoutMs,
    options.signal
  );
}

function normalizeParts(parts, chunk) {
  return chunk.map((source, i) => {
    const translated = parts?.[i];
    if (typeof translated !== 'string' || !translated.trim()) return null;
    return source.match(/^\s*/)[0] + translated.trim() + source.match(/\s*$/)[0];
  });
}

function allItemsFailed(chunk, method) {
  return { parts: new Array(chunk.length).fill(null), method, failedItems: chunk.length };
}

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

function isAbortError(error) {
  return error?.name === 'AbortError';
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw createAbortError();
}

function resolveChunkParams(settings, params) {
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

  return { sep, delayMs, maxChars, useStructuredOutput, separatorSettings };
}

// 1チャンクを翻訳する。失敗した item は parts に null を入れて返し（原文維持）、
// 例外はキャンセルだけ伝播する。API全体の利用障害は error を返してキューを
// 停止可能にし、通常のモデル出力失敗では残りのチャンクを続行する。
// 戻り値: { parts: (string|null)[], method, failedItems, error? }
export async function translateChunk(chunk, settings, params, requestOptions = {}) {
  throwIfAborted(requestOptions.signal);
  const result = await translateChunkContents(chunk, settings, params, requestOptions);
  const parts = normalizeParts(result.parts, chunk);
  return { ...result, parts, failedItems: parts.filter((part) => part === null).length };
}

async function translateChunkContents(chunk, settings, params, requestOptions) {
  const resolved = resolveChunkParams(settings, params);
  const signal = requestOptions.signal;

  if (
    chunk.length === 1 &&
    typeof chunk[0] === 'string' &&
    chunk[0].length > resolved.maxChars
  ) {
    return translateOversizedSingle(chunk[0], settings, resolved, requestOptions);
  }

  if (resolved.useStructuredOutput && chunk.length > 1 && !isBudgetExhausted(requestOptions)) {
    const result = await tryStructured(chunk, settings, params, resolved, requestOptions);
    if (result) return result;
    throwIfAborted(signal);
  }

  return translateBySeparatorOrSplit(chunk, settings, resolved, requestOptions, 0);
}

async function tryStructured(chunk, settings, params, resolved, requestOptions) {
  const startedAt = Date.now();
  const stepTimeoutMs = requestOptions.timeoutMs ?? getTimeoutMsForPromptLen(chunk.join(resolved.sep).length);
  try {
    const arr = await requestTranslation(
      translateBatchStructured,
      chunk,
      settings,
      stepRequestOptions(requestOptions, stepTimeoutMs)
    );
    if (!Array.isArray(arr) || arr.length !== chunk.length) {
      throw new Error('構造化出力の件数が不一致です');
    }
    return { parts: arr, method: 'structured' };
  } catch (e) {
    if (isAbortError(e)) throw e;
    if (shouldPauseTranslationQueue(e)) return { ...allItemsFailed(chunk, 'api-error'), error: normalizeError(e) };
    // 通信のタイムアウトにフォーマット変更は効かない。次のチャンクへ進む。
    if (e?.name === 'TimeoutError') return allItemsFailed(chunk, 'timeout');

    // 構造化出力に一度失敗した provider/model は以降も失敗する可能性が高いため、
    // セッション単位で無効化して無駄な API 呼び出しを抑える。
    const shouldDisable = !!(params && params.disableStructuredAfterFailure !== false);
    if (shouldDisable) {
      params.runtime ||= {};
      params.runtime.structuredDisabled = true;
    }
    log.warn('pageTranslation', '構造化バッチ翻訳が失敗したためセパレータ方式にフォールバックします', e);
    await appendLog({
      level: 'warn',
      type: 'page-translation',
      event: 'structured_batch_failed',
      ...getProviderMeta(settings),
      disableStructuredForSession: shouldDisable,
      items: chunk.length,
      len: chunk.join(resolved.sep).length,
      ms: Date.now() - startedAt,
      message: e?.message || String(e)
    });
    return null;
  }
}

// セパレータ連結方式で翻訳し、区切り数が合わなければ二分割で再試行、
// 上限を超えたら per-item 翻訳に落とす。
async function translateBySeparatorOrSplit(chunk, settings, resolved, requestOptions, depth) {
  const signal = requestOptions.signal;
  throwIfAborted(signal);

  if (isBudgetExhausted(requestOptions)) {
    log.warn('pageTranslation', 'チャンクの時間予算を使い切ったため残りを失敗扱いにします', {
      items: chunk.length,
      depth
    });
    return allItemsFailed(chunk, 'budget-exhausted');
  }

  if (chunk.length === 1) {
    return translatePerItem(chunk, resolved, requestOptions);
  }

  const joined = chunk.join(resolved.sep);
  try {
    const translated = await requestTranslation(
      translateText,
      joined,
      resolved.separatorSettings,
      stepRequestOptions(requestOptions, getTimeoutMsForPromptLen(joined.length))
    );
    const parts = translated.split(resolved.sep);
    if (parts.length === chunk.length) {
      return { parts, method: 'separator', failedItems: 0 };
    }
    log.warn('pageTranslation', '区切り数不一致のためサブ分割を試行', {
      expected: chunk.length,
      actual: parts.length,
      depth
    });
  } catch (e) {
    if (isAbortError(e)) throw e;
    if (shouldPauseTranslationQueue(e)) return { ...allItemsFailed(chunk, 'api-error'), error: normalizeError(e) };
    if (e?.name === 'TimeoutError') return allItemsFailed(chunk, 'timeout');
    log.warn('pageTranslation', 'セパレータ方式の翻訳に失敗したためサブ分割を試行', {
      depth,
      message: e?.message || String(e)
    });
  }

  if (depth >= SPLIT_FALLBACK_MAX_DEPTH) {
    return translatePerItem(chunk, resolved, requestOptions);
  }

  if (resolved.delayMs > 0) await sleepWithSignal(resolved.delayMs, signal);

  const mid = Math.floor(chunk.length / 2);
  const left = await translateBySeparatorOrSplit(chunk.slice(0, mid), settings, resolved, requestOptions, depth + 1);
  if (left.error) return { ...left, parts: [...left.parts, ...new Array(chunk.length - mid).fill(null)] };
  if (resolved.delayMs > 0) await sleepWithSignal(resolved.delayMs, signal);
  const right = await translateBySeparatorOrSplit(chunk.slice(mid), settings, resolved, requestOptions, depth + 1);

  return {
    parts: [...left.parts, ...right.parts],
    method: 'split',
    ...(right.error ? { error: right.error } : {}),
    failedItems: left.failedItems + right.failedItems
  };
}

// 最終フォールバック: item 単位で翻訳し、失敗 item は null（原文維持）。
async function translatePerItem(chunk, resolved, requestOptions) {
  const signal = requestOptions.signal;
  const parts = new Array(chunk.length).fill(null);
  let failedItems = 0;

  for (let i = 0; i < chunk.length; i += 1) {
    throwIfAborted(signal);
    if (isBudgetExhausted(requestOptions)) {
      failedItems += chunk.length - i;
      log.warn('pageTranslation', '時間予算切れのため残り item を失敗扱いにします', {
        remaining: chunk.length - i
      });
      break;
    }
    const text = chunk[i];
    try {
      parts[i] = await requestTranslation(
        translateText,
        text,
        resolved.separatorSettings,
        stepRequestOptions(requestOptions, getTimeoutMsForPromptLen(text.length))
      );
    } catch (e) {
      if (isAbortError(e)) throw e;
      if (shouldPauseTranslationQueue(e)) return { parts, method: 'api-error', error: normalizeError(e) };
      failedItems += 1;
      log.warn('pageTranslation', 'item 単位翻訳に失敗しました（原文を維持）', {
        index: i,
        len: text.length,
        message: e?.message || String(e)
      });
    }
    if (resolved.delayMs > 0 && i < chunk.length - 1) {
      await sleepWithSignal(resolved.delayMs, signal);
    }
  }

  return { parts, method: 'per-item', failedItems };
}

// 単一の巨大テキストノードは自然な境界で分割して順に翻訳する。
// 一部の断片が失敗した場合は item 全体を失敗（原文維持）として扱い、
// 原文と訳文が混在することを防ぐ。
async function translateOversizedSingle(text, settings, resolved, requestOptions) {
  const signal = requestOptions.signal;

  await appendLog({
    level: 'warn',
    type: 'page-translation',
    event: 'oversized_single_node',
    ...getProviderMeta(settings),
    len: text.length,
    maxChars: resolved.maxChars
  });

  const pieces = splitTextByNaturalBoundaries(text, resolved.maxChars);
  const translatedPieces = [];

  for (let i = 0; i < pieces.length; i += 1) {
    throwIfAborted(signal);
    if (isBudgetExhausted(requestOptions)) {
      log.warn('pageTranslation', '時間予算切れのため巨大ノードを失敗扱いにします（原文を維持）', {
        translatedPieces: i,
        totalPieces: pieces.length
      });
      return { parts: [null], method: 'oversized', failedItems: 1 };
    }
    try {
      const translated = await requestTranslation(
        translateText,
        pieces[i],
        settings,
        stepRequestOptions(requestOptions, getTimeoutMsForPromptLen(pieces[i].length))
      );
      const part = normalizeParts([translated], [pieces[i]])[0];
      if (part === null) return allItemsFailed([text], 'oversized');
      translatedPieces.push(part);
    } catch (e) {
      if (isAbortError(e)) throw e;
      if (shouldPauseTranslationQueue(e)) return { ...allItemsFailed([text], 'api-error'), error: normalizeError(e) };
      log.warn('pageTranslation', '巨大ノード断片の翻訳に失敗しました（原文を維持）', {
        piece: i,
        message: e?.message || String(e)
      });
      return { parts: [null], method: 'oversized', failedItems: 1 };
    }
    if (resolved.delayMs > 0 && i < pieces.length - 1) {
      await sleepWithSignal(resolved.delayMs, signal);
    }
  }

  return { parts: [translatedPieces.join('')], method: 'oversized', failedItems: 0 };
}
