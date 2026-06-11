(() => {
  'use strict';

const runtimeMessageHandlers = {
  showLoading(message) {
    window.showLoadingPopup(message?.anchorRect || null);
    return false;
  },

  showTranslation(message) {
    window.showTranslationPopup(message.translatedText, message?.anchorRect || null);
    return false;
  },

  getImageAnchorRect(message, sender, sendResponse) {
    sendResponse({ anchorRect: window.resolveImageAnchorRect(message?.srcUrl || '') });
    return true;
  },

  getImageDataUrl(message, sender, sendResponse) {
    window.resolveImageDataUrl(message?.srcUrl || '')
      .then((dataUrl) => {
        sendResponse({ dataUrl });
      })
      .catch((error) => {
        sendResponse({ error: { message: error?.message || String(error) } });
      });
    return true;
  },

  prepareSelectionTranslationStream(message, sender, sendResponse) {
    sendResponse({ requestId: window.prepareSelectionTranslationStream() });
    return true;
  },

  translationStreamStart() {
    return false;
  },

  translationStreamDelta(message) {
    window.appendStreamSessionDelta(message.requestId, message.deltaText || '');
    return false;
  },

  translationStreamComplete(message) {
    window.completeStreamSession(message.requestId, message.finalText || '');
    return false;
  },

  translationStreamError(message) {
    window.failStreamSession(message.requestId, message.error || { message: 'ストリーム翻訳エラー' });
    return false;
  },

  translationStreamCancelled(message) {
    const requestId = message.requestId || '';
    if (window.translationPopup?.dataset?.requestId === requestId) {
      window.removePopup({ suppressCancel: true });
    }
    window.cancelLocalStreamSession(requestId);
    return false;
  },

  getSelectedText(message, sender, sendResponse) {
    const selectedText = window.getSelection().toString().trim();
    sendResponse({ selectedText });
    return true;
  },

  getPageTexts(message, sender, sendResponse) {
    sendResponse(window.capturePageTextSnapshot());
    return true;
  },

  applyPageTranslation(message) {
    window.applyPageTranslation(message.translations, message.snapshotId);
    return false;
  },

  applyPageTranslationChunk(message) {
    window.applyPageTranslationChunk(message.snapshotId, message.offset || 0, message.translations || []);
    return false;
  },

  showPageTranslationControls(message) {
    const { snapshotId, remainingChunks, processedItems, totalItems, totalChunks, canContinue } = message;
    window.showPageTranslationControls(snapshotId, remainingChunks, processedItems, totalItems, totalChunks, canContinue);
    return false;
  },

  hidePageTranslationControls() {
    window.hidePageTranslationControls();
    return false;
  }
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const handler = runtimeMessageHandlers[message.action];
  if (!handler) return false;
  return handler(message, sender, sendResponse);
});

window.LLMT = window.LLMT || {};
window.LLMT.runtime = {
  runtimeMessageHandlers
};
})();
