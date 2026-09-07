import { nanoAvailability, nanoInputOptions, NANO_DOWNLOAD_TIMEOUT_MS, nanoError, waitWithSignal } from '../shared/chrome-prompt.js';

const labels = {
  available: '利用可能', downloadable: '初回ダウンロードが必要です',
  downloading: 'ダウンロード中', unavailable: 'この環境では利用できません', unsupported: 'この Chrome は Prompt API に対応していません'
};

export function mountNanoPreparation(container, { canPrepare = false } = {}) {
  const rows = [];
  let disposed = false;
  let refreshing = false;
  for (const [kind, label] of [['text', 'テキスト'], ['image', '画像']]) {
    const row = document.createElement('div');
    row.className = 'form-group';
    const status = document.createElement('p');
    status.setAttribute('role', 'status');
    status.textContent = `${label}: 確認中…`;
    row.append(status);
    const state = { kind, label, status, controller: null, availability: null };
    if (canPrepare) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = `${label}モデルを準備`;
      button.disabled = true;
      const progress = document.createElement('progress');
      progress.max = 1;
      progress.hidden = true;
      progress.setAttribute('aria-label', `${label}モデルのダウンロード進捗`);
      state.button = button;
      state.progress = progress;
      button.addEventListener('click', () => {
        if (state.controller) { state.controller.abort(); return; }
        // user activation を失わないよう、create より前に非同期処理を挟まない。
        prepare(state);
      });
      row.append(button, progress);
    }
    rows.push(state);
    container.append(row);
  }
  if (!canPrepare) {
    const link = document.createElement('a');
    link.href = chrome.runtime.getURL('nano-setup.html');
    link.target = '_blank';
    link.rel = 'noopener';
    link.textContent = 'モデルを準備';
    container.append(link);
  }

  async function refresh() {
    if (disposed || refreshing) return;
    refreshing = true;
    try {
      await Promise.all(rows.map(async state => {
        if (state.controller) return;
        try {
          const availability = await nanoAvailability(state.kind);
          if (disposed || state.controller) return;
          state.availability = availability;
          state.status.textContent = `${state.label}: ${labels[availability] || availability}`;
          if (state.button) {
            state.button.disabled = !['downloadable', 'downloading'].includes(availability);
            state.button.textContent = availability === 'downloading' ? '進捗を表示' : `${state.label}モデルを準備`;
          }
        } catch (error) {
          state.status.textContent = `${state.label}: 状態を確認できませんでした (${error.message})`;
        }
      }));
    } finally { refreshing = false; }
  }

  async function prepare(state) {
    const controller = new AbortController();
    state.controller = controller;
    state.button.textContent = '中止';
    state.progress.hidden = false;
    state.progress.removeAttribute('value');
    state.status.textContent = `${state.label}: モデルを準備中…`;
    const timer = setTimeout(() => controller.abort(nanoError('NanoDownloadError', 'ダウンロードがタイムアウトしました。接続状況を確認して再試行してください。')), NANO_DOWNLOAD_TIMEOUT_MS);
    try {
      const creating = globalThis.LanguageModel.create({
        ...nanoInputOptions(state.kind), signal: controller.signal,
        monitor(monitor) {
          monitor.addEventListener('downloadprogress', event => {
            if (controller.signal.aborted || disposed) return;
            const loaded = Math.max(0, Math.min(1, event.loaded));
            state.progress.value = loaded;
            state.status.textContent = `${state.label}: ダウンロード中 ${Math.round(loaded * 100)}%`;
          });
        }
      });
      // 画面終了や中止と完了が競合してもセッションを残さない。
      const completed = Promise.resolve(creating).then(session => { session.destroy(); });
      await waitWithSignal(completed, controller.signal);
      state.status.textContent = `${state.label}: 利用可能`;
      state.button.disabled = true;
      state.availability = 'available';
    } catch (error) {
      state.status.textContent = controller.signal.aborted && controller.signal.reason?.name === 'AbortError'
        ? `${state.label}: 準備の待機を中止しました。再試行できます。`
        : `${state.label}: モデルの準備に失敗しました。${error.message}`;
    } finally {
      clearTimeout(timer);
      state.controller = null;
      state.button.textContent = `${state.label}モデルを準備`;
      state.progress.hidden = true;
    }
  }
  const dispose = () => { disposed = true; rows.forEach(state => state.controller?.abort()); };
  window.addEventListener('pagehide', dispose, { once: true });
  window.addEventListener('focus', refresh);
  const refreshButton = document.createElement('button');
  refreshButton.type = 'button';
  refreshButton.textContent = '状態を再確認';
  refreshButton.addEventListener('click', refresh);
  container.append(refreshButton);
  refresh();
  return { refresh, dispose };
}
