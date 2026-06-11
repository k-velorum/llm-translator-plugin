(() => {
  'use strict';

let pageTranslationSnapshot = { id: 0, nodes: [] };
let pageTranslationControls = null;
let pageTranslationControlsSnapshotId = null;
let pageTranslationAutoHideTimer = null;

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
    if (typeof translations[i] === 'string' && targetNodes[i] && targetNodes[i].nodeValue !== undefined) {
      targetNodes[i].nodeValue = translations[i];
    }
  }
}

// translations の null/undefined は「翻訳失敗 item」を表し、原文を維持する。
function applyPageTranslationChunk(snapshotId, offset = 0, translations = []) {
  if (!snapshotId || snapshotId !== pageTranslationSnapshot.id) {
    console.warn('applyPageTranslationChunk: snapshotId 不一致のため適用をスキップします。');
    return;
  }

  const nodes = pageTranslationSnapshot.nodes || [];
  const end = Math.min(nodes.length, offset + translations.length);
  for (let i = offset, j = 0; i < end; i += 1, j += 1) {
    if (nodes[i] && nodes[i].nodeValue !== undefined && typeof translations[j] === 'string') {
      nodes[i].nodeValue = translations[j];
    }
  }
}

const PAGE_CONTROL_STATUS_LABELS = {
  running: '実行中',
  completed: '完了',
  partial: '一部失敗',
  lost: '中断'
};

function renderPageTranslationStatusChip(statusElement, status) {
  if (!statusElement) return;
  statusElement.textContent = '';
  applyStyles(statusElement, styles.pageControlsStatus);

  if (status === 'running') {
    const spinner = createLoadingSpinner({
      size: 10,
      trackColor: 'rgba(31, 91, 149, 0.3)',
      color: '#1f5b95',
      durationMs: 900
    });
    spinner.style.marginRight = '6px';

    const label = document.createElement('span');
    label.textContent = PAGE_CONTROL_STATUS_LABELS.running;

    statusElement.appendChild(spinner);
    statusElement.appendChild(label);
    applyStyles(statusElement, styles.pageControlsStatusRunning);
    return;
  }

  statusElement.textContent = PAGE_CONTROL_STATUS_LABELS[status] || status;
  applyStyles(
    statusElement,
    status === 'completed' ? styles.pageControlsStatusCompleted : styles.pageControlsStatusWaiting
  );
}

function createPageTranslationControls() {
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

  const progressText = document.createElement('div');
  progressText.id = 'llm-page-translation-progress';
  applyStyles(progressText, styles.pageControlsProgress);
  progressText.style.marginBottom = '6px';

  const barTrack = document.createElement('div');
  barTrack.setAttribute('aria-hidden', 'true');
  Object.assign(barTrack.style, {
    height: '6px',
    borderRadius: '999px',
    background: 'rgba(31, 91, 149, 0.18)',
    overflow: 'hidden',
    marginBottom: '8px'
  });

  const barFill = document.createElement('div');
  barFill.id = 'llm-page-translation-bar';
  Object.assign(barFill.style, {
    height: '100%',
    width: '0%',
    borderRadius: '999px',
    background: '#2f6fb3',
    transition: 'width 200ms ease, background-color 140ms ease'
  });
  barTrack.appendChild(barFill);

  const note = document.createElement('div');
  note.id = 'llm-page-translation-note';
  applyStyles(note, styles.pageControlsInfo);
  note.style.display = 'none';

  const row = document.createElement('div');
  applyStyles(row, styles.pageControlsRow);

  const retryBtn = document.createElement('button');
  retryBtn.id = 'llm-page-translation-retry';
  retryBtn.textContent = '失敗分を再試行';
  retryBtn.type = 'button';
  applyStyles(retryBtn, styles.pageControlsContinueBtn);
  retryBtn.onclick = handleRetryClick;

  const stopBtn = document.createElement('button');
  stopBtn.id = 'llm-page-translation-stop';
  stopBtn.textContent = '停止';
  stopBtn.type = 'button';
  applyStyles(stopBtn, styles.pageControlsStopBtn);
  stopBtn.onclick = handleStopClick;

  const closeBtn = document.createElement('button');
  closeBtn.id = 'llm-page-translation-close';
  closeBtn.textContent = '閉じる';
  closeBtn.type = 'button';
  applyStyles(closeBtn, styles.pageControlsStopBtn);
  closeBtn.onclick = () => hidePageTranslationControls();

  row.appendChild(retryBtn);
  row.appendChild(stopBtn);
  row.appendChild(closeBtn);

  wrap.appendChild(header);
  wrap.appendChild(progressText);
  wrap.appendChild(barTrack);
  wrap.appendChild(note);
  wrap.appendChild(row);
  document.body.appendChild(wrap);
  return wrap;
}

// 再試行は受理応答のみ待つ（進捗・完了は background からの push で更新される）。
function handleRetryClick() {
  const targetSnapshotId = pageTranslationControlsSnapshotId;
  if (!targetSnapshotId || !pageTranslationControls) return;

  const retryBtn = pageTranslationControls.querySelector('#llm-page-translation-retry');
  if (retryBtn) retryBtn.disabled = true;

  const sent = safeSendMessage(
    { action: 'continuePageTranslation', snapshotId: targetSnapshotId },
    (response) => {
      if (response?.ok) return; // 以降は push 更新
      // service worker 再起動などでセッションが失われた場合は再実行を促す
      console.warn('continuePageTranslation 失敗:', response?.error);
      renderSessionLost();
    }
  );
  if (!sent) renderSessionLost();
}

function handleStopClick() {
  const targetSnapshotId = pageTranslationControlsSnapshotId;
  if (!targetSnapshotId || !pageTranslationControls) return;

  const stopBtn = pageTranslationControls.querySelector('#llm-page-translation-stop');
  if (stopBtn) stopBtn.disabled = true;

  const sent = safeSendMessage(
    { action: 'cancelPageTranslation', snapshotId: targetSnapshotId },
    () => {
      // background が hidePageTranslationControls を送ってくる
    }
  );
  if (!sent) hidePageTranslationControls();
}

function renderSessionLost() {
  if (!pageTranslationControls) return;
  updateControlsView({
    status: 'lost',
    noteText: '翻訳セッションが失われました。ページ翻訳をやり直してください。'
  });
}

function renderControlsProgress(wrap, { status, processedItems, totalItems }) {
  const progressText = wrap.querySelector('#llm-page-translation-progress');
  const barFill = wrap.querySelector('#llm-page-translation-bar');
  const percent = totalItems > 0 ? Math.min(100, Math.floor((processedItems / totalItems) * 100)) : 0;

  if (progressText) {
    let text = '進捗: -';
    if (status === 'lost') text = '';
    else if (totalItems > 0) text = `進捗: ${percent}% (${processedItems}/${totalItems}項目)`;
    progressText.textContent = text;
  }

  if (barFill) {
    const colors = { partial: '#f08a24', lost: '#f08a24', completed: '#2e7d32' };
    barFill.style.width = `${percent}%`;
    barFill.style.background = colors[status] || '#2f6fb3';
  }
}

function renderControlsNote(wrap, { failedItems, noteText }) {
  const note = wrap.querySelector('#llm-page-translation-note');
  if (!note) return;
  const text = noteText || (failedItems > 0 ? `${failedItems}項目の翻訳に失敗しました（原文を表示中）` : '');
  note.textContent = text;
  note.style.display = text ? 'block' : 'none';
  note.style.color = text ? '#8b4a12' : '';
}

function renderControlsButtons(wrap, status) {
  const retryBtn = wrap.querySelector('#llm-page-translation-retry');
  const stopBtn = wrap.querySelector('#llm-page-translation-stop');
  const closeBtn = wrap.querySelector('#llm-page-translation-close');

  if (retryBtn) {
    retryBtn.style.display = status === 'partial' ? 'inline-block' : 'none';
    retryBtn.disabled = false;
    applyStyles(retryBtn, styles.pageControlsContinueBtn);
  }
  if (stopBtn) {
    stopBtn.style.display = status === 'running' ? 'inline-block' : 'none';
    stopBtn.disabled = false;
    applyStyles(stopBtn, styles.pageControlsStopBtn);
  }
  if (closeBtn) {
    closeBtn.style.display = status === 'running' ? 'none' : 'inline-block';
    applyStyles(closeBtn, styles.pageControlsStopBtn);
  }
}

function updateControlsView({
  status,
  processedItems = 0,
  totalItems = 0,
  failedItems = 0,
  noteText = ''
}) {
  const wrap = pageTranslationControls;
  if (!wrap) return;

  applyStyles(wrap, styles.pageControlsWrap);
  if (status === 'running') applyStyles(wrap, styles.pageControlsWrapRunning);
  else if (status === 'completed') applyStyles(wrap, styles.pageControlsWrapCompleted);
  else applyStyles(wrap, styles.pageControlsWrapWaiting);

  renderPageTranslationStatusChip(wrap.querySelector('#llm-page-translation-status'), status);
  renderControlsProgress(wrap, { status, processedItems, totalItems });
  renderControlsNote(wrap, { failedItems, noteText });
  renderControlsButtons(wrap, status);
}

// background からの状態 push を受けてパネルを更新する。
// message: { snapshotId, status, processedItems, totalItems, failedItems, ... }
function showPageTranslationControls(message = {}) {
  const { snapshotId, status = 'running', processedItems, totalItems, failedItems } = message;

  // 古いスナップショット宛の遅延 push は無視する
  if (
    pageTranslationControlsSnapshotId !== null &&
    snapshotId !== undefined &&
    snapshotId < pageTranslationControlsSnapshotId
  ) {
    return;
  }

  pageTranslationControlsSnapshotId = snapshotId ?? pageTranslationControlsSnapshotId;

  if (!pageTranslationControls) {
    pageTranslationControls = createPageTranslationControls();
  }

  if (pageTranslationAutoHideTimer) {
    clearTimeout(pageTranslationAutoHideTimer);
    pageTranslationAutoHideTimer = null;
  }

  updateControlsView({ status, processedItems, totalItems, failedItems });

  if (status === 'completed') {
    pageTranslationAutoHideTimer = setTimeout(() => hidePageTranslationControls(), 3000);
  }
}

function hidePageTranslationControls() {
  if (pageTranslationAutoHideTimer) {
    clearTimeout(pageTranslationAutoHideTimer);
    pageTranslationAutoHideTimer = null;
  }
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
