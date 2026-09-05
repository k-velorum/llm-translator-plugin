(() => {
  'use strict';

let pageTranslationSnapshot = { id: 0, nodes: [] };
let pageTranslationControls = null;
let pageTranslationControlsSnapshotId = null;
let pageTranslationAutoHideTimer = null;
let pageTranslationStatusTimer = null;
let pageTranslationControlsDismissed = false;
let pageTranslationViewVersion = 0;
const translatedNodes = new WeakMap();

function capturePageTextSnapshot() {
  // 再実行時に旧パネルや選択翻訳ポップアップなど拡張自身の UI が
  // 翻訳対象に混入するとパネルが破壊されるため、キャプチャ時に除外する。
  const nodes = DOMUtils.getTextNodes(document.body, { excludeExtensionUi: true }).filter((node) => {
    const parent = node.parentElement;
    return parent && !parent.isContentEditable && !parent.closest(
      'textarea, input, select, code, pre, [hidden], [aria-hidden="true"], [translate="no"], .notranslate'
    );
  });
  const texts = nodes.map((node) => {
    const previous = translatedNodes.get(node);
    return previous?.translated === node.nodeValue ? previous.original : node.nodeValue;
  });
  pageTranslationSnapshot = {
    // randomUUID は通常の HTTP ページでは使えないため getRandomValues を使う。
    id: crypto.getRandomValues(new Uint32Array(4)).join('-'),
    nodes,
    texts,
    expected: nodes.map((node) => node.nodeValue)
  };
  pageTranslationControlsDismissed = false;
  updateStatusPolling('reset');
  showPageTranslationControls({ snapshotId: pageTranslationSnapshot.id, status: 'running',
    processedItems: 0, totalItems: texts.length, noteText: '翻訳を準備しています…' });
  return { texts, snapshotId: pageTranslationSnapshot.id };
}

function applyPageTranslation(translations, snapshotId) {
  return applyPageTranslationChunk(snapshotId, 0, translations);
}

// snapshot の原文・直前の訳文と一致するノードだけに反映する。
// SPA がノードを再利用した場合に、別の記事や入力内容を上書きしない。
function applyPageTranslationChunk(snapshotId, offset = 0, translations = []) {
  if (!snapshotId || snapshotId !== pageTranslationSnapshot.id || pageTranslationControlsDismissed) {
    return { ok: false, error: '翻訳対象のページが変わりました' };
  }
  const { nodes, texts, expected } = pageTranslationSnapshot;
  if (!Number.isInteger(offset) || offset < 0 || offset + translations.length > nodes.length) {
    return { ok: false, error: '翻訳結果の範囲が一致しません' };
  }
  let skipped = 0;
  translations.forEach((translation, j) => {
    if (typeof translation !== 'string') return;
    const i = offset + j;
    const node = nodes[i];
    if (!node?.isConnected || node.nodeValue !== expected[i]) {
      skipped += 1;
      return;
    }
    const text = texts[i].match(/^\s*/)[0] + translation.trim() + texts[i].match(/\s*$/)[0];
    node.nodeValue = text;
    expected[i] = text;
    translatedNodes.set(node, { original: texts[i], translated: text });
  });
  return skipped > 0
    ? { ok: false, error: `${skipped}項目はページが更新されたため反映できませんでした` }
    : { ok: true };
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
  wrap.dataset.llmtUi = '';
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
  retryBtn.textContent = '未完了分を再試行';
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
  closeBtn.onclick = handleCloseClick;

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
      if (targetSnapshotId !== pageTranslationControlsSnapshotId) return;
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

  hidePageTranslationControls();

  const sent = safeSendMessage(
    { action: 'cancelPageTranslation', snapshotId: targetSnapshotId },
    () => {
      // background が hidePageTranslationControls を送ってくる
    }
  );
  if (!sent) hidePageTranslationControls();
}

function handleCloseClick() {
  const targetSnapshotId = pageTranslationControlsSnapshotId;
  // UI は即座に閉じる。partial の退避セッションは background に破棄を依頼し、
  // completed 等ですでに削除済みなら cancel 側が no-op になる。
  hidePageTranslationControls();
  if (!targetSnapshotId) return;
  safeSendMessage({ action: 'cancelPageTranslation', snapshotId: targetSnapshotId });
}

function renderSessionLost() {
  if (!pageTranslationControls) return;
  updateStatusPolling('lost');
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
  const text = noteText || (failedItems > 0 ? `${failedItems}項目の翻訳または反映が未完了です` : '');
  note.textContent = text;
  note.style.display = text ? 'block' : 'none';
  note.style.color = text ? '#8b4a12' : '';
}

function renderControlsButtons(wrap, status) {
  const retryBtn = wrap.querySelector('#llm-page-translation-retry');
  const stopBtn = wrap.querySelector('#llm-page-translation-stop');
  const closeBtn = wrap.querySelector('#llm-page-translation-close');

  if (retryBtn) {
    retryBtn.style.display = status === 'partial' || status === 'lost' ? 'inline-block' : 'none';
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
  const { snapshotId, status = 'running', processedItems, totalItems, failedItems,
    activeChunks = 0, elapsedSeconds = 0, noteText = '' } = message;

  // ナビゲーション・再実行・停止より前の通知はパネルを再表示しない。
  if (snapshotId !== pageTranslationSnapshot.id || pageTranslationControlsDismissed) return;
  pageTranslationViewVersion += 1;

  pageTranslationControlsSnapshotId = snapshotId ?? pageTranslationControlsSnapshotId;

  if (!pageTranslationControls) {
    pageTranslationControls = createPageTranslationControls();
  }

  if (pageTranslationAutoHideTimer) {
    clearTimeout(pageTranslationAutoHideTimer);
    pageTranslationAutoHideTimer = null;
  }

  const runningNote = activeChunks > 0
    ? `モデルの応答を待っています（${activeChunks}件処理中・${elapsedSeconds}秒経過）` : '';
  updateControlsView({ status, processedItems, totalItems, failedItems,
    noteText: noteText || (status === 'running' ? runningNote : '') });
  updateStatusPolling(status);

  if (status === 'completed') {
    pageTranslationAutoHideTimer = setTimeout(() => hidePageTranslationControls(), 3000);
  }
}

// push が途絶えた場合も storage のチェックポイントを問い合わせ、中断を表示する。
function updateStatusPolling(status) {
  if (status !== 'running') {
    pageTranslationViewVersion += 1;
    clearInterval(pageTranslationStatusTimer);
    pageTranslationStatusTimer = null;
    return;
  }
  if (pageTranslationStatusTimer) return;
  let waiting = false;
  pageTranslationStatusTimer = setInterval(() => {
    if (waiting) return;
    waiting = true;
    const snapshotId = pageTranslationControlsSnapshotId;
    const viewVersion = pageTranslationViewVersion;
    let expired = false;
    const isCurrent = () => pageTranslationControlsSnapshotId === snapshotId &&
      !pageTranslationControlsDismissed && viewVersion === pageTranslationViewVersion;
    const timeout = setTimeout(() => {
      expired = true;
      waiting = false;
      if (isCurrent()) renderSessionLost();
    }, 10000);
    safeSendMessage({ action: 'getPageTranslationStatus', snapshotId }, (response) => {
      clearTimeout(timeout);
      waiting = false;
      if (expired || !isCurrent()) return;
      if (!response?.ok) return renderSessionLost();
      if (!response.starting) showPageTranslationControls(response);
    });
  }, 10000);
}

function hidePageTranslationControls(snapshotId) {
  if (snapshotId !== undefined && snapshotId !== pageTranslationSnapshot.id) return;
  pageTranslationControlsDismissed = true;
  updateStatusPolling('closed');
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
