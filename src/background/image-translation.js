import { loadSettings } from './settings.js';
import { appendLog, getProviderMeta } from './logging.js';
import { formatErrorDetails, getProviderCapabilities, translateImage } from './api.js';
import { sendMessageToFrame } from './streaming.js';
import {
  IMAGE_FETCH_TIMEOUT_MS,
  MAX_IMAGE_BYTES,
  TRANSLATION_TIMEOUT_MS
} from '../shared/constants.js';
import { log } from '../shared/logger.js';

function isSerializableRect(rect) {
  return Number.isFinite(rect?.left)
    && Number.isFinite(rect?.top)
    && Number.isFinite(rect?.right)
    && Number.isFinite(rect?.bottom)
    && Number.isFinite(rect?.width)
    && Number.isFinite(rect?.height);
}

function createFallbackAnchorRect() {
  return {
    left: 16,
    top: 16,
    right: 16,
    bottom: 16,
    width: 0,
    height: 0
  };
}

async function requestImageAnchorRect(tabId, frameId, srcUrl) {
  try {
    const response = await sendMessageToFrame(tabId, frameId, { action: 'getImageAnchorRect', srcUrl });
    return isSerializableRect(response?.anchorRect) ? response.anchorRect : createFallbackAnchorRect();
  } catch (_) {
    return createFallbackAnchorRect();
  }
}

async function requestImageDataUrl(tabId, frameId, srcUrl) {
  try {
    const response = await sendMessageToFrame(tabId, frameId, { action: 'getImageDataUrl', srcUrl });
    if (typeof response?.dataUrl === 'string' && response.dataUrl.startsWith('data:image/')) {
      return response.dataUrl;
    }
    if (response?.error?.message) {
      throw new Error(response.error.message);
    }
  } catch (error) {
    throw new Error(`画像の実体化に失敗しました: ${error?.message || String(error)}`);
  }
  throw new Error('画像の実体化に失敗しました');
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function normalizeImageMimeType(contentType = '') {
  return String(contentType).split(';')[0].trim().toLowerCase();
}

function parseDataUrlImage(srcUrl) {
  const match = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i.exec(srcUrl || '');
  if (!match) {
    throw new Error('data URL 形式の画像ではありません');
  }
  const mimeType = normalizeImageMimeType(match[1]);
  const base64Data = match[2];
  const bytes = Math.floor((base64Data.length * 3) / 4);
  if (bytes > MAX_IMAGE_BYTES) {
    throw new Error(`画像サイズが上限を超えています (${Math.ceil(bytes / 1024 / 1024)}MB > 8MB)`);
  }
  return {
    kind: 'image',
    mimeType,
    dataUrl: srcUrl,
    bytes
  };
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), options.timeoutMs ?? IMAGE_FETCH_TIMEOUT_MS);
  const externalSignal = options.signal;
  const onExternalAbort = () => controller.abort();
  if (externalSignal) {
    externalSignal.addEventListener('abort', onExternalAbort, { once: true });
  }

  try {
    return await fetch(url, {
      method: options.method || 'GET',
      headers: options.headers,
      signal: controller.signal,
      credentials: 'include',
      cache: 'no-store'
    });
  } finally {
    clearTimeout(timeoutId);
    if (externalSignal) {
      try { externalSignal.removeEventListener('abort', onExternalAbort); } catch (_) {}
    }
  }
}

async function normalizeImageInput(srcUrl, requestOptions = {}) {
  if (!srcUrl || typeof srcUrl !== 'string') {
    throw new Error('画像 URL を取得できませんでした');
  }

  if (srcUrl.startsWith('data:image/')) {
    return parseDataUrlImage(srcUrl);
  }
  if (srcUrl.startsWith('blob:')) {
    const dataUrl = await requestImageDataUrl(requestOptions.tabId, requestOptions.frameId, srcUrl);
    return parseDataUrlImage(dataUrl);
  }

  let response;
  try {
    response = await fetchWithTimeout(srcUrl, requestOptions);
  } catch (fetchError) {
    try {
      const dataUrl = await requestImageDataUrl(requestOptions.tabId, requestOptions.frameId, srcUrl);
      return parseDataUrlImage(dataUrl);
    } catch (_) {
      throw fetchError;
    }
  }
  if (!response.ok) {
    try {
      const dataUrl = await requestImageDataUrl(requestOptions.tabId, requestOptions.frameId, srcUrl);
      return parseDataUrlImage(dataUrl);
    } catch (_) {
      throw new Error(`画像取得に失敗しました (${response.status} ${response.statusText})`);
    }
  }

  const mimeType = normalizeImageMimeType(response.headers.get('content-type'));
  if (!mimeType.startsWith('image/')) {
    throw new Error(`画像ではないレスポンスです: ${mimeType || 'unknown'}`);
  }

  const contentLength = Number.parseInt(response.headers.get('content-length') || '', 10);
  if (Number.isFinite(contentLength) && contentLength > MAX_IMAGE_BYTES) {
    throw new Error(`画像サイズが上限を超えています (${Math.ceil(contentLength / 1024 / 1024)}MB > 8MB)`);
  }

  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > MAX_IMAGE_BYTES) {
    throw new Error(`画像サイズが上限を超えています (${Math.ceil(buffer.byteLength / 1024 / 1024)}MB > 8MB)`);
  }

  return {
    kind: 'image',
    mimeType,
    dataUrl: `data:${mimeType};base64,${arrayBufferToBase64(buffer)}`,
    bytes: buffer.byteLength
  };
}

async function injectFallbackPopup(tabId, translatedText) {
  await chrome.scripting.executeScript({
    target: { tabId },
    func: (text) => {
      const existing = document.getElementById('llm-image-translation-fallback');
      if (existing) existing.remove();
      const popup = document.createElement('div');
      popup.id = 'llm-image-translation-fallback';
      popup.dataset.llmtUi = '';
      popup.textContent = text;
      Object.assign(popup.style, {
        position: 'fixed',
        top: '16px',
        right: '16px',
        maxWidth: '420px',
        maxHeight: '360px',
        overflowY: 'auto',
        zIndex: '2147483647',
        background: '#fff',
        color: '#1b2431',
        borderTop: '3px solid #2f6fb3',
        borderRadius: '12px',
        boxShadow: '0 10px 30px rgba(16, 24, 40, 0.22), 0 2px 8px rgba(16, 24, 40, 0.15)',
        padding: '14px 16px',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        fontSize: '14px',
        lineHeight: '1.7'
      });
      popup.onclick = () => popup.remove();
      document.body.appendChild(popup);
    },
    args: [translatedText]
  });
}

async function openInNewTab(translatedText) {
  const dataUrl = 'data:text/plain;charset=utf-8,' + encodeURIComponent(translatedText);
  await chrome.tabs.create({ url: dataUrl, active: true });
}

export async function translateImageAndNotify(tabId, srcUrl, frameId = 0) {
  const settings = await loadSettings();
  const capabilities = getProviderCapabilities(settings);
  const anchorRect = await requestImageAnchorRect(tabId, frameId, srcUrl);

  if (!capabilities.supportsImageTranslation) {
    const translatedText = formatErrorDetails(
      new Error(`現在のプロバイダー (${settings.apiProvider}) は画像翻訳に対応していません。LM Studio のマルチモーダル対応モデルを選択してください。`),
      settings
    );
    try {
      await sendMessageToFrame(tabId, frameId, { action: 'showTranslation', translatedText, anchorRect });
      return;
    } catch (_) {
      await injectFallbackPopup(tabId, translatedText);
      return;
    }
  }

  try {
    await sendMessageToFrame(tabId, frameId, { action: 'showLoading', anchorRect });
  } catch (_) {
    // 後続の fallback 表示へ進む
  }

  let translatedText;
  try {
    const imageInput = await normalizeImageInput(srcUrl, { tabId, frameId });
    translatedText = await translateImage(imageInput, settings, { timeoutMs: TRANSLATION_TIMEOUT_MS });
  } catch (error) {
    log.error('imageTranslation', '画像翻訳処理中のエラー', error);
    await appendLog({
      level: 'error',
      type: 'translate',
      event: 'image_failed',
      ...getProviderMeta(settings),
      tabId,
      message: error?.message || String(error)
    });
    translatedText = formatErrorDetails(error, settings);
  }

  try {
    await sendMessageToFrame(tabId, frameId, { action: 'showTranslation', translatedText, anchorRect });
    return;
  } catch (sendMessageError) {
    log.warn('imageTranslation', 'コンテンツスクリプトへの送信に失敗 (画像翻訳)', sendMessageError);
  }

  try {
    await injectFallbackPopup(tabId, translatedText);
    return;
  } catch (injectErr) {
    log.warn('imageTranslation', 'fallback ポップアップ注入に失敗 (画像翻訳)', injectErr);
  }

  await openInNewTab(translatedText);
}
