import { log } from './logger.js';

import { DEFAULT_TRANSLATION_SYSTEM_PROMPT, normalizeTranslationPolicy } from './translation-policy.js';

const DEFAULT_BATCH_POLICY =
  '指示された文章を日本語に翻訳してください。翻訳結果のみを返してください。';

export const STRUCTURED_BATCH_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    items: {
      type: 'array',
      items: {
        // 位置別のスキーマに依存せず、[id, 訳文] の順序と長さは受信時に検証する。
        type: 'array',
        items: { anyOf: [{ type: 'integer' }, { type: 'string' }] }
      }
    }
  },
  required: ['items']
};

export function buildStructuredBatchItems(texts) {
  return texts.map((text, id) => ({ id, text }));
}

export function buildStructuredBatchInstruction(settings, options = {}) {
  const defaultPrompt = options.defaultPrompt || DEFAULT_TRANSLATION_SYSTEM_PROMPT;
  const fallbackPolicy = options.fallbackPolicy || DEFAULT_BATCH_POLICY;
  const customPrompt = normalizeTranslationPolicy(settings?.translationSystemPrompt, defaultPrompt);
  const policy = customPrompt && customPrompt !== defaultPrompt ? customPrompt : fallbackPolicy;

  return [
    'あなたは優秀な翻訳者です。与えられた JSON 配列 items の各要素を日本語に翻訳してください。',
    '出力は JSON のみで、形式 {"items":[[0,"訳文"],[1,"訳文"]]} にしてください。各要素は必ず [入力のid, 訳文の文字列] の2要素配列です。原文やキー名は各要素に出力しないでください。',
    '重要: 入力の id をそのまま維持し、items の件数は入力と同じにします。不要な説明文は一切出力しないでください。',
    'HTMLタグやコードブロックなどのマークアップは保持し、意味を変えないように訳してください。',
    `翻訳方針: ${policy}`
  ].join('\n');
}

export function parseJsonLoose(s) {
  if (typeof s !== 'string') return null;
  const input = s.trim();
  if (!input) return null;

  const tried = new Set();
  const tryCandidate = (candidate) => {
    const c = (candidate || '').trim();
    if (!c || tried.has(c)) return null;
    tried.add(c);
    try {
      return JSON.parse(c);
    } catch (_) {}
    return null;
  };

  const direct = tryCandidate(input);
  if (direct !== null) return direct;

  for (const m of input.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) {
    const parsed = tryCandidate(m[1] || '');
    if (parsed !== null) return parsed;
  }

  const objStart = input.indexOf('{');
  const arrStart = input.indexOf('[');
  const preferArray = arrStart >= 0 && (objStart < 0 || arrStart < objStart);

  const trySliceByBounds = (openChar, closeChar) => {
    const start = input.indexOf(openChar);
    const end = input.lastIndexOf(closeChar);
    if (start >= 0 && end > start) {
      const parsed = tryCandidate(input.slice(start, end + 1));
      if (parsed !== null) return parsed;
    }
    return null;
  };

  if (preferArray) {
    const parsedArray = trySliceByBounds('[', ']');
    if (parsedArray !== null) return parsedArray;
    const parsedObj = trySliceByBounds('{', '}');
    if (parsedObj !== null) return parsedObj;
  } else {
    const parsedObj = trySliceByBounds('{', '}');
    if (parsedObj !== null) return parsedObj;
    const parsedArray = trySliceByBounds('[', ']');
    if (parsedArray !== null) return parsedArray;
  }

  return null;
}

export function normalizeStructuredBatchResult(parsed, texts, options = {}) {
  const messages = {
    missingItems: '構造化出力に配列(items)が見つかりません',
    noValidIds: '構造化出力の id が有効に取得できませんでした',
    tooManyMissingIds: (missing, total) =>
      `構造化出力の id 欠落率が高すぎます (${missing}/${total})`,
    missingIdsWarning: (missing, ratio) =>
      `構造化出力の id が不足しています。未翻訳として残します: [${missing.join(',')}] ratio=${ratio.toFixed(2)}`,
    ...options.messages
  };
  const warnOnMissingIds = options.warnOnMissingIds !== false;

  const arr = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.items) ? parsed.items : null;
  if (!arr) {
    throw new Error(messages.missingItems);
  }

  const out = new Array(texts.length).fill(null);
  const seen = new Set();

  for (const item of arr) {
    // JSONモード等でモデルが旧形式を返しても、再生成せず既存のID検証で扱う。
    if (Array.isArray(item) && item.length !== 2) continue;
    const id = Array.isArray(item) ? item[0] : item?.id;
    const translation = Array.isArray(item) ? item[1] : item?.translation;
    if (!Number.isInteger(id) || id < 0 || id >= out.length || typeof translation !== 'string' || !translation.trim()) continue;
    if (seen.has(id)) continue;
    out[id] = translation.trim();
    seen.add(id);
  }

  if (seen.size === 0) {
    throw new Error(messages.noValidIds);
  }

  if (seen.size < texts.length) {
    const missing = [];
    for (let i = 0; i < texts.length; i += 1) {
      if (!seen.has(i)) {
        out[i] = null;
        missing.push(i);
      }
    }
    const missingRatio = missing.length / texts.length;
    if (missingRatio >= 0.5) {
      throw new Error(messages.tooManyMissingIds(missing.length, texts.length));
    }
    if (warnOnMissingIds) {
      log.warn('structuredBatch', messages.missingIdsWarning(missing, missingRatio));
    }
  }

  return out;
}
