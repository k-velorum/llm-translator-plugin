export const DEFAULT_TRANSLATION_SYSTEM_PROMPT =
  '指示された文章を日本語に翻訳してください。翻訳結果のみを出力してください。';

// 移行対象は過去に拡張が追加した定型文だけ。ユーザー独自の指示は推測で削除しない。
export const LEGACY_SEPARATOR_INSTRUCTION =
  '特殊区切りトークン [[[SEP]]] が含まれる場合、それらは絶対に削除・翻訳・変更せず、そのまま出力に保持してください。トークンの数と順序も厳密に維持してください。';

export function normalizeTranslationPolicy(value, fallback = DEFAULT_TRANSLATION_SYSTEM_PROMPT) {
  if (typeof value !== 'string') return fallback;
  return value.split(LEGACY_SEPARATOR_INSTRUCTION).join('').trim() || fallback;
}

export function buildSeparatorInstruction(separator) {
  return `入力の各文章は区切り文字 ${JSON.stringify(separator)} で連結されています。訳文だけを同じ区切り文字で連結して返してください。区切り文字の数と順序を維持し、変更・省略しないでください。`;
}
