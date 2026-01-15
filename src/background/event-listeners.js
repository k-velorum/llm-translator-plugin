import { loadSettings, initializeDefaultSettings } from './settings.js';
import { translateText, translateBatchStructured, formatErrorDetails } from './api.js';

// 既定値（settings に無い場合のフォールバック）
const PAGE_TRANSLATION_SEPARATOR = '[[[SEP]]]';
const PAGE_TRANSLATION_MAX_CHARS = 3500;
const PAGE_TRANSLATION_MAX_ITEMS_PER_CHUNK = 50;
const PAGE_TRANSLATION_CHUNKS_PER_PASS = 6;
const PAGE_TRANSLATION_DELAY_MS = 400;
const PAGE_TRANSLATION_CONCURRENCY = 4;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function chunkByMaxCharsAndItems(items, maxChars, maxItems, sep) {
  const chunks = [];
  let current = [];
  let currentLen = 0;
  const sepLen = sep.length;
  for (const s of items) {
    const sLen = s.length;
    const projected = currentLen + (current.length ? sepLen : 0) + sLen;
    const wouldExceedChars = current.length > 0 && projected > maxChars;
    const wouldExceedItems = current.length >= maxItems;
    if (current.length > 0 && (wouldExceedChars || wouldExceedItems)) {
      chunks.push(current);
      current = [s];
      currentLen = sLen;
    } else {
      current.push(s);
      currentLen = projected;
    }
  }
  if (current.length) chunks.push(current);
  return chunks;
}

async function translateJoinedOrSplit(chunk, settings, params, depth = 0) {
  // まず Gemini の場合は構造化バッチに挑戦（区切り不一致を根本回避）
  if (settings.apiProvider === 'gemini') {
    try {
      const arr = await translateBatchStructured(chunk, settings);
      if (Array.isArray(arr) && arr.length === chunk.length) return arr;
    } catch (e) {
      console.warn('構造化バッチ翻訳が失敗したため連結方式にフォールバックします:', e?.message || e);
    }
  }

  // まずは連結翻訳を試す
  const sep = params?.sep || PAGE_TRANSLATION_SEPARATOR;
  const delayMs = typeof params?.delayMs === 'number' ? params.delayMs : PAGE_TRANSLATION_DELAY_MS;
  const joined = chunk.join(sep);
  let translated = await translateText(joined, settings);
  let parts = translated.split(sep);
  if (parts.length === chunk.length) return parts;

  console.warn(`区切り数不一致のためサブ分割を試行: expected=${chunk.length} actual=${parts.length} depth=${depth}`);
  // 深さ制限 or 要素1なら個別翻訳
  if (depth >= 3 || chunk.length <= 1) {
    const perItem = [];
    for (const s of chunk) {
      try {
        const t = await translateText(s, settings);
        perItem.push(t);
        await sleep(delayMs);
      } catch (e) {
        console.error('個別翻訳フォールバック中のエラー:', e);
        perItem.push(s);
      }
    }
    return perItem;
  }
  // チャンクを2分割して再帰
  const mid = Math.floor(chunk.length / 2);
  const left = await translateJoinedOrSplit(chunk.slice(0, mid), settings, params, depth + 1);
  await sleep(delayMs);
  const right = await translateJoinedOrSplit(chunk.slice(mid), settings, params, depth + 1);
  return [...left, ...right];
}

// ページ翻訳セッション管理
const pageTranslationSessions = new Map(); // key: `${tabId}:${snapshotId}` -> session

function makeSessionKey(tabId, snapshotId) {
  return `${tabId}:${snapshotId}`;
}

function registerPageTranslationSession(session) {
  const key = makeSessionKey(session.tabId, session.snapshotId);
  pageTranslationSessions.set(key, session);
}

function getPageTranslationSession(tabId, snapshotId) {
  return pageTranslationSessions.get(makeSessionKey(tabId, snapshotId));
}

function deletePageTranslationSession(tabId, snapshotId) {
  pageTranslationSessions.delete(makeSessionKey(tabId, snapshotId));
}

async function processPageTranslationPass(session, chunksPerPass) {
  const { tabId, snapshotId, settings, chunks } = session;
  const delayMs = typeof session.params?.delayMs === 'number' ? session.params.delayMs : PAGE_TRANSLATION_DELAY_MS;
  const concurrency = clampInt(session.params?.concurrency, 1, 20, PAGE_TRANSLATION_CONCURRENCY);

  let processed = 0;

  // 1パス内で、最大 concurrency 個のチャンクを並列翻訳→順序どおりに適用
  while (!session.canceled && session.nextIndex < chunks.length && processed < chunksPerPass) {
    const remainingThisPass = chunksPerPass - processed;
    const batchCount = Math.min(concurrency, remainingThisPass, chunks.length - session.nextIndex);

    // このバッチで処理するチャンクを確定（順序維持）
    const batch = [];
    let baseOffset = session.offset;
    for (let i = 0; i < batchCount; i++) {
      const idx = session.nextIndex + i;
      const chunk = chunks[idx];
      batch.push({ idx, chunk, offset: baseOffset });
      baseOffset += chunk.length;
    }

    // 翻訳は並列
    const results = await Promise.all(
      batch.map(async (b) => {
        const parts = await translateJoinedOrSplit(b.chunk, settings, session.params);
        return { ...b, parts };
      })
    );

    // 適用は順序どおり（DOM書き換えの整合性のため）
    for (const r of results) {
      if (session.canceled) break;
      try {
        await chrome.tabs.sendMessage(tabId, {
          action: 'applyPageTranslationChunk',
          snapshotId,
          offset: r.offset,
          translations: r.parts
        });
      } catch (e) {
        console.warn('applyPageTranslationChunk 送信に失敗しました:', e);
      }
      // セッション進捗を進める
      session.offset += r.chunk.length;
      session.nextIndex += 1;
      processed += 1;

      // 適用間のディレイ（設定に従う）
      if (delayMs > 0) await sleep(delayMs);
    }
  }

  // 完了したらセッションを破棄
  if (!session.canceled && session.nextIndex >= chunks.length) {
    deletePageTranslationSession(tabId, snapshotId);
  }
}

async function translateAndNotify(tabId, text) {
  const settings = await loadSettings();
  let translatedText;
  try {
    translatedText = await translateText(text, settings);
  } catch (error) {
    console.error('翻訳処理中のエラー:', error);
    translatedText = formatErrorDetails(error, settings);
  }

  // まずはコンテンツスクリプトへ表示依頼
  try {
    await chrome.tabs.sendMessage(tabId, { action: 'showTranslation', translatedText });
    return;
  } catch (sendMessageError) {
    console.warn('コンテンツスクリプトへの送信に失敗:', sendMessageError);
  }

  // フォールバック1: scripting 経由で直接ポップアップを注入
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (text) => {
        try {
          // 既存の簡易ポップアップを削除
          const old = document.querySelector('.llm-translation-popup-fallback');
          if (old && old.parentNode) old.parentNode.removeChild(old);

          const selection = window.getSelection();
          const hasRange = selection && selection.rangeCount > 0;
          const range = hasRange ? selection.getRangeAt(0) : null;
          const rect = range ? range.getBoundingClientRect() : { left: 24, bottom: 24 };

          const popup = document.createElement('div');
          popup.className = 'llm-translation-popup-fallback';
          Object.assign(popup.style, {
            position: 'absolute',
            zIndex: '2147483647',
            background: 'white',
            border: '1px solid #ccc',
            borderRadius: '6px',
            padding: '10px',
            boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
            maxWidth: '420px',
            maxHeight: '320px',
            overflowY: 'auto',
            fontSize: '14px',
            color: '#333',
            left: `${window.scrollX + (rect.left || 24)}px`,
            top: `${window.scrollY + (rect.bottom ? rect.bottom + 10 : 24)}px`
          });

          const header = document.createElement('div');
          header.textContent = 'LLM翻訳結果 (fallback)';
          Object.assign(header.style, { fontWeight: 'bold', marginBottom: '6px' });

          const body = document.createElement('div');
          Object.assign(body.style, {
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            background: '#f8f8f8',
            padding: '8px',
            borderRadius: '4px'
          });
          body.textContent = text;

          const row = document.createElement('div');
          Object.assign(row.style, { display: 'flex', gap: '8px', marginTop: '8px' });

          const copy = document.createElement('button');
          copy.textContent = 'コピー';
          Object.assign(copy.style, { cursor: 'pointer' });
          copy.onclick = async () => {
            try {
              await navigator.clipboard.writeText(text);
              copy.textContent = 'コピーしました';
              setTimeout(() => (copy.textContent = 'コピー'), 1500);
            } catch (_) {}
          };

          const close = document.createElement('button');
          close.textContent = '閉じる';
          Object.assign(close.style, { cursor: 'pointer' });
          close.onclick = () => popup.remove();

          row.appendChild(copy);
          row.appendChild(close);

          popup.appendChild(header);
          popup.appendChild(body);
          popup.appendChild(row);
          document.body.appendChild(popup);

          const onDocClick = (ev) => {
            if (!popup.contains(ev.target)) {
              popup.remove();
              document.removeEventListener('click', onDocClick, true);
            }
          };
          setTimeout(() => document.addEventListener('click', onDocClick, true), 0);
        } catch (e) {
          console.error('fallback popup injection error', e);
        }
      },
      args: [translatedText]
    });
    return;
  } catch (injectErr) {
    console.warn('fallback ポップアップ注入に失敗:', injectErr);
  }

  // フォールバック2: 新規タブで表示（最終手段）
  try {
    const dataUrl = 'data:text/plain;charset=utf-8,' + encodeURIComponent(translatedText);
    await chrome.tabs.create({ url: dataUrl, index: undefined, active: true });
  } catch (openErr) {
    console.error('翻訳結果の表示に完全に失敗しました:', openErr);
  }
}

// コンテキストメニュー作成
async function setupContextMenu() {
  const menuId = 'translate-with-llm';
  try {
    // 既存のメニューを全て削除 (Promiseでラップ)
    await new Promise((resolve) => {
      chrome.contextMenus.removeAll(() => {
        if (chrome.runtime.lastError) {
          // 削除対象がなくても lastError が入る場合があるため、警告ではなくデバッグに留める
          console.debug(`コンテキストメニュー全削除時の情報: ${chrome.runtime.lastError.message}`);
        }
        resolve();
      });
    });

    // 新しいメニューを作成 (Promiseでラップ)
    await new Promise((resolve, reject) => {
        chrome.contextMenus.create({
          id: menuId,
          title: 'LLM翻訳',
          contexts: ['selection']
        }, () => {
            if (chrome.runtime.lastError) {
                // エラーメッセージを具体的に表示
                const errorMessage = chrome.runtime.lastError.message || '詳細不明のエラー';
                console.error('コンテキストメニュー作成エラー:', errorMessage);
                reject(new Error(errorMessage)); // Errorオブジェクトでrejectする
            } else {
                resolve();
            }
        });
    });

    // ページ全体翻訳メニューを作成
    await new Promise((resolve, reject) => {
        chrome.contextMenus.create({
          id: 'translate-page',
          title: 'LLMページ全体翻訳',
          contexts: ['page']
        }, () => {
            if (chrome.runtime.lastError) {
                const errorMessage = chrome.runtime.lastError.message || '詳細不明のエラー';
                console.error('ページ全体翻訳メニュー作成エラー:', errorMessage);
                reject(new Error(errorMessage));
            } else {
                resolve();
            }
        });
    });

  } catch (error) {
    // create で reject された場合やその他の予期せぬエラー
    console.error('コンテキストメニュー設定中に予期せぬエラー:', error);
  }
}

// コンテキストメニュークリック時の処理
async function handleContextMenuClick(info, tab) {
  if (info.menuItemId === 'translate-page') {
    console.log('ページ全体翻訳リクエストを受信');
    try {
      const response = await chrome.tabs.sendMessage(tab.id, { action: 'getPageTexts' });
      let pageTexts = response.texts || [];
      const snapshotId = response.snapshotId;
      const settings = await loadSettings();

      // ユーザー設定の反映（安全域にクランプ）
      const sep = (settings.pageTranslationSeparator || PAGE_TRANSLATION_SEPARATOR).toString();
      const maxChars = clampInt(settings.pageTranslationMaxChars, 500, 32000, PAGE_TRANSLATION_MAX_CHARS);
      const maxItems = clampInt(settings.pageTranslationMaxItemsPerChunk, 5, 500, PAGE_TRANSLATION_MAX_ITEMS_PER_CHUNK);
      const chunksPerPass = clampInt(settings.pageTranslationChunksPerPass, 1, 100, PAGE_TRANSLATION_CHUNKS_PER_PASS);
      const delayMs = clampInt(settings.pageTranslationDelayMs, 0, 60000, PAGE_TRANSLATION_DELAY_MS);
      const concurrency = clampInt(settings.pageTranslationConcurrency, 1, 20, PAGE_TRANSLATION_CONCURRENCY);

      // 長文になりすぎるのを避け、小チャンクに分けて逐次適用
      const chunks = chunkByMaxCharsAndItems(pageTexts, maxChars, maxItems, sep);

      const totalItems = pageTexts.length;
      const session = {
        tabId: tab.id,
        snapshotId,
        settings,
        chunks,
        nextIndex: 0,
        offset: 0,
        totalItems,
        canceled: false,
        params: { sep, maxChars, maxItemsPerChunk: maxItems, chunksPerPass, delayMs, concurrency }
      };
      registerPageTranslationSession(session);
      // 開始時点で0%・総チャンク数を表示
      try {
        await chrome.tabs.sendMessage(tab.id, {
          action: 'showPageTranslationControls',
          snapshotId,
          remainingChunks: session.chunks.length,
          processedItems: 0,
          totalItems: session.totalItems,
          totalChunks: session.chunks.length,
          canContinue: false
        });
      } catch (e) {
        console.warn('初期コントロール表示に失敗:', e);
      }
      await processPageTranslationPass(session, session.params.chunksPerPass);
      if (!session.canceled && session.nextIndex < session.chunks.length) {
        await chrome.tabs.sendMessage(tab.id, {
          action: 'showPageTranslationControls',
          snapshotId,
          remainingChunks: session.chunks.length - session.nextIndex,
          processedItems: session.offset,
          totalItems: session.totalItems,
          totalChunks: session.chunks.length,
          canContinue: true
        });
      } else {
        await chrome.tabs.sendMessage(tab.id, { action: 'hidePageTranslationControls', snapshotId });
      }
    } catch (error) {
      console.error('ページ全体翻訳エラー:', error);
    }
    return;
  }
  if (info.menuItemId === 'translate-with-llm' && info.selectionText) {
    const selectedText = info.selectionText;
    console.log('コンテキストメニューから翻訳:', selectedText);
    try {
      // タブが存在するか確認し、メッセージを送信
      await chrome.tabs.get(tab.id); // tab.id が存在するか確認
      await translateAndNotify(tab.id, selectedText);
    } catch (tabError) {
      // タブが存在しない、またはアクセスできない場合のエラー
      console.error('タブへのアクセスエラー (コンテキストメニュー):', tabError);
      // ここでユーザーに通知する方法を検討 (例: バッジテキストの変更など)
    }
  }
}

// キーボードショートカット処理
async function handleCommand(command) {
  if (command === 'translate-selection') {
    console.log('翻訳ショートカットが押されました');
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !tab.id) {
        console.error('アクティブなタブが見つからないか、IDがありません');
        return;
      }

      // コンテンツスクリプトにメッセージを送信し、応答を待つ
      // sendMessage は Promise を返さないため、コールバックまたは async/await でラップする必要がある
      const response = await new Promise((resolve, reject) => {
        chrome.tabs.sendMessage(tab.id, { action: 'getSelectedText' }, (response) => {
          if (chrome.runtime.lastError) {
            return reject(chrome.runtime.lastError);
          }
          resolve(response);
        });
      });


      if (!response || !response.selectedText) {
        console.log('選択されたテキストがありません (ショートカット)');
        // 必要であればユーザーに通知 (例: 短い通知を表示)
        // chrome.notifications.create(...) など
        return;
      }

      const selectedText = response.selectedText;
      console.log('選択テキスト (ショートカット):', selectedText);
      await translateAndNotify(tab.id, selectedText);
    } catch (error) {
       if (error.message && error.message.includes('Could not establish connection')) {
         console.warn('コンテンツスクリプトとの接続確立失敗 (ショートカット):', error.message);
         // ページがリロードされた直後などに発生しうる。ユーザーに再試行を促す通知などが考えられる。
       } else {
         console.error('ショートカット処理中に予期せぬエラー:', error);
       }
    }
  }
}


// イベントリスナーの登録
export function registerEventListeners() {
  // インストール/更新時の処理
  chrome.runtime.onInstalled.addListener((details) => {
    console.log(`拡張機能が ${details.reason} されました。`);
    initializeDefaultSettings(); // 設定の初期化/更新
    setupContextMenu(); // コンテキストメニューの設定
  });

  // コンテキストメニュークリック
  // 既にリスナーが登録されている場合、重複登録を避ける (ただし通常 onInstalled で十分)
  if (!chrome.contextMenus.onClicked.hasListener(handleContextMenuClick)) {
      chrome.contextMenus.onClicked.addListener(handleContextMenuClick);
  }

  // キーボードショートカット
  if (!chrome.commands.onCommand.hasListener(handleCommand)) {
      chrome.commands.onCommand.addListener(handleCommand);
  }

  // ページ翻訳: 続きを実行
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message && message.action === 'continuePageTranslation') {
      (async () => {
        try {
          const tabId = sender?.tab?.id || (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id;
          if (!tabId) return sendResponse && sendResponse({ ok: false, error: 'tab not found' });
          const { snapshotId } = message;
          const session = getPageTranslationSession(tabId, snapshotId);
          if (!session) return sendResponse && sendResponse({ ok: false, error: 'session not found' });
          await processPageTranslationPass(session, session.params?.chunksPerPass || PAGE_TRANSLATION_CHUNKS_PER_PASS);
          if (!session.canceled && session.nextIndex < session.chunks.length) {
            await chrome.tabs.sendMessage(tabId, {
              action: 'showPageTranslationControls',
              snapshotId,
              remainingChunks: session.chunks.length - session.nextIndex,
              processedItems: session.offset,
              totalItems: session.totalItems,
              totalChunks: session.chunks.length,
              canContinue: true
            });
          } else {
            await chrome.tabs.sendMessage(tabId, { action: 'hidePageTranslationControls', snapshotId });
          }
          sendResponse && sendResponse({ ok: true });
        } catch (e) {
          console.error('continuePageTranslation エラー:', e);
          sendResponse && sendResponse({ ok: false, error: e?.message || String(e) });
        }
      })();
      return true; // 非同期応答
    } else if (message && message.action === 'cancelPageTranslation') {
      (async () => {
        try {
          const tabId = sender?.tab?.id || (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id;
          if (!tabId) return sendResponse && sendResponse({ ok: false, error: 'tab not found' });
          const { snapshotId } = message;
          const session = getPageTranslationSession(tabId, snapshotId);
          if (!session) {
            return sendResponse && sendResponse({ ok: true }); // すでに終わっている/存在しない
          }
          session.canceled = true;
          deletePageTranslationSession(tabId, snapshotId);
          await chrome.tabs.sendMessage(tabId, { action: 'hidePageTranslationControls', snapshotId });
          sendResponse && sendResponse({ ok: true });
        } catch (e) {
          console.error('cancelPageTranslation エラー:', e);
          sendResponse && sendResponse({ ok: false, error: e?.message || String(e) });
        }
      })();
      return true;
    }
    return false;
  });

  console.log('イベントリスナーが登録されました。');
}

// 数値設定のクランプ（未定義/NaNはデフォルト）
function clampInt(value, min, max, fallback) {
  const n = parseInt(value, 10);
  if (Number.isFinite(n)) {
    if (typeof min === 'number' && n < min) return min;
    if (typeof max === 'number' && n > max) return max;
    return n;
  }
  return fallback;
}
