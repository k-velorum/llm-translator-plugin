import { initializeDefaultSettings } from './settings.js';
import {
  discardPageTranslationSessionsForTab,
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
      chrome.contextMenus.create({
        id: 'summarize-selection', title: 'LLM要約', contexts: ['selection']
      }, () => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve();
      });
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
  if (info.menuItemId === 'summarize-selection' && info.selectionText) {
    try {
      await chrome.tabs.sendMessage(tab.id, {
        action: 'showSelectionSummary', text: info.selectionText
      }, { frameId: Number.isInteger(info.frameId) ? info.frameId : 0 });
    } catch (error) {
      log.warn('eventListeners', '要約を表示できません。対象ページを再読み込みしてください。', error);
    }
    return;
  }

  if (info.menuItemId === 'translate-page') {
    await startPageTranslation(tab?.id);
    return;
  }

  if (info.menuItemId === 'translate-with-llm' && info.selectionText) {
    const selectedText = info.selectionText;
    log.info('eventListeners', 'コンテキストメニューから翻訳', { selectedText });
    try {
      await chrome.tabs.get(tab.id);
      await translateAndNotify(tab.id, selectedText, Number.isInteger(info?.frameId) ? info.frameId : 0, 'contextmenu');
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
  if (command === 'summarize-selection') {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) return;
      // 選択のあるフォーカス中のフレーム自身が表示し、iframe内の選択にも対応する。
      await chrome.tabs.sendMessage(tab.id, { action: 'summarizeFocusedSelection' });
    } catch (error) {
      log.warn('eventListeners', '要約ショートカットを実行できません。対象ページを再読み込みしてください。', error);
    }
    return;
  }

  if (command === 'translate-selection') {
    log.info('eventListeners', '翻訳ショートカットが押されました');
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !tab.id) {
        log.error('eventListeners', 'アクティブなタブが見つからないか、IDがありません');
        return;
      }

      // 応答の先着順に依存せず、選択元フレームから翻訳を開始する。
      await chrome.tabs.sendMessage(tab.id, { action: 'translateFocusedSelection' });
    } catch (error) {
      if (error.message && error.message.includes('Could not establish connection')) {
        log.warn('eventListeners', 'コンテンツスクリプトとの接続確立失敗 (ショートカット)', error);
      } else {
        log.error('eventListeners', 'ショートカット処理中に予期せぬエラー', error);
      }
    }
  }
}

function handleTabRemoved(tabId) {
  discardPageTranslationSessionsForTab(tabId).catch((error) => {
    log.warn('eventListeners', '終了タブのページ翻訳セッション破棄に失敗しました', error);
  });
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

  if (!chrome.tabs.onRemoved.hasListener(handleTabRemoved)) {
    chrome.tabs.onRemoved.addListener(handleTabRemoved);
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    return handlePageTranslationRuntimeMessage(message, sender, sendResponse);
  });

  log.info('eventListeners', 'イベントリスナーが登録されました。');
}
