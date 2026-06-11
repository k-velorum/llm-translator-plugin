import { DEFAULT_SETTINGS } from '../settings.js';

// 設定のカスタムプロンプトが空の場合は既定値へ戻す。
export function getSystemPrompt(settings) {
  const value = (settings && settings.translationSystemPrompt) || DEFAULT_SETTINGS.translationSystemPrompt;
  return (typeof value === 'string' && value.trim().length)
    ? value
    : DEFAULT_SETTINGS.translationSystemPrompt;
}
