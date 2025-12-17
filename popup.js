document.addEventListener('DOMContentLoaded', init);

// 共通ユーティリティ関数
const PopupUtils = {
  // APIキー変更ハンドラーを作成
  createApiKeyChangeHandler(provider, apiKeyInput, modelSelect) {
    return async () => {
      const apiKey = apiKeyInput.value.trim();
      if (apiKey) {
        try {
          const models = await fetchModels(provider, apiKey);
          populateModelSelect(provider, modelSelect, models);
        } catch (error) {
          console.error('APIキー変更時のモデル一覧取得エラー:', error);
        }
      }
    };
  },

  // モデル選択復元処理
  restoreModelSelection(provider, modelSelect, modelValue) {
    if (!modelValue) return;
    
    setTimeout(() => {
      if (Array.from(modelSelect.options).some(opt => opt.value === modelValue)) {
        modelSelect.value = modelValue;
        
        // Select2の更新
        if (typeof jQuery !== 'undefined' && jQuery.fn.select2) {
          $(modelSelect).trigger('change');
          
          // モデル情報を更新
          const modelData = $(modelSelect).find(`option[value="${modelValue}"]`).data('model');
          if (modelData) {
            updateModelInfo(provider, modelData);
          }
        }
      }
    }, 500); // モデル一覧の読み込み完了を待つための遅延
  },

  // APIキーのバリデーションとエラーメッセージを取得
  validateApiKey(apiProvider, settings) {
    const validationRules = {
      openrouter: { key: 'openrouterApiKey', message: 'OpenRouter APIキーを入力してください' },
      gemini: { key: 'geminiApiKey', message: 'Gemini APIキーを入力してください' },
      // Ollama はAPIキー不要
    };
    
    const rule = validationRules[apiProvider];
    if (rule && !settings[rule.key]) {
      return { isValid: false, message: rule.message };
    }
    
    return { isValid: true, message: '' };
  }
};

function init() {
  const elements = getElements();
  initTabs(elements);
  setupApiProviderToggle(elements);
  createVerificationUI(elements);
  loadSettings(elements);
  bindEventHandlers(elements);
  initSelect2(elements);
  loadModels(elements);
}

// Select2の初期化
function initSelect2(elements) {
  // jQueryが読み込まれているか確認
  if (typeof jQuery !== 'undefined' && jQuery.fn.select2) {
    $('.model-select').each(function() {
      setupOrResetSelect2($(this));
    });
    
    // モデル選択時の処理
    $('#openrouter-model, #gemini-model, #ollama-model, #lmstudio-model').on('select2:select', function(e) {
      const provider = this.id.split('-')[0]; // openrouter または gemini
      const modelId = e.params.data.id;
      const modelData = $(this).find(`option[value="${modelId}"]`).data('model');
      if (modelData) {
        updateModelInfo(provider, modelData);
      }
    });
  } else {
    console.error('Select2またはjQueryが読み込まれていません');
  }
}

function setupOrResetSelect2($select) {
  // 既に初期化済みなら一旦破棄してから再初期化（重複DOM/当たり判定を排除）
  if ($select.data('select2')) {
    try { $select.select2('destroy'); } catch (e) {}
  }
  const $parent = $select.closest('.api-section');
  $select.select2({
    placeholder: 'モデルを選択',
    allowClear: false,
    width: '100%',
    dropdownParent: $parent.length ? $parent : undefined,
    templateResult: formatModelOption,
    templateSelection: formatModelSelection,
    // 検索を有効化（常時表示）
    minimumResultsForSearch: 0
  });
}

// モデルオプションの表示形式をカスタマイズ
function formatModelOption(model) {
  if (!model.id) {
    return model.text;
  }
  
  const $option = $(model.element);
  const modelData = $option.data('model');
  
  if (!modelData) {
    return model.text;
  }
  
  // モデルの場合
  if (modelData.id && modelData.name) {
    let $result = $('<div class="model-option"></div>');
    let $name = $('<div class="model-name"></div>').text(modelData.name);
    
    $result.append($name)
    return $result;
  }
  
  return model.text;
}

// 選択済み表示（セレクション）は素のテキストに固定
function formatModelSelection(model) {
  if (!model || !model.id) return model.text || '';
  const $option = $(model.element);
  const modelData = $option.data('model');
  return (modelData && (modelData.name || modelData.id)) || model.text || '';
}

// モデル情報の表示を更新
function updateModelInfo(provider, modelData) {
  const infoElement = document.getElementById(`${provider}-model-info`);
  if (!infoElement || !modelData) return;

  // 安全にDOMを構築（innerHTMLは使用しない）
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
      const per1M = perToken * 1_000_000;
      return usdPer1MFormatter.format(per1M);
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
  } else if (provider === 'ollama' || provider === 'lmstudio') {
    addLine(`モデル: ${modelData.name || modelData.id}`);
  }
}

// モデル一覧の読み込み
function loadModels(elements) {
  ['openrouter', 'gemini', 'ollama', 'lmstudio'].forEach(p => loadProviderModels(p, elements));
}

// 特定プロバイダーのモデル一覧を読み込む
function loadProviderModels(provider, elements) {
  const modelSelect = elements[`${provider}ModelSelect`];

  if (provider === 'ollama') {
    chrome.storage.sync.get(['ollamaServer', 'ollamaModel'], async (settings) => {
      const server = settings.ollamaServer || 'http://localhost:11434';
      try {
        const models = await fetchModels(provider, { server });
        populateModelSelect(provider, modelSelect, models, settings.ollamaModel || '');
      } catch (error) {
        console.info('Ollamaモデル一覧の取得に失敗:', error);
        // 失敗時は空のまま
      }
    });
    return;
  }

  if (provider === 'lmstudio') {
    chrome.storage.sync.get(['lmstudioServer', 'lmstudioApiKey', 'lmstudioModel'], async (settings) => {
      const server = settings.lmstudioServer || 'http://localhost:1234';
      const apiKey = settings.lmstudioApiKey || '';
      try {
        const models = await fetchModels(provider, { server, apiKey });
        populateModelSelect(provider, modelSelect, models, settings.lmstudioModel || '');
      } catch (error) {
        console.info('LM Studioモデル一覧の取得に失敗:', error);
        // 失敗時は空のまま
      }
    });
    return;
  }

  const apiKeyKey = `${provider}ApiKey`;
  const modelKey = `${provider}Model`;
  // 保存されているAPIキーを取得
  chrome.storage.sync.get([apiKeyKey, modelKey], async (settings) => {
    if (settings[apiKeyKey]) {
      try {
        const models = await fetchModels(provider, { apiKey: settings[apiKeyKey] });
        populateModelSelect(provider, modelSelect, models, settings[modelKey] || '');
      } catch (error) {
        console.error(`${provider}モデル一覧の取得に失敗:`, error);
        // エラー時はデフォルトモデルを設定
        setDefaultModels(provider, modelSelect);
      }
    } else {
      // APIキーがない場合はデフォルトモデルを設定
      setDefaultModels(provider, modelSelect);

      // OpenRouterの場合は公開APIからモデル一覧を取得
      if (provider === 'openrouter') {
        try {
          const models = await fetchModels(provider);
          populateModelSelect(provider, modelSelect, models, settings[modelKey] || '');
        } catch (error) {
          console.error('公開APIからのOpenRouterモデル一覧の取得に失敗:', error);
        }
      }
    }
  });
}

// モデル一覧を取得（常にバックグラウンド経由）
async function fetchModels(provider, options) {
  try {
    return await fetchModelsViaBackground(provider, options);
  } catch (error) {
    const isLocal = provider === 'ollama' || provider === 'lmstudio';
    if (isLocal) {
      console.info(`${provider}モデル取得エラー:`, error);
    } else {
      console.error(`${provider}モデル取得エラー:`, error);
    }
    throw error;
  }
}

// バックグラウンド経由でモデル一覧を取得
function fetchModelsViaBackground(provider, options) {
  return new Promise((resolve, reject) => {
    const payload = { action: `get${provider.charAt(0).toUpperCase() + provider.slice(1)}Models` };
    if (options) {
      if (typeof options === 'string') {
        payload.apiKey = options;
      } else {
        if (options.apiKey) payload.apiKey = options.apiKey;
        if (options.server) payload.server = options.server;
      }
    }
    chrome.runtime.sendMessage(
      payload,
      response => {
        if (chrome.runtime.lastError) {
          return reject(new Error(`バックグラウンドスクリプトエラー: ${chrome.runtime.lastError.message}`));
        }
        if (response.error) {
          return reject(new Error(response.error.message || 'モデル取得エラー'));
        }
        resolve(response.models || []);
      }
    );
  });
}

// モデル選択要素にモデル一覧をセット
function populateModelSelect(provider, selectElement, models, preferredValue = '') {
  // 現在選択されているモデルを保存
  const selectedModel = selectElement.value;
  
  // 既存のオプションをクリア
  selectElement.innerHTML = '';
  
  if (models && models.length > 0) {
    // 取得したモデルでオプションを生成
    // プレースホルダー（空）を先頭に追加して、未選択状態を維持できるようにする
    const emptyOption = document.createElement('option');
    emptyOption.value = '';
    emptyOption.textContent = '';
    selectElement.appendChild(emptyOption);

    models.forEach(model => {
      const option = document.createElement('option');
      option.value = model.id;
      option.textContent = `${model.name || model.id} (${model.id})`;
      
      // モデルデータをdata属性に保存
      $(option).data('model', model);
      
      selectElement.appendChild(option);
    });

    // 前回選択していたモデルがあれば選択状態を復元
    let valueToSet = '';
    const hasPreferred = preferredValue && Array.from(selectElement.options).some(opt => opt.value === preferredValue);
    const hasPrev = selectedModel && Array.from(selectElement.options).some(opt => opt.value === selectedModel);
    if (hasPreferred) {
      valueToSet = preferredValue;
    } else if (hasPrev) {
      valueToSet = selectedModel;
    }
    if (valueToSet) selectElement.value = valueToSet;

    if (typeof jQuery !== 'undefined' && jQuery.fn.select2) {
      // DOMをクリーンにするため再初期化（選択値設定後に行う）
      setupOrResetSelect2($(selectElement));
      if (valueToSet) {
        $(selectElement).trigger('change');
        const modelData = $(selectElement).find(`option[value="${valueToSet}"]`).data('model');
        if (modelData) updateModelInfo(provider, modelData);
      }
    }
  } else {
    // モデルが取得できない場合はデフォルトモデルをセット
    setDefaultModels(provider, selectElement);
  }
}

// デフォルトのモデルをセット
function setDefaultModels(provider, selectElement) {
  const defaultModels = {
    openrouter: [
      { id: 'openai/gpt-4o-mini', name: 'GPT 4o mini' },
      { id: 'anthropic/claude-3.5-haiku', name: 'Claude 3.5 Haiku' },
      { id: 'anthropic/claude-3.7-sonnet', name: 'Claude 3.7 Sonnet' }
    ],

  };
  
  // 現在選択されているモデルを保存
  const selectedModel = selectElement.value;
  
  // 既存のオプションをクリア
  selectElement.innerHTML = '';
  
  // デフォルトモデルでオプションを生成
  if (defaultModels[provider]) {
    // プレースホルダー（空）
    const emptyOption = document.createElement('option');
    emptyOption.value = '';
    emptyOption.textContent = '';
    selectElement.appendChild(emptyOption);

    defaultModels[provider].forEach(model => {
    const option = document.createElement('option');
    option.value = model.id;
    option.textContent = model.name;
    
    // モデルデータをdata属性に保存
    $(option).data('model', model);
    
    selectElement.appendChild(option);
  });
  }
  
  // 前回選択していたモデルがあれば選択状態を復元
  if (selectedModel && Array.from(selectElement.options).some(opt => opt.value === selectedModel)) {
    selectElement.value = selectedModel;
    
    // Select2の更新
    if (typeof jQuery !== 'undefined' && jQuery.fn.select2) {
      $(selectElement).trigger('change');
    }
  }
}

function getElements() {
  return {
    // 設定用フォーム要素
    apiProviderSelect: document.getElementById('api-provider'),
    openrouterSection: document.getElementById('openrouter-section'),
    geminiSection: document.getElementById('gemini-section'),
    ollamaSection: document.getElementById('ollama-section'),
    lmstudioSection: document.getElementById('lmstudio-section'),
    openrouterApiKeyInput: document.getElementById('openrouter-api-key'),
    openrouterModelSelect: document.getElementById('openrouter-model'),
    geminiApiKeyInput: document.getElementById('gemini-api-key'),
    geminiModelSelect: document.getElementById('gemini-model'),
    ollamaServerInput: document.getElementById('ollama-server'),
    ollamaModelSelect: document.getElementById('ollama-model'),
    lmstudioServerInput: document.getElementById('lmstudio-server'),
    lmstudioApiKeyInput: document.getElementById('lmstudio-api-key'),
    lmstudioModelSelect: document.getElementById('lmstudio-model'),
    saveButton: document.getElementById('save-button'),
    statusMessage: document.getElementById('status-message'),
    featureStatusMessage: document.getElementById('feature-status-message'),
    // 機能タブ要素
    twitterFeatureCheckbox: document.getElementById('enable-twitter-translation'),
    youtubeFeatureCheckbox: document.getElementById('enable-youtube-translation'),
    featureSaveButton: document.getElementById('feature-save-button'),
    translationSystemPromptTextarea: document.getElementById('translation-system-prompt'),
    resetSystemPromptButton: document.getElementById('reset-system-prompt'),
    // 詳細設定（高度）
    advancedToggleButton: document.getElementById('toggle-advanced-settings'),
    advancedBody: document.getElementById('advanced-settings-body'),
    pageTranslationMaxCharsInput: document.getElementById('page-translation-max-chars'),
    pageTranslationMaxItemsInput: document.getElementById('page-translation-max-items'),
    pageTranslationChunksPerPassInput: document.getElementById('page-translation-chunks-per-pass'),
    pageTranslationDelayMsInput: document.getElementById('page-translation-delay-ms'),
    pageTranslationSeparatorInput: document.getElementById('page-translation-separator'),
    // テスト用要素
    testApiProviderSelect: document.getElementById('test-api-provider'),
    testTextArea: document.getElementById('test-text'),
    testButton: document.getElementById('test-button'),
    testStatus: document.getElementById('test-status'),
    testResult: document.getElementById('test-result'),
    // タブ用要素
    tabs: document.querySelectorAll('.tab'),
    tabContents: document.querySelectorAll('.tab-content')
  };
}

function initTabs({ tabs, tabContents }) {
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const tabId = tab.getAttribute('data-tab');
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      tabContents.forEach(content => {
        content.classList.toggle('active', content.id === `${tabId}-tab`);
      });
    });
  });
}

function setupApiProviderToggle({ apiProviderSelect, openrouterSection, geminiSection, ollamaSection, lmstudioSection }) {
  apiProviderSelect.addEventListener('change', () => {
    const sections = { openrouter: openrouterSection, gemini: geminiSection, ollama: ollamaSection, lmstudio: lmstudioSection };
    
    // すべてのセクションを非表示にする
    Object.values(sections).forEach(section => section.classList.add('hidden'));
    
    // 選択されたプロバイダーのセクションを表示する
    sections[apiProviderSelect.value].classList.remove('hidden');
  });
}

function createVerificationUI(elements) {
  createProviderVerificationUI('openrouter', elements.openrouterApiKeyInput);
  createProviderVerificationUI('gemini', elements.geminiApiKeyInput);
}

// APIキー検証UI作成の共通関数
function createProviderVerificationUI(provider, apiKeyInput) {
  const container = document.createElement('div');
  container.style.marginTop = '10px';
  container.style.display = 'flex';
  container.style.justifyContent = 'space-between';
  container.style.alignItems = 'center';

  const keyStatus = document.createElement('span');
  keyStatus.style.fontSize = '12px';
  keyStatus.style.color = '#666';
  keyStatus.textContent = '';

  const verifyButton = document.createElement('button');
  verifyButton.textContent = 'APIキーを検証';
  verifyButton.style.padding = '5px 10px';
  verifyButton.style.fontSize = '12px';
  verifyButton.style.backgroundColor = '#34a853';
  verifyButton.style.width = 'auto';

  verifyButton.addEventListener('click', async () => {
    const apiKey = apiKeyInput.value.trim();
    const elements = getElements();
    const modelSelect = elements[`${provider}ModelSelect`];
    
    await verifyApiKey(provider, apiKey, keyStatus, verifyButton);
    
    // APIキー検証が成功したら、そのAPIキーでモデル一覧も更新
    if (keyStatus.textContent.includes('✓')) {
      try {
        const models = await fetchModels(provider, apiKey);
        populateModelSelect(provider, modelSelect, models);
      } catch (error) {
        console.error('モデル一覧の更新に失敗:', error);
      }
    }
  });

  container.appendChild(keyStatus);
  container.appendChild(verifyButton);
  apiKeyInput.parentNode.appendChild(container);
}

function bindEventHandlers(elements) {
  const { saveButton, featureSaveButton, testButton, openrouterApiKeyInput, openrouterModelSelect, geminiApiKeyInput, geminiModelSelect, ollamaServerInput, ollamaModelSelect, lmstudioServerInput, lmstudioApiKeyInput, lmstudioModelSelect, advancedToggleButton, advancedBody, resetSystemPromptButton, translationSystemPromptTextarea } = elements;
  
  saveButton.addEventListener('click', () => saveSettings(elements));
  if (featureSaveButton) featureSaveButton.addEventListener('click', () => saveFeatureSettings(elements));
  testButton.addEventListener('click', () => testApi(elements));
  
  // APIキーが変更されたときにモデル一覧を更新
  openrouterApiKeyInput.addEventListener('change', 
    PopupUtils.createApiKeyChangeHandler('openrouter', openrouterApiKeyInput, openrouterModelSelect));
    
  geminiApiKeyInput.addEventListener('change', 
    PopupUtils.createApiKeyChangeHandler('gemini', geminiApiKeyInput, geminiModelSelect));

  // Ollama サーバーが変更されたらモデル一覧を更新
  ollamaServerInput.addEventListener('change', async () => {
    const server = ollamaServerInput.value.trim() || 'http://localhost:11434';
    try {
      const models = await fetchModels('ollama', { server });
      populateModelSelect('ollama', ollamaModelSelect, models);
    } catch (error) {
      console.error('Ollamaモデル一覧の取得に失敗:', error);
    }
  });

  // LM Studio サーバー/APIキー変更でモデル一覧を更新
  const refreshLmstudioModels = async () => {
    const server = lmstudioServerInput.value.trim() || 'http://localhost:1234';
    const apiKey = lmstudioApiKeyInput.value.trim();
    try {
      const models = await fetchModels('lmstudio', { server, apiKey });
      populateModelSelect('lmstudio', lmstudioModelSelect, models);
    } catch (error) {
      console.error('LM Studioモデル一覧の取得に失敗:', error);
    }
  };
  lmstudioServerInput.addEventListener('change', refreshLmstudioModels);
  lmstudioApiKeyInput.addEventListener('change', refreshLmstudioModels);

  // 高度な設定の開閉
  if (advancedToggleButton && advancedBody) {
    advancedToggleButton.addEventListener('click', () => {
      advancedBody.classList.toggle('hidden');
    });
  }

  // プロンプトをデフォルトに戻す
  if (resetSystemPromptButton) {
    resetSystemPromptButton.addEventListener('click', () => {
      const DEFAULT_PROMPT = '指示された文章を日本語に翻訳してください。翻訳結果のみを出力してください。特殊区切りトークン [[[SEP]]] が含まれる場合、それらは絶対に削除・翻訳・変更せず、そのまま出力に保持してください。トークンの数と順序も厳密に維持してください。';
      if (translationSystemPromptTextarea) translationSystemPromptTextarea.value = DEFAULT_PROMPT;
    });
  }
}

// 機能タブの設定保存（Twitter / YouTube 有効化）
function saveFeatureSettings({ twitterFeatureCheckbox, youtubeFeatureCheckbox, featureStatusMessage, translationSystemPromptTextarea }) {
  // 数値入力のユーティリティ
  const num = (el, def, min, max) => {
    if (!el) return def;
    const v = parseInt((el.value || '').toString(), 10);
    if (isNaN(v)) return def;
    if (typeof min === 'number' && v < min) return min;
    if (typeof max === 'number' && v > max) return max;
    return v;
  };

  // DOM取得
  const els = getElements();

  const partial = {
    enableTwitterTranslation: !!(twitterFeatureCheckbox && twitterFeatureCheckbox.checked),
    enableYoutubeTranslation: !!(youtubeFeatureCheckbox && youtubeFeatureCheckbox.checked),
    translationSystemPrompt: (translationSystemPromptTextarea?.value || '').trim(),
    pageTranslationMaxChars: num(els.pageTranslationMaxCharsInput, 3500, 500, 32000),
    pageTranslationMaxItemsPerChunk: num(els.pageTranslationMaxItemsInput, 50, 5, 500),
    pageTranslationChunksPerPass: num(els.pageTranslationChunksPerPassInput, 6, 1, 100),
    pageTranslationDelayMs: num(els.pageTranslationDelayMsInput, 400, 0, 60000),
    pageTranslationSeparator: ((els.pageTranslationSeparatorInput?.value || '[[[SEP]]]').trim() || '[[[SEP]]]')
  };
  // 空ならデフォルトを保存（空文字を避ける）
  if (!partial.translationSystemPrompt) {
    partial.translationSystemPrompt = '指示された文章を日本語に翻訳してください。翻訳結果のみを出力してください。特殊区切りトークン [[[SEP]]] が含まれる場合、それらは絶対に削除・翻訳・変更せず、そのまま出力に保持してください。トークンの数と順序も厳密に維持してください。';
  }
  chrome.storage.sync.set(partial, () => {
    const target = featureStatusMessage || document.getElementById('feature-status-message') || document.getElementById('status-message');
    showStatus(target, '機能設定を保存しました', true);
  });
}

// APIキー検証処理（常にバックグラウンド経由）
async function verifyApiKey(provider, apiKey, statusElem, buttonElem) {
  if (!apiKey) {
    statusElem.textContent = 'APIキーを入力してください';
    statusElem.style.color = '#d32f2f';
    return;
  }
  buttonElem.disabled = true;
  statusElem.textContent = '検証中...';
  statusElem.style.color = '#666';

  try {
    await verifyApiKeyViaBackground(provider, apiKey);
    statusElem.textContent = '✓ APIキーは有効です';
    statusElem.style.color = '#155724';

    // モデル一覧を更新
    const models = await fetchModelsViaBackground(provider, apiKey);
    const elements = getElements();
    const modelSelect = elements[`${provider}ModelSelect`];
    populateModelSelect(provider, modelSelect, models);
  } catch (error) {
    console.error('APIキー検証エラー:', error);
    statusElem.textContent = `✗ APIキー検証失敗: ${error.message || 'ネットワークエラー'}`;
    statusElem.style.color = '#d32f2f';
  } finally {
    buttonElem.disabled = false;
  }
}

// バックグラウンド経由でAPIキーを検証
function verifyApiKeyViaBackground(provider, apiKey) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      {
        action: `verify${provider.charAt(0).toUpperCase() + provider.slice(1)}ApiKey`,
        apiKey: apiKey
      },
      response => {
        if (chrome.runtime.lastError) {
          return reject(new Error(`バックグラウンドスクリプトエラー: ${chrome.runtime.lastError.message}`));
        }
        if (response.error) {
          return reject(new Error(response.error.message || 'APIキー検証エラー'));
        }
        resolve(response.result);
      }
    );
  });
}

// 設定の読み込み
function loadSettings({ 
  apiProviderSelect, 
  openrouterApiKeyInput, 
  openrouterModelSelect, 
  geminiApiKeyInput, 
  geminiModelSelect, 
  openrouterSection, 
  geminiSection,
  ollamaSection,
  ollamaServerInput,
  ollamaModelSelect,
  lmstudioSection,
  lmstudioServerInput,
  lmstudioApiKeyInput,
  lmstudioModelSelect,
  twitterFeatureCheckbox,
  youtubeFeatureCheckbox
}) {
  chrome.storage.sync.get(
    null,
    settings => {
      apiProviderSelect.value = settings.apiProvider;
      openrouterApiKeyInput.value = settings.openrouterApiKey;
      openrouterModelSelect.value = settings.openrouterModel;
      geminiApiKeyInput.value = settings.geminiApiKey;
      geminiModelSelect.value = settings.geminiModel;
      ollamaServerInput.value = settings.ollamaServer || 'http://localhost:11434';
      ollamaModelSelect.value = settings.ollamaModel || '';
      lmstudioServerInput.value = settings.lmstudioServer || 'http://localhost:1234';
      lmstudioApiKeyInput.value = settings.lmstudioApiKey || '';
      lmstudioModelSelect.value = settings.lmstudioModel || '';

      // 機能オン/オフの復元（デフォルトtrue）
      if (twitterFeatureCheckbox) twitterFeatureCheckbox.checked = settings.enableTwitterTranslation !== false;
      if (youtubeFeatureCheckbox) youtubeFeatureCheckbox.checked = settings.enableYoutubeTranslation !== false;

      // 翻訳システムプロンプトの復元
      try {
        const els = getElements();
        const defaultPrompt = '指示された文章を日本語に翻訳してください。翻訳結果のみを出力してください。特殊区切りトークン [[[SEP]]] が含まれる場合、それらは絶対に削除・翻訳・変更せず、そのまま出力に保持してください。トークンの数と順序も厳密に維持してください。';
        if (els.translationSystemPromptTextarea) {
          els.translationSystemPromptTextarea.value = (settings.translationSystemPrompt || defaultPrompt);
        }
      } catch (e) {
        console.warn('翻訳システムプロンプトの復元に失敗:', e);
      }

      // 詳細設定（高度）の復元
      try {
        const els = getElements();
        if (els.pageTranslationMaxCharsInput) els.pageTranslationMaxCharsInput.value = (settings.pageTranslationMaxChars ?? 3500);
        if (els.pageTranslationMaxItemsInput) els.pageTranslationMaxItemsInput.value = (settings.pageTranslationMaxItemsPerChunk ?? 50);
        if (els.pageTranslationChunksPerPassInput) els.pageTranslationChunksPerPassInput.value = (settings.pageTranslationChunksPerPass ?? 6);
        if (els.pageTranslationDelayMsInput) els.pageTranslationDelayMsInput.value = (settings.pageTranslationDelayMs ?? 400);
        if (els.pageTranslationSeparatorInput) els.pageTranslationSeparatorInput.value = (settings.pageTranslationSeparator ?? '[[[SEP]]]');
      } catch (e) {
        console.warn('詳細設定の復元に失敗:', e);
      }
      
      // APIプロバイダーに応じたセクションの表示制御
      const sections = {
        openrouter: openrouterSection,
        gemini: geminiSection,
        ollama: ollamaSection,
        lmstudio: lmstudioSection
      };
      
      // すべてのセクションを非表示にする
      Object.values(sections).forEach(section => section.classList.add('hidden'));
      
      // 選択されたプロバイダーのセクションを表示する
      sections[settings.apiProvider].classList.remove('hidden');
      
      // モデルの選択状態を復元
      PopupUtils.restoreModelSelection('openrouter', openrouterModelSelect, settings.openrouterModel);
      PopupUtils.restoreModelSelection('ollama', ollamaModelSelect, settings.ollamaModel);
      PopupUtils.restoreModelSelection('lmstudio', lmstudioModelSelect, settings.lmstudioModel);
    }
  );
}

// 設定の保存
function saveSettings({ apiProviderSelect, openrouterApiKeyInput, openrouterModelSelect, geminiApiKeyInput, geminiModelSelect, ollamaServerInput, ollamaModelSelect, lmstudioServerInput, lmstudioApiKeyInput, lmstudioModelSelect, statusMessage, twitterFeatureCheckbox, youtubeFeatureCheckbox }) {
  const settings = {
    apiProvider: apiProviderSelect.value,
    openrouterApiKey: openrouterApiKeyInput.value.trim(),
    openrouterModel: openrouterModelSelect.value,
    geminiApiKey: geminiApiKeyInput.value.trim(),
    geminiModel: geminiModelSelect.value,
    ollamaServer: ollamaServerInput.value.trim() || 'http://localhost:11434',
    ollamaModel: ollamaModelSelect.value,
    lmstudioServer: lmstudioServerInput.value.trim() || 'http://localhost:1234',
    lmstudioApiKey: lmstudioApiKeyInput.value.trim(),
    lmstudioModel: lmstudioModelSelect.value
  };

  // 機能タブの値も併せて保存（存在する場合）
  if (twitterFeatureCheckbox) settings.enableTwitterTranslation = !!twitterFeatureCheckbox.checked;
  if (youtubeFeatureCheckbox) settings.enableYoutubeTranslation = !!youtubeFeatureCheckbox.checked;

  const validation = PopupUtils.validateApiKey(settings.apiProvider, settings);
  
  if (!validation.isValid) {
    showStatus(statusMessage, validation.message, false);
    return;
  }
  
  chrome.storage.sync.set(settings, () => {
    showStatus(statusMessage, '設定を保存しました', true);
  });
}

// APIテスト処理（実際の翻訳処理を利用）
function testApi(elements) {
  const { testApiProviderSelect, testTextArea, testButton, testStatus, testResult } = elements;
  const apiProvider = testApiProviderSelect.value;
  const testText = testTextArea.value.trim();
  if (!testText) {
    showStatus(testStatus, 'テスト文章を入力してください', false);
    return;
  }
  chrome.storage.sync.get(
    null,
    async settings => {
      let providerSettings;
      if (apiProvider === 'openrouter') {
        if (!settings.openrouterApiKey) {
          showStatus(testStatus, 'OpenRouter APIキーが設定されていません', false);
          testButton.disabled = false;
          return;
        }
        providerSettings = {
          apiProvider: 'openrouter',
          openrouterApiKey: settings.openrouterApiKey,
          openrouterModel: settings.openrouterModel
        };
      } else if (apiProvider === 'gemini') {
        if (!settings.geminiApiKey) {
          showStatus(testStatus, 'Gemini APIキーが設定されていません', false);
          testButton.disabled = false;
          return;
        }
        providerSettings = {
          apiProvider: 'gemini',
          geminiApiKey: settings.geminiApiKey,
          geminiModel: settings.geminiModel
        };
      } else if (apiProvider === 'ollama') {
        if (!settings.ollamaModel) {
          showStatus(testStatus, 'Ollamaのモデルが設定されていません', false);
          testButton.disabled = false;
          return;
        }
        providerSettings = {
          apiProvider: 'ollama',
          ollamaServer: settings.ollamaServer || 'http://localhost:11434',
          ollamaModel: settings.ollamaModel
        };
      } else if (apiProvider === 'lmstudio') {
        if (!settings.lmstudioModel) {
          showStatus(testStatus, 'LM Studio のモデルが設定されていません', false);
          testButton.disabled = false;
          return;
        }
        providerSettings = {
          apiProvider: 'lmstudio',
          lmstudioServer: settings.lmstudioServer || 'http://localhost:1234',
          lmstudioApiKey: settings.lmstudioApiKey || '',
          lmstudioModel: settings.lmstudioModel
        };
      }
      
      try {
        testButton.disabled = true;
        showStatus(testStatus, 'テスト中...', true);
        testResult.classList.add('hidden');
        chrome.runtime.sendMessage(
          {
            action: 'testTranslate',
            text: testText,
            settings: providerSettings
          },
          response => {
            if (chrome.runtime.lastError) {
              showStatus(testStatus, `エラー: ${chrome.runtime.lastError.message}`, false);
              testResult.textContent = '';
              testResult.classList.remove('hidden');
            } else if (response.error) {
              showStatus(testStatus, `エラー: ${response.error.message}`, false);
              testResult.textContent = response.error.details || '';
              testResult.classList.remove('hidden');
            } else {
              showStatus(testStatus, 'テスト成功！', true);
              testResult.textContent = response.result;
              testResult.classList.remove('hidden');
            }
            testButton.disabled = false;
          }
        );
      } catch (error) {
        console.error('APIテストエラー:', error);
        showStatus(testStatus, `エラー: ${error.message}`, false);
        testResult.textContent = error.stack || 'スタックトレース情報なし';
        testResult.classList.remove('hidden');
        testButton.disabled = false;
      }
    }
  );
}

function showStatus(element, message, isSuccess) {
  element.textContent = message;
  element.classList.remove('hidden', 'success', 'error');
  element.classList.add(isSuccess ? 'success' : 'error');
  if (isSuccess) {
    setTimeout(() => element.classList.add('hidden'), 3000);
  }
}
