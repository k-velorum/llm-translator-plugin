(() => {
  'use strict';

let pageTranslationSnapshot = { id: 0, nodes: [] };
let pageTranslationControls = null;
let pageTranslationControlsSnapshotId = null;

function capturePageTextSnapshot() {
  const nodes = DOMUtils.getTextNodes(document.body);
  const texts = nodes.map((node) => node.nodeValue);
  pageTranslationSnapshot = {
    id: (pageTranslationSnapshot.id || 0) + 1,
    nodes
  };
  return { texts, snapshotId: pageTranslationSnapshot.id };
}

function applyPageTranslation(translations, snapshotId) {
  let targetNodes = [];

  if (snapshotId && snapshotId === pageTranslationSnapshot.id && Array.isArray(pageTranslationSnapshot.nodes) && pageTranslationSnapshot.nodes.length) {
    targetNodes = pageTranslationSnapshot.nodes;
  } else {
    console.warn('applyPageTranslation: snapshotId が一致しないため再トラバースで適用します。');
    targetNodes = DOMUtils.getTextNodes(document.body);
  }

  const len = Math.min(targetNodes.length, translations.length);
  for (let i = 0; i < len; i += 1) {
    if (translations[i] !== undefined && targetNodes[i] && targetNodes[i].nodeValue !== undefined) {
      targetNodes[i].nodeValue = translations[i];
    }
  }
}

function applyPageTranslationChunk(snapshotId, offset = 0, translations = []) {
  if (!snapshotId || snapshotId !== pageTranslationSnapshot.id) {
    console.warn('applyPageTranslationChunk: snapshotId 不一致のため適用をスキップします。');
    return;
  }

  const nodes = pageTranslationSnapshot.nodes || [];
  const end = Math.min(nodes.length, offset + translations.length);
  for (let i = offset, j = 0; i < end; i += 1, j += 1) {
    if (nodes[i] && nodes[i].nodeValue !== undefined && translations[j] !== undefined) {
      nodes[i].nodeValue = translations[j];
    }
  }
}

function getPageTranslationControlState(canContinue, remainingChunks) {
  if (remainingChunks === 0) return 'completed';
  if (!canContinue) return 'running';
  return 'waiting';
}

function renderPageTranslationStatus(statusElement, state) {
  if (!statusElement) return;
  statusElement.textContent = '';
  applyStyles(statusElement, styles.pageControlsStatus);

  if (state === 'running') {
    const spinner = createLoadingSpinner({
      size: 10,
      trackColor: 'rgba(31, 91, 149, 0.3)',
      color: '#1f5b95',
      durationMs: 900
    });
    spinner.style.marginRight = '6px';

    const label = document.createElement('span');
    label.textContent = '実行中';

    statusElement.appendChild(spinner);
    statusElement.appendChild(label);
    applyStyles(statusElement, styles.pageControlsStatusRunning);
    return;
  }

  if (state === 'completed') {
    statusElement.textContent = '完了';
    applyStyles(statusElement, styles.pageControlsStatusCompleted);
    return;
  }

  statusElement.textContent = '待機中';
  applyStyles(statusElement, styles.pageControlsStatusWaiting);
}

function showPageTranslationControls(snapshotId, remainingChunks, processedItems = 0, totalItems = 0, totalChunks = 0, canContinue = true) {
  pageTranslationControlsSnapshotId = snapshotId;

  if (!pageTranslationControls) {
    const wrap = document.createElement('div');
    wrap.id = 'llm-page-translation-controls';
    applyStyles(wrap, styles.pageControlsWrap);

    const header = document.createElement('div');
    applyStyles(header, styles.pageControlsHeader);

    const title = document.createElement('div');
    title.textContent = 'ページ翻訳';
    applyStyles(title, styles.pageControlsTitle);

    const status = document.createElement('div');
    status.id = 'llm-page-translation-status';
    applyStyles(status, styles.pageControlsStatus);

    header.appendChild(title);
    header.appendChild(status);

    const info = document.createElement('div');
    info.id = 'llm-page-translation-info';
    applyStyles(info, styles.pageControlsInfo);

    const progress = document.createElement('div');
    progress.id = 'llm-page-translation-progress';
    applyStyles(progress, styles.pageControlsProgress);

    const row = document.createElement('div');
    applyStyles(row, styles.pageControlsRow);

    const continueBtn = document.createElement('button');
    continueBtn.id = 'llm-page-translation-continue';
    continueBtn.textContent = '続きを実行';
    continueBtn.type = 'button';
    applyStyles(continueBtn, styles.pageControlsContinueBtn);
    continueBtn.onclick = async () => {
      const targetSnapshotId = pageTranslationControlsSnapshotId;
      if (!targetSnapshotId) return;
      const originalText = continueBtn.textContent;
      continueBtn.disabled = true;
      continueBtn.textContent = '実行中…';
      try {
        await new Promise((resolve, reject) => {
          const timeoutId = setTimeout(() => reject(new Error('continuePageTranslation timeout')), 200000);
          const sent = safeSendMessage({ action: 'continuePageTranslation', snapshotId: targetSnapshotId }, (response) => {
            clearTimeout(timeoutId);
            if (response?.error) return reject(new Error(response.error.message || response.error || 'unknown error'));
            if (!response || response.ok !== true) return reject(new Error(response?.error || 'unknown error'));
            resolve();
          });
          if (!sent) {
            clearTimeout(timeoutId);
            reject(new Error('Extension context invalidated'));
          }
        });
      } catch (error) {
        console.error('continuePageTranslation 送信失敗:', error);
        continueBtn.disabled = false;
        continueBtn.textContent = originalText;
      }
    };

    const stopBtn = document.createElement('button');
    stopBtn.id = 'llm-page-translation-stop';
    stopBtn.textContent = '停止';
    stopBtn.type = 'button';
    applyStyles(stopBtn, styles.pageControlsStopBtn);
    stopBtn.onclick = async () => {
      const targetSnapshotId = pageTranslationControlsSnapshotId;
      if (!targetSnapshotId) return;
      stopBtn.disabled = true;
      try {
        await new Promise((resolve, reject) => {
          const sent = safeSendMessage({ action: 'cancelPageTranslation', snapshotId: targetSnapshotId }, (response) => {
            if (response?.error) return reject(new Error(response.error.message || response.error || 'unknown error'));
            resolve();
          });
          if (!sent) return reject(new Error('Extension context invalidated'));
        });
      } catch (error) {
        console.error('cancelPageTranslation 送信失敗:', error);
      } finally {
        stopBtn.disabled = false;
      }
    };

    row.appendChild(continueBtn);
    row.appendChild(stopBtn);

    wrap.appendChild(header);
    wrap.appendChild(info);
    wrap.appendChild(progress);
    wrap.appendChild(row);
    document.body.appendChild(wrap);
    pageTranslationControls = wrap;
  }

  const info = pageTranslationControls.querySelector('#llm-page-translation-info');
  const progress = pageTranslationControls.querySelector('#llm-page-translation-progress');
  const status = pageTranslationControls.querySelector('#llm-page-translation-status');
  const continueBtn = pageTranslationControls.querySelector('#llm-page-translation-continue');
  const stopBtn = pageTranslationControls.querySelector('#llm-page-translation-stop');
  const percent = totalItems > 0 ? Math.floor((processedItems / totalItems) * 100) : 0;

  const state = getPageTranslationControlState(canContinue, remainingChunks);
  applyStyles(pageTranslationControls, styles.pageControlsWrap);
  if (state === 'running') applyStyles(pageTranslationControls, styles.pageControlsWrapRunning);
  if (state === 'waiting') applyStyles(pageTranslationControls, styles.pageControlsWrapWaiting);
  if (state === 'completed') applyStyles(pageTranslationControls, styles.pageControlsWrapCompleted);

  if (status) {
    renderPageTranslationStatus(status, state);
  }

  if (info) {
    info.textContent = totalChunks > 0
      ? `残り: ${remainingChunks}/${totalChunks} チャンク`
      : `残り: ${remainingChunks} チャンク`;
  }
  if (progress) {
    progress.textContent = totalItems > 0
      ? `進捗: ${percent}% (${processedItems}/${totalItems}項目)`
      : `進捗: ${percent}%`;
  }
  if (continueBtn) {
    const isCompleted = remainingChunks === 0;
    continueBtn.disabled = isCompleted || !canContinue;
    continueBtn.textContent = isCompleted ? '完了' : '続きを実行';
    applyStyles(continueBtn, styles.pageControlsContinueBtn);
    if (continueBtn.disabled) applyStyles(continueBtn, styles.pageControlsContinueBtnDisabled);
  }
  if (stopBtn) {
    stopBtn.disabled = remainingChunks === 0;
    applyStyles(stopBtn, styles.pageControlsStopBtn);
    if (stopBtn.disabled) applyStyles(stopBtn, styles.pageControlsStopBtnDisabled);
  }
}

function hidePageTranslationControls() {
  if (pageTranslationControls && pageTranslationControls.parentNode) {
    pageTranslationControls.parentNode.removeChild(pageTranslationControls);
  }
  pageTranslationControls = null;
  pageTranslationControlsSnapshotId = null;
}

window.LLMT = window.LLMT || {};
window.LLMT.pageTranslation = {
  capturePageTextSnapshot,
  applyPageTranslation,
  applyPageTranslationChunk,
  showPageTranslationControls,
  hidePageTranslationControls
};
Object.assign(window, window.LLMT.pageTranslation);
})();
