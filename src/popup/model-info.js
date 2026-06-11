export function setupOrResetSelect2($select) {
  // Select2 は再描画時に重複 DOM が残るため、初期化済みなら一度破棄する。
  if ($select.data('select2')) {
    try { $select.select2('destroy'); } catch {}
  }
  const $parent = $select.closest('.api-section');
  $select.select2({
    placeholder: 'モデルを選択',
    allowClear: false,
    width: '100%',
    dropdownParent: $parent.length ? $parent : undefined,
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
  const infoElement = document.getElementById(`${provider}-model-info`);
  if (!infoElement || !modelData) return;

  while (infoElement.firstChild) infoElement.removeChild(infoElement.firstChild);

  const addLine = (text) => {
    if (!text) return;
    const div = document.createElement('div');
    div.textContent = text;
    infoElement.appendChild(div);
  };

  if (provider === 'openrouter') {
    const usdPer1MFormatter = new Intl.NumberFormat('en-US', { maximumFractionDigits: 6 });
    const pricePerTokenToPer1M = (value) => {
      if (value === undefined || value === null || value === '') return null;
      const perToken = Number(value);
      if (!Number.isFinite(perToken)) return null;
      return usdPer1MFormatter.format(perToken * 1_000_000);
    };

    addLine(`モデル: ${modelData.name}`);
    if (modelData.context_length) addLine(`コンテキスト長: ${modelData.context_length}`);
    const promptPer1M = pricePerTokenToPer1M(modelData.pricing?.prompt);
    const completionPer1M = pricePerTokenToPer1M(modelData.pricing?.completion);
    if (promptPer1M !== null) addLine(`入力料金: $${promptPer1M} / 1M tokens`);
    if (completionPer1M !== null) addLine(`出力料金: $${completionPer1M} / 1M tokens`);
  } else if (provider === 'gemini') {
    addLine(`モデル: ${modelData.name}`);
    if (modelData.context_length) addLine(`入力上限: ${modelData.context_length} tokens`);
  } else if (provider === 'cerebras') {
    addLine(`モデル: ${modelData.name || modelData.id}`);
    if (modelData.context_length) addLine(`コンテキスト長: ${modelData.context_length}`);
  } else if (provider === 'ollama' || provider === 'lmstudio' || provider === 'zai') {
    addLine(`モデル: ${modelData.name || modelData.id}`);
  }
}
