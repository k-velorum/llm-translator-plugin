import { translateText, formatErrorDetails } from './api.js';
import { sendMessageToFrame } from './streaming.js';
import { TRANSLATION_TIMEOUT_MS } from '../shared/constants.js';
import { selectionDocumentSettings, serializeSelectionDocument, parseSelectionDocument, selectionDocumentText } from '../shared/selection-document.js';

const active = new Map();

async function requestSelectionTranslation(prepared, text, settings, signal) {
  const structured = !!prepared.requestId;
  const result = await translateText(structured ? serializeSelectionDocument(prepared.paragraphs) : text,
    structured ? selectionDocumentSettings(settings) : settings,
    { signal, timeoutMs: TRANSLATION_TIMEOUT_MS });
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
  if (!requestId) await send({ action: 'showLoading' });
  const controller = new AbortController();
  if (requestId) active.set(requestId, controller);
  let translations = [];
  let displayText = '';
  let error = '';
  try {
    ({ translations, displayText } = await requestSelectionTranslation(prepared, text, settings, controller.signal));
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
