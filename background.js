// background.js - Service Worker Entry Point

// モジュールをインポート
// パスが './src/background/...' であることを確認してください
import { handleBackgroundMessage } from './src/background/message-handlers.js';
import { registerEventListeners } from './src/background/event-listeners.js';

function sanitizeMessageForLog(message) {
  if (!message || typeof message !== 'object') return message;
  const sanitized = { ...message };
  Object.keys(sanitized).forEach((key) => {
    if (/apiKey/i.test(key)) {
      sanitized[key] = sanitized[key] ? '[redacted]' : '';
    }
  });
  return sanitized;
}

console.log('Service Worker 起動');

// イベントリスナーを登録
registerEventListeners();

// メッセージリスナーを登録
// handleBackgroundMessage は非同期処理を含むため、true を返す必要がある場合がある
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('メインの background.js がメッセージを受信:', sanitizeMessageForLog(message));
  // handleBackgroundMessage内で非同期処理が行われる可能性を示唆するために true を返す
  const result = handleBackgroundMessage(message, sender, sendResponse);
  console.log('handleBackgroundMessage の戻り値:', result);
  return result;
});


console.log('background.js の初期化完了');
