// 共有デフォルト設定（全コンポーネントの単一ソース）
export const DEFAULT_SETTINGS = {
  apiProvider: 'openrouter',
  openrouterApiKey: '',
  openrouterModel: 'openai/gpt-4o-mini',
  geminiApiKey: '',
  geminiModel: 'gemini-flash-2.0',
  cerebrasApiKey: '',
  cerebrasModel: 'llama3.1-8b',
  zaiApiKey: '',
  zaiModel: 'glm-4.7',
  // 翻訳用システムプロンプト（ユーザー編集可能）
  translationSystemPrompt:
    '指示された文章を日本語に翻訳してください。翻訳結果のみを出力してください。特殊区切りトークン [[[SEP]]] が含まれる場合、それらは絶対に削除・翻訳・変更せず、そのまま出力に保持してください。トークンの数と順序も厳密に維持してください。',
  // Ollama (local LLM)
  ollamaServer: 'http://localhost:11434',
  ollamaModel: '',
  // LM Studio (OpenAI互換)
  lmstudioServer: 'http://localhost:1234',
  lmstudioModel: '',
  lmstudioApiKey: '',
  // プラットフォーム別 機能有効/無効
  enableTwitterTranslation: true,
  enableYoutubeTranslation: true,
  // ページ全体翻訳 詳細設定（UIで変更可能）
  pageTranslationSeparator: '[[[SEP]]]',
  pageTranslationMaxChars: 3500,
  pageTranslationMaxItemsPerChunk: 50,
  pageTranslationChunksPerPass: 6,
  pageTranslationDelayMs: 400,
  // ページ全体翻訳: 同時リクエスト数（並列）
  pageTranslationConcurrency: 4,
  // Anthropic / プロキシ機能は削除済み
};

// 設定の読み込み
export function loadSettings() {
  return new Promise((resolve) => {
    // chrome.storage.sync.get の第一引数にデフォルト値を渡すことで、
    // 保存されていないキーに対してもデフォルト値が適用されたオブジェクトを取得できる
    chrome.storage.sync.get(DEFAULT_SETTINGS, (settings) => {
      resolve(settings);
    });
  });
}

// 設定の保存 (popup.js でのみ使用されているが、一元管理のためにここに置くことも検討可能)
// export function saveSettings(settingsToSave) {
//   return new Promise((resolve, reject) => {
//     chrome.storage.sync.set(settingsToSave, () => {
//       if (chrome.runtime.lastError) {
//         return reject(chrome.runtime.lastError);
//       }
//       resolve();
//     });
//   });
// }

// デフォルト設定の初期化 (onInstalled イベントリスナー内で使用)
export function initializeDefaultSettings() {
  // 既存の設定を尊重しつつ、未設定の項目にデフォルト値を設定する
  chrome.storage.sync.get(null, (existingSettings) => {
     const mergedSettings = { ...DEFAULT_SETTINGS, ...existingSettings };
     chrome.storage.sync.set(mergedSettings);
  });
}
