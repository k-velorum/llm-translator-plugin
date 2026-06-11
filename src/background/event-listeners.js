import { initializeDefaultSettings } from './settings.js';
import {
  handlePageTranslationRuntimeMessage,
  startPageTranslation
} from './page-translation-service.js';
import { translateAndNotify } from './selection-translation.js';
import { translateImageAndNotify } from './image-translation.js';
import { log } from '../shared/logger.js';

let setupContextMenuPromise = null;

// コンテキストメニュー作成
async function setupContextMenu() {
  if (setupContextMenuPromise) {
    return setupContextMenuPromise;
  }

  const menuId = 'translate-with-llm';
  setupContextMenuPromise = (async () => {
    await new Promise((resolve) => {
      chrome.contextMenus.removeAll(() => {
        if (chrome.runtime.lastError) {
          log.debug('eventListeners', 'コンテキストメニュー全削除時の情報', {
            message: chrome.runtime.lastError.message
          });
        }
        resolve();
      });
    });

    await new Promise((resolve, reject) => {
      chrome.contextMenus.create(
        {
          id: menuId,
          title: 'LLM翻訳',
          contexts: ['selection']
        },
        () => {
          if (chrome.runtime.lastError) {
            const errorMessage = chrome.runtime.lastError.message || '詳細不明のエラー';
            log.error('eventListeners', 'コンテキストメニュー作成エラー', { errorMessage });
            reject(new Error(errorMessage));
          } else {
            resolve();
          }
        }
      );
    });

    await new Promise((resolve, reject) => {
      chrome.contextMenus.create(
        {
          id: 'translate-page',
          title: 'LLMページ全体翻訳',
          contexts: ['page']
        },
        () => {
          if (chrome.runtime.lastError) {
            const errorMessage = chrome.runtime.lastError.message || '詳細不明のエラー';
            log.error('eventListeners', 'ページ全体翻訳メニュー作成エラー', { errorMessage });
            reject(new Error(errorMessage));
          } else {
            resolve();
          }
        }
      );
    });

    await new Promise((resolve, reject) => {
      chrome.contextMenus.create(
        {
          id: 'translate-image-with-llm',
          title: 'LLM画像翻訳',
          contexts: ['image']
        },
        () => {
          if (chrome.runtime.lastError) {
            const errorMessage = chrome.runtime.lastError.message || '詳細不明のエラー';
            log.error('eventListeners', '画像翻訳メニュー作成エラー', { errorMessage });
            reject(new Error(errorMessage));
          } else {
            resolve();
          }
        }
      );
    });
  })()
    .catch((error) => {
      log.error('eventListeners', 'コンテキストメニュー設定中に予期せぬエラー', error);
      throw error;
    })
    .finally(() => {
      setupContextMenuPromise = null;
    });

  return setupContextMenuPromise;
}

// コンテキストメニュークリック時の処理
async function handleContextMenuClick(info, tab) {
  if (info.menuItemId === 'translate-page') {
    await startPageTranslation(tab?.id);
    return;
  }

  if (info.menuItemId === 'translate-with-llm' && info.selectionText) {
    const selectedText = info.selectionText;
    log.info('eventListeners', 'コンテキストメニューから翻訳', { selectedText });
    try {
      await chrome.tabs.get(tab.id);
      await translateAndNotify(tab.id, selectedText, Number.isInteger(info?.frameId) ? info.frameId : 0);
    } catch (tabError) {
      log.error('eventListeners', 'タブへのアクセスエラー (コンテキストメニュー)', tabError);
    }
  }

  if (info.menuItemId === 'translate-image-with-llm' && info.srcUrl) {
    try {
      await chrome.tabs.get(tab.id);
      await translateImageAndNotify(tab.id, info.srcUrl, Number.isInteger(info?.frameId) ? info.frameId : 0);
    } catch (tabError) {
      log.error('eventListeners', 'タブへのアクセスエラー (画像コンテキストメニュー)', tabError);
    }
  }
}

// キーボードショートカット処理
async function handleCommand(command) {
  if (command === 'translate-selection') {
    log.info('eventListeners', '翻訳ショートカットが押されました');
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !tab.id) {
        log.error('eventListeners', 'アクティブなタブが見つからないか、IDがありません');
        return;
      }

      const response = await new Promise((resolve, reject) => {
        chrome.tabs.sendMessage(tab.id, { action: 'getSelectedText' }, (selectedResponse) => {
          if (chrome.runtime.lastError) {
            return reject(chrome.runtime.lastError);
          }
          resolve(selectedResponse);
        });
      });

      if (!response || !response.selectedText) {
        log.info('eventListeners', '選択されたテキストがありません (ショートカット)');
        return;
      }

      const selectedText = response.selectedText;
      log.info('eventListeners', '選択テキスト (ショートカット)', { selectedText });
      await translateAndNotify(tab.id, selectedText, 0);
    } catch (error) {
      if (error.message && error.message.includes('Could not establish connection')) {
        log.warn('eventListeners', 'コンテンツスクリプトとの接続確立失敗 (ショートカット)', error);
      } else {
        log.error('eventListeners', 'ショートカット処理中に予期せぬエラー', error);
      }
    }
  }
}

// イベントリスナーの登録
export function registerEventListeners() {
  chrome.runtime.onInstalled.addListener((details) => {
    log.info('eventListeners', `拡張機能が ${details.reason} されました。`);
    initializeDefaultSettings();
    setupContextMenu().catch((error) => {
      log.error('eventListeners', 'onInstalled でのコンテキストメニュー設定に失敗', error);
    });
  });

  // Unpacked の再読み込み直後など onInstalled が発火しない場合に備えて、
  // 起動時にもコンテキストメニューを再作成する。
  setupContextMenu().catch((error) => {
    log.error('eventListeners', '起動時のコンテキストメニュー設定に失敗', error);
  });

  if (!chrome.contextMenus.onClicked.hasListener(handleContextMenuClick)) {
    chrome.contextMenus.onClicked.addListener(handleContextMenuClick);
  }

  if (!chrome.commands.onCommand.hasListener(handleCommand)) {
    chrome.commands.onCommand.addListener(handleCommand);
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    return handlePageTranslationRuntimeMessage(message, sender, sendResponse);
  });

  log.info('eventListeners', 'イベントリスナーが登録されました。');
}
