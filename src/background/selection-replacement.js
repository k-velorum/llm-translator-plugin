import { translateText, translateTextStream, formatErrorDetails } from './api.js';
import { sendMessageToFrame, streamToPopup } from './streaming.js';
import { TRANSLATION_TIMEOUT_MS } from '../shared/constants.js';
import { selectionDocumentSettings, serializeSelectionDocument, parseSelectionDocument, selectionDocumentText, selectionDocumentPreview } from '../shared/selection-document.js';
import { createPreviewReporter } from '../shared/translation-preview.js';

const active = new Map();

async function requestSelectionTranslation(prepared, text, settings, signal, onPreview) {
  const structured = !!prepared.requestId;
  const result = await translateText(structured ? serializeSelectionDocument(prepared.paragraphs) : text,
    structured ? selectionDocumentSettings(settings) : settings,
    { signal, timeoutMs: TRANSLATION_TIMEOUT_MS,
      onStatus: phase => onPreview(phase === 'loading' ? 'モデルを読み込み中…' : '処理中…', { status: true }),
      onDelta: (_delta, fullText) => onPreview(structured ? selectionDocumentPreview(fullText) : fullText) });
  const translations = structured ? parseSelectionDocument(result) : [];
  return { translations, displayText: structured ? selectionDocumentText(translations) : result };
}

async function showFallback(send, result, displayText, error) {
  if (result?.ok || result?.ignored) return;
  await send({ action: 'showTranslation', translatedText: error || displayText, notice: error ? '' : result?.reason });
}

export function cancelSelectionReplacement(requestId) {
  const controller = active.get(requestId);
  if (!controller) return false;
  controller.abort();
  return true;
}

// 選択全文を一度に翻訳する。HTMLの検証・反映・復元は選択元フレームが所有する。
export async function translateSelectionReplacement(tabId, text, frameId, settings, source) {
  const send = payload => sendMessageToFrame(tabId, frameId, payload);
  const prepared = await send({ action: 'prepareSelectionReplacement', text, source }).catch(() => null);
  if (!prepared) return false;
  const { requestId, reason } = prepared;
  if (!requestId) {
    const streamed = await streamToPopup({ tabId, frameId, kind: 'selection', notice: reason,
      run: (handlers, options) => translateTextStream(text, settings, handlers, options) });
    if (streamed.displayed) return true;
    if (streamed.error) {
      await showFallback(send, null, '', formatErrorDetails(streamed.error, settings));
      return true;
    }
  }
  if (!requestId) await send({ action: 'showLoading' });
  const controller = new AbortController();
  if (requestId) active.set(requestId, controller);
  let translations = [];
  let displayText = '';
  let error = '';
  const report = createPreviewReporter(requestId ? previewText => send({
    action: 'previewSelectionReplacement', requestId, previewText
  }) : null, controller.signal);
  try {
    ({ translations, displayText } = await requestSelectionTranslation(prepared, text, settings, controller.signal, report));
  } catch (cause) {
    error = formatErrorDetails(cause, settings);
  } finally {
    if (requestId) active.delete(requestId);
  }
  if (controller.signal.aborted) return true;
  const result = requestId
    ? await send({ action: 'finishSelectionReplacement', requestId, translations, error })
    : { reason };
  await showFallback(send, result, displayText, error);
  return true;
}
