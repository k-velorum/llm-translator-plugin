export function setupOrResetSelect2($select) {
  // Select2 は再描画時に重複 DOM が残るため、初期化済みなら一度破棄する。
  if ($select.data('select2')) {
    try { $select.select2('destroy'); } catch {}
  }
  const $parent = $select.closest('.api-section');
  const defaultMatcher = $.fn.select2.defaults.defaults.matcher;
  $select.select2({
    placeholder: $select.attr('id') === 'openai-model' ? 'モデルを選択またはIDを入力' : 'モデルを選択',
    tags: $select.attr('id') === 'openai-model',
    allowClear: false,
    width: '100%',
    dropdownParent: $parent.length ? $parent : undefined,
    matcher: (params, data) => {
      const terms = (params.term || '').trim().split(/\s+/).filter(Boolean);
      // 標準の大文字小文字・アクセントの扱いを保ち、語ごとに候補を絞る。
      return terms.reduce((match, term) => (
        match ? defaultMatcher({ ...params, term }, match) : null
      ), data);
    },
    templateResult: formatModelOption,
    templateSelection: formatModelSelection,
    minimumResultsForSearch: 0
  });
}

export function formatModelOption(model) {
  if (!model.id) {
    return model.text;
  }

  const $option = $(model.element);
  const modelData = $option.data('model');

  if (!modelData) {
    return model.text;
  }

  if (modelData.id && modelData.name) {
    const $result = $('<div class="model-option"></div>');
    const $name = $('<div class="model-name"></div>').text(modelData.name);
    $result.append($name);
    return $result;
  }

  return model.text;
}

export function formatModelSelection(model) {
  if (!model || !model.id) return model.text || '';
  const $option = $(model.element);
  const modelData = $option.data('model');
  return (modelData && (modelData.name || modelData.id)) || model.text || '';
}

export function updateModelInfo(provider, modelData) {
  updateModelPricing(provider, modelData?.pricing);
  const infoElement = document.getElementById(`${provider}-model-info`);
  if (!infoElement) return;

  while (infoElement.firstChild) infoElement.removeChild(infoElement.firstChild);
  if (!modelData) return;

  const addLine = (text) => {
    if (!text) return;
    const div = document.createElement('div');
    div.textContent = text;
    infoElement.appendChild(div);
  };

  if (provider === 'openrouter' || provider === 'openai') {
    addLine(`モデル: ${modelData.name || modelData.id}`);
    if (modelData.context_length) addLine(`コンテキスト長: ${modelData.context_length}`);
  } else if (provider === 'gemini') {
    addLine(`モデル: ${modelData.name || modelData.id}`);
    if (modelData.context_length) addLine(`入力上限: ${modelData.context_length} tokens`);
  } else if (provider === 'cerebras') {
    addLine(`モデル: ${modelData.name || modelData.id}`);
    if (modelData.context_length) addLine(`コンテキスト長: ${modelData.context_length}`);
  } else if (provider === 'ollama' || provider === 'lmstudio' || provider === 'zai') {
    addLine(`モデル: ${modelData.name || modelData.id}`);
  }
}

function updateModelPricing(provider, pricing) {
  const element = document.getElementById(`${provider}-model-pricing`);
  if (!element) return;
  const formatter = new Intl.NumberFormat('en-US', { maximumSignificantDigits: 6 });
  const parts = [];
  for (const [key, label] of [['prompt', '入力'], ['completion', '出力']]) {
    const value = pricing?.[key];
    // 未取得・不正値を0ドルに変換しない。明示的な0だけ無料単価として表示する。
    if (typeof value !== 'number' && typeof value !== 'string') continue;
    if (typeof value === 'string' && !value.trim()) continue;
    const perMillion = Number(value) * 1_000_000;
    if (!Number.isFinite(perMillion) || perMillion < 0) continue;
    parts.push(`${label} $${formatter.format(perMillion)}`);
  }
  element.textContent = parts.length ? `${parts.join(' / ')}（100万トークンあたり）` : '';
}
