const runtimeMessageHandlers = {
  showLoading() {
    showLoadingPopup();
    return false;
  },

  showTranslation(message) {
    showTranslationPopup(message.translatedText);
    return false;
  },

  prepareSelectionTranslationStream(message, sender, sendResponse) {
    sendResponse({ requestId: prepareSelectionTranslationStream() });
    return true;
  },

  translationStreamStart() {
    return false;
  },

  translationStreamDelta(message) {
    appendStreamSessionDelta(message.requestId, message.deltaText || '');
    return false;
  },

  translationStreamComplete(message) {
    completeStreamSession(message.requestId, message.finalText || '');
    return false;
  },

  translationStreamError(message) {
    failStreamSession(message.requestId, message.error || { message: 'ストリーム翻訳エラー' });
    return false;
  },

  translationStreamCancelled(message) {
    const requestId = message.requestId || '';
    if (translationPopup?.dataset?.requestId === requestId) {
      removePopup({ suppressCancel: true });
    }
    cancelLocalStreamSession(requestId);
    return false;
  },

  getSelectedText(message, sender, sendResponse) {
    const selectedText = window.getSelection().toString().trim();
    sendResponse({ selectedText });
    return true;
  },

  getPageTexts(message, sender, sendResponse) {
    sendResponse(capturePageTextSnapshot());
    return true;
  },

  applyPageTranslation(message) {
    applyPageTranslation(message.translations, message.snapshotId);
    return false;
  },

  applyPageTranslationChunk(message) {
    applyPageTranslationChunk(message.snapshotId, message.offset || 0, message.translations || []);
    return false;
  },

  showPageTranslationControls(message) {
    const { snapshotId, remainingChunks, processedItems, totalItems, totalChunks, canContinue } = message;
    showPageTranslationControls(snapshotId, remainingChunks, processedItems, totalItems, totalChunks, canContinue);
    return false;
  },

  hidePageTranslationControls() {
    hidePageTranslationControls();
    return false;
  }
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const handler = runtimeMessageHandlers[message.action];
  if (!handler) return false;
  return handler(message, sender, sendResponse);
});
