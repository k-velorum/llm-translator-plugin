import { normalizeConnectionSettings } from '../shared/connections.js';
import { DEFAULT_TRANSLATION_SYSTEM_PROMPT, normalizeTranslationPolicy } from '../shared/translation-policy.js';
export { DEFAULT_TRANSLATION_SYSTEM_PROMPT } from '../shared/translation-policy.js';

// 共有デフォルト設定（全コンポーネントの単一ソース）
export const DEFAULT_SETTINGS = {
  apiProvider: 'openai',
  openaiPreset: 'openrouter',
  geminiApiKey: '',
  geminiModel: 'gemini-flash-2.0',
  translationSystemPrompt: DEFAULT_TRANSLATION_SYSTEM_PROMPT,
  chromePromptTemperature: 0.2,
  // プラットフォーム別 機能有効/無効
  enableTwitterTranslation: true,
  enableYoutubeTranslation: true,
  selectionTranslationMode: 'popup',
  // ページ全体翻訳 詳細設定（UIで変更可能）
  pageTranslationSeparator: '[[[SEP]]]',
  pageTranslationMaxChars: 3500,
  pageTranslationMaxItemsPerChunk: 50,
  // 旧パス方式の互換用に残置（連続実行方式へ移行したため現在は未使用）
  pageTranslationChunksPerPass: 6,
  pageTranslationDelayMs: 400,
  // ページ全体翻訳: 同時リクエスト数（並列）
  pageTranslationConcurrency: 4,
  // ページ全体翻訳: 構造化出力を優先利用（失敗時はセパレータ方式へフォールバック）
  pageTranslationUseStructuredOutput: true,
};

// 保存済み接続は可変キーを含むため、全体を読み込んでから既定値を補う。
export function loadSettings() {
  return new Promise((resolve, reject) => {
    chrome.storage.sync.get(null, (stored) => {
      if (chrome.runtime?.lastError) return reject(new Error(chrome.runtime.lastError.message));
      const settings = { ...DEFAULT_SETTINGS, ...stored };
      const translationSystemPrompt = normalizeTranslationPolicy(settings.translationSystemPrompt);
      if (translationSystemPrompt !== settings.translationSystemPrompt) {
        chrome.storage.sync.set({ translationSystemPrompt });
      }
      resolve(normalizeConnectionSettings({ ...settings, translationSystemPrompt }));
    });
  });
}

// デフォルト設定の初期化 (onInstalled イベントリスナー内で使用)
export function initializeDefaultSettings() {
  // 既存の設定を尊重しつつ、未設定の項目にデフォルト値を設定する
  chrome.storage.sync.get(null, (existingSettings) => {
     const mergedSettings = normalizeConnectionSettings({ ...DEFAULT_SETTINGS, ...existingSettings });
     mergedSettings.translationSystemPrompt = normalizeTranslationPolicy(mergedSettings.translationSystemPrompt);
     chrome.storage.sync.set(mergedSettings);
  });
}
