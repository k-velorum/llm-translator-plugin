(() => {
  'use strict';

const runtimeMessageHandlers = {
  summarizeFocusedSelection(message, sender, sendResponse) {
    const text = document.hasFocus() ? window.getSelection()?.toString().trim() : '';
    if (text) window.LLMT.selection.showSelectionSummary(text);
    sendResponse({ started: !!text });
    return false;
  },

  showSelectionSummary(message) {
    window.LLMT.selection.showSelectionSummary(message.text);
    return false;
  },

  showLoading(message) {
    window.showLoadingPopup(message?.anchorRect || null);
    return false;
  },

  showTranslation(message) {
    window.showTranslationPopup(message.translatedText, message?.anchorRect || null, message.notice || '');
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
    sendResponse({ requestId: window.prepareSelectionTranslationStream(message) });
    return true;
  },

  prepareSelectionReplacement(message, sender, sendResponse) {
    sendResponse(window.LLMT.selectionReplacement.prepare(message.text, message.source));
    return true;
  },

  finishSelectionReplacement(message, sender, sendResponse) {
    sendResponse(window.LLMT.selectionReplacement.finish(message.requestId, message.translations, message.error));
    return true;
  },

  previewSelectionReplacement(message) {
    window.LLMT.selectionReplacement.preview(message.requestId, message.previewText || '');
    return false;
  },

  pageTranslationPreview(message) {
    window.LLMT.pageTranslation.preview(message.snapshotId, message.previewText || '');
    return false;
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

  translateFocusedSelection(message, sender, sendResponse) {
    // 子フレームにフォーカスがある親documentもhasFocus()がtrueになる。
    const childFocused = ['IFRAME', 'FRAME'].includes(document.activeElement?.tagName);
    const text = document.hasFocus() && !childFocused ? window.getSelection()?.toString().trim() : '';
    if (text) {
      window.LLMT.selectionReplacement.remember('shortcut');
      window.LLMT.messaging.sendBackgroundMessage('translateSelection', { text }).then(result => {
        if (!result.ok) window.showTranslationPopup(`翻訳エラー: ${result.error.message}`);
      });
    }
    sendResponse({ started: !!text });
    return false;
  },

  getPageTexts(message, sender, sendResponse) {
    sendResponse(window.capturePageTextSnapshot());
    return true;
  },

  applyPageTranslation(message) {
    window.applyPageTranslation(message.translations, message.snapshotId);
    return false;
  },

  applyPageTranslationChunk(message, sender, sendResponse) {
    sendResponse(window.applyPageTranslationChunk(message.snapshotId, message.offset ?? 0, message.translations || []));
    return true;
  },

  showPageTranslationControls(message) {
    window.showPageTranslationControls(message);
    return false;
  },

  hidePageTranslationControls(message) {
    window.hidePageTranslationControls(message.snapshotId);
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
