import { normalizeTranslationPolicy } from '../../shared/translation-policy.js';

// 保存前の設定や再開セッションでも、既知の旧形式指示を翻訳方針に混ぜない。
export function getSystemPrompt(settings) {
  return normalizeTranslationPolicy(settings?.translationSystemPrompt);
}
