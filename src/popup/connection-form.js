import { mountPresetControls } from './connection-presets.js';
import {
  normalizeConnectionSettings, getConnectionPreset, connectionReasoningOptions,
  normalizeBaseUrl, getActiveConnection, CONNECTION_PRESETS, isSavedConnection
} from '../shared/connections.js';
import { DEFAULT_PROVIDER_MODELS } from '../shared/default-models.js';
import { populateModelSelect, fetchModelsViaBackground } from './models.js';

function comparableUrl(value) {
  try { return normalizeBaseUrl(value); } catch { return value.trim(); }
}

function renderConnectionFields(elements, connection, presetId, connections) {
  const { openaiPresetSelect: presetSelect, openaiServerInput: server, openaiApiKeyInput: key,
    openaiModelSelect: model, openaiReasoningSelect: reasoning, openaiStreamingInput: streaming } = elements;
  const preset = getConnectionPreset(presetId, connections);
  presetSelect.value = presetId;
  server.value = connection.baseUrl;
  key.value = connection.apiKey;
  const keyLabel = document.querySelector('label[for="openai-api-key"]');
  keyLabel.textContent = preset.needsApiKey ? 'APIキー' : 'APIキー（必要な場合のみ）';
  reasoning.replaceChildren(...connectionReasoningOptions(presetId, connections).map(([value, label]) => new Option(label, value)));
  reasoning.value = connection.reasoning;
  if (!reasoning.value) reasoning.value = 'default';
  reasoning.closest('.form-group').classList.toggle('hidden', reasoning.options.length === 1);
  streaming.checked = connection.streaming;
  model.value = '';
  populateModelSelect('openai', model, DEFAULT_PROVIDER_MODELS[connection.presetType || presetId] || [], connection.model);
}

export function createConnectionForm(elements, settings) {
  const normalized = normalizeConnectionSettings(settings);
  const connections = structuredClone(normalized.openaiConnections);
  let presetId = normalized.openaiPreset;
  let requestVersion = 0;
  let previousUrl = '';
  const { openaiPresetSelect: presetSelect, openaiServerInput: server, openaiApiKeyInput: key,
    openaiModelSelect: model, openaiReasoningSelect: reasoning, openaiStreamingInput: streaming } = elements;
  const refresh = document.getElementById('openai-refresh-models');
  const status = document.getElementById('openai-connection-status');

  function read() {
    return { ...connections[presetId], baseUrl: server.value.trim(), apiKey: key.value.trim(), model: model.value || '',
      reasoning: reasoning.value || 'default', streaming: streaming.checked };
  }

  function render() {
    const ids = [...Object.keys(CONNECTION_PRESETS), ...Object.keys(connections).filter(id => isSavedConnection(id, connections))];
    presetSelect.replaceChildren(...ids.map(id => new Option(getConnectionPreset(id, connections).label, id)));
    renderConnectionFields(elements, connections[presetId], presetId, connections);
    presetControls.update(isSavedConnection(presetId, connections));
    previousUrl = comparableUrl(server.value);
    status.textContent = '';
    refresh.disabled = false;
  }

  async function refreshModels() {
    const version = ++requestVersion;
    const connection = read();
    const fingerprint = JSON.stringify([connection.baseUrl, connection.apiKey]);
    try {
      normalizeBaseUrl(connection.baseUrl);
      refresh.disabled = true;
      status.textContent = 'モデル一覧を取得しています…';
      const models = await fetchModelsViaBackground('openai', { presetId, connection });
      if (version !== requestVersion) return;
      const current = read();
      if (fingerprint !== JSON.stringify([current.baseUrl, current.apiKey])) {
        status.textContent = '設定が変更されています。モデル一覧をもう一度取得してください。';
        return;
      }
      // 取得中に選んだモデルを維持し、そのモデルの最新情報を表示する。
      populateModelSelect('openai', model, models, current.model);
      status.textContent = models.length ? `${models.length}件のモデルを取得しました。` : '一覧は空です。モデルIDを直接入力できます。';
    } catch (error) {
      if (version === requestVersion) {
        populateModelSelect('openai', model, [], model.value);
        status.textContent = `${error.message || '一覧を取得できませんでした'} モデルIDは直接入力できます。`;
      }
    } finally {
      if (version === requestVersion) refresh.disabled = false;
    }
  }

  presetSelect.addEventListener('change', () => {
    connections[presetId] = read();
    presetId = presetSelect.value;
    requestVersion += 1;
    render();
    if (server.value.trim()) refreshModels();
  });
  server.addEventListener('input', () => {
    const nextUrl = comparableUrl(server.value);
    if (nextUrl === previousUrl) return;
    previousUrl = nextUrl;
    requestVersion += 1;
    refresh.disabled = false;
    if (key.value) {
      key.value = '';
      status.textContent = '接続先URLを変更したため、APIキーをクリアしました。必要なら入力してください。';
    } else status.textContent = '';
    populateModelSelect('openai', model, [], model.value);
  });
  key.addEventListener('input', () => {
    requestVersion += 1;
    refresh.disabled = false;
    status.textContent = '';
    populateModelSelect('openai', model, [], model.value);
  });
  refresh.addEventListener('click', refreshModels);
  const presetControls = mountPresetControls(presetSelect, {
    container: elements.openaiSection,
    add(value) {
      const name = value.trim();
      if (!name || name.length > 80) throw new Error('プリセット名を1〜80文字で入力してください。');
      const names = Object.keys(connections).map(id => getConnectionPreset(id, connections).label.toLowerCase());
      if (names.includes(name.toLowerCase())) throw new Error('同じ名前のプリセットがあります。別の名前を入力してください。');
      connections[presetId] = read();
      const connection = { ...connections[presetId], name, presetType: connections[presetId].presetType || presetId };
      presetId = `saved:${crypto.randomUUID()}`;
      connections[presetId] = connection;
      requestVersion += 1;
      render();
    },
    remove() {
      if (!isSavedConnection(presetId, connections)) return;
      const fallback = connections[presetId].presetType;
      delete connections[presetId];
      presetId = fallback;
      requestVersion += 1;
      render();
    }
  });
  render();

  return {
    collect() {
      return { openaiPreset: presetId, openaiConnections: { ...connections, [presetId]: read() } };
    },
    refreshModels,
    active() { return getActiveConnection({ apiProvider: 'openai', ...this.collect() }); }
  };
}
