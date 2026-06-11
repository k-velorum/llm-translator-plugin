import {
  DEFAULT_PAGE_TRANSLATION_SEPARATOR_PROMPT,
  DEFAULT_TRANSLATION_SYSTEM_PROMPT,
  LEGACY_COMBINED_TRANSLATION_SYSTEM_PROMPT
} from '../background/settings.js';
import {
  MODEL_PROVIDER_IDS,
  PROVIDER_ORDER,
  getProviderSections,
  getProviderUi
} from './provider-ui.js';

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
    const provider = getProviderUi(apiProvider);
    const apiKeyKey = provider?.settingsKeys?.apiKey;
    if (provider?.needsApiKey && apiKeyKey && !settings[apiKeyKey]) {
      return { isValid: false, message: provider.validationMessage };
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
  bindLogHandlers(elements);
  initSelect2();
  loadModels(elements);

  // 初期表示
  refreshLogs(elements);
}

// Select2の初期化
function initSelect2() {
  // jQueryが読み込まれているか確認
  if (typeof jQuery !== 'undefined' && jQuery.fn.select2) {
    $('.model-select').each(function() {
      setupOrResetSelect2($(this));
    });
    
    // モデル選択時の処理
    $(MODEL_PROVIDER_IDS.map((provider) => `#${provider}-model`).join(', ')).on('select2:select', function(event) {
      const provider = this.id.split('-')[0];
      const modelId = event.params.data.id;
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
  } else if (provider === 'cerebras') {
    addLine(`モデル: ${modelData.name || modelData.id}`);
    if (modelData.context_length) addLine(`コンテキスト長: ${modelData.context_length}`);
  } else if (provider === 'ollama' || provider === 'lmstudio' || provider === 'zai') {
    addLine(`モデル: ${modelData.name || modelData.id}`);
  }
}

// モデル一覧の読み込み
function loadModels(elements) {
  MODEL_PROVIDER_IDS.forEach(p => loadProviderModels(p, elements));
}

// 特定プロバイダーのモデル一覧を読み込む
function loadProviderModels(provider, elements) {
  const providerConfig = getProviderUi(provider);
  const modelSelect = elements[providerConfig?.elements?.model];
  console.info('[popup] loadProviderModels:start', {
    provider,
    hasModelSelect: Boolean(modelSelect)
  });

  if (!providerConfig || !modelSelect) return;

  const { settingsKeys } = providerConfig;

  if (providerConfig.staticModelsOnly) {
    chrome.storage.sync.get([settingsKeys.model], (settings) => {
      setDefaultModels(provider, modelSelect);
      PopupUtils.restoreModelSelection(provider, modelSelect, settings[settingsKeys.model]);
    });
    return;
  }

  if (settingsKeys.server) {
    const keys = [settingsKeys.server, settingsKeys.model];
    if (settingsKeys.apiKey) keys.push(settingsKeys.apiKey);
    chrome.storage.sync.get(keys, async (settings) => {
      const server = settings[settingsKeys.server] || providerConfig.defaultServer;
      const apiKey = settingsKeys.apiKey ? settings[settingsKeys.apiKey] || '' : '';
      try {
        const models = await fetchModels(provider, { server, apiKey });
        console.info(`[popup] loadProviderModels:${provider}:fetched`, {
          server,
          modelCount: Array.isArray(models) ? models.length : null
        });
        populateModelSelect(provider, modelSelect, models, settings[settingsKeys.model] || '');
      } catch (error) {
        console.info(`${providerConfig.label}モデル一覧の取得に失敗:`, error);
        // 失敗時は空のまま
      }
    });
    return;
  }

  const apiKeyKey = settingsKeys.apiKey;
  const modelKey = settingsKeys.model;
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

      if (providerConfig.publicModelsWithoutApiKey) {
        try {
          const models = await fetchModels(provider);
          populateModelSelect(provider, modelSelect, models, settings[modelKey] || '');
        } catch (error) {
          console.error(`公開APIからの${provider}モデル一覧の取得に失敗:`, error);
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
    const isLocal = Boolean(getProviderUi(provider)?.settingsKeys?.server);
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
    const payload = { action: 'getModels', provider };
    if (options) {
      if (typeof options === 'string') {
        payload.apiKey = options;
      } else {
        if (options.apiKey) payload.apiKey = options.apiKey;
        if (options.server) payload.server = options.server;
      }
    }
    console.info('[popup] fetchModelsViaBackground:request', {
      provider,
      action: payload.action,
      server: payload.server || null,
      hasApiKey: Boolean(payload.apiKey)
    });
    chrome.runtime.sendMessage(
      payload,
      response => {
        if (chrome.runtime.lastError) {
          console.warn('[popup] fetchModelsViaBackground:lastError', {
            provider,
            action: payload.action,
            message: chrome.runtime.lastError.message
          });
          return reject(new Error(`バックグラウンドスクリプトエラー: ${chrome.runtime.lastError.message}`));
        }
        if (response.error) {
          console.warn('[popup] fetchModelsViaBackground:errorResponse', {
            provider,
            action: payload.action,
            message: response.error.message || 'モデル取得エラー'
          });
          return reject(new Error(response.error.message || 'モデル取得エラー'));
        }
        console.info('[popup] fetchModelsViaBackground:response', {
          provider,
          action: payload.action,
          modelCount: Array.isArray(response.models) ? response.models.length : null
        });
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
  const defaultModels = getProviderUi(provider)?.defaultModels || [];
  
  // 現在選択されているモデルを保存
  const selectedModel = selectElement.value;
  
  // 既存のオプションをクリア
  selectElement.innerHTML = '';
  
  // デフォルトモデルでオプションを生成
  if (defaultModels.length) {
    // プレースホルダー（空）
    const emptyOption = document.createElement('option');
    emptyOption.value = '';
    emptyOption.textContent = '';
    selectElement.appendChild(emptyOption);

    defaultModels.forEach(model => {
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
    cerebrasSection: document.getElementById('cerebras-section'),
    zaiSection: document.getElementById('zai-section'),
    ollamaSection: document.getElementById('ollama-section'),
    lmstudioSection: document.getElementById('lmstudio-section'),
    chromePromptSection: document.getElementById('chromePrompt-section'),
    openrouterApiKeyInput: document.getElementById('openrouter-api-key'),
    openrouterModelSelect: document.getElementById('openrouter-model'),
    geminiApiKeyInput: document.getElementById('gemini-api-key'),
    geminiModelSelect: document.getElementById('gemini-model'),
    cerebrasApiKeyInput: document.getElementById('cerebras-api-key'),
    cerebrasModelSelect: document.getElementById('cerebras-model'),
    zaiApiKeyInput: document.getElementById('zai-api-key'),
    zaiModelSelect: document.getElementById('zai-model'),
    ollamaServerInput: document.getElementById('ollama-server'),
    ollamaModelSelect: document.getElementById('ollama-model'),
    lmstudioServerInput: document.getElementById('lmstudio-server'),
    lmstudioApiKeyInput: document.getElementById('lmstudio-api-key'),
    lmstudioModelSelect: document.getElementById('lmstudio-model'),
    chromePromptTemperatureInput: document.getElementById('chromePrompt-temperature'),
    saveButton: document.getElementById('save-button'),
    statusMessage: document.getElementById('status-message'),
    featureStatusMessage: document.getElementById('feature-status-message'),
    // 機能タブ要素
    twitterFeatureCheckbox: document.getElementById('enable-twitter-translation'),
    youtubeFeatureCheckbox: document.getElementById('enable-youtube-translation'),
    featureSaveButton: document.getElementById('feature-save-button'),
    translationSystemPromptTextarea: document.getElementById('translation-system-prompt'),
    resetSystemPromptButton: document.getElementById('reset-system-prompt'),
    separatorPromptToggleButton: document.getElementById('toggle-separator-prompt-settings'),
    separatorPromptBody: document.getElementById('separator-prompt-body'),
    pageTranslationSeparatorPromptTextarea: document.getElementById('page-translation-separator-prompt'),
    resetSeparatorPromptButton: document.getElementById('reset-separator-prompt'),
    // 詳細設定（高度）
    advancedToggleButton: document.getElementById('toggle-advanced-settings'),
    advancedBody: document.getElementById('advanced-settings-body'),
    pageTranslationMaxCharsInput: document.getElementById('page-translation-max-chars'),
    pageTranslationMaxItemsInput: document.getElementById('page-translation-max-items'),
    pageTranslationChunksPerPassInput: document.getElementById('page-translation-chunks-per-pass'),
    pageTranslationDelayMsInput: document.getElementById('page-translation-delay-ms'),
    pageTranslationConcurrencyInput: document.getElementById('page-translation-concurrency'),
    pageTranslationSeparatorInput: document.getElementById('page-translation-separator'),
    // テスト用要素
    testApiProviderSelect: document.getElementById('test-api-provider'),
    testTextArea: document.getElementById('test-text'),
    testButton: document.getElementById('test-button'),
    testStatus: document.getElementById('test-status'),
    testResult: document.getElementById('test-result'),
    // ログタブ要素
    logView: document.getElementById('log-view'),
    logClearButton: document.getElementById('log-clear-button'),
    logStatus: document.getElementById('log-status'),
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

function setupApiProviderToggle({ apiProviderSelect, openrouterSection, geminiSection, cerebrasSection, zaiSection, ollamaSection, lmstudioSection, chromePromptSection }) {
  apiProviderSelect.addEventListener('change', () => {
    const sections = getProviderSections({ openrouterSection, geminiSection, cerebrasSection, zaiSection, ollamaSection, lmstudioSection, chromePromptSection });
    
    // すべてのセクションを非表示にする
    Object.values(sections).forEach(section => section?.classList.add('hidden'));
    
    // 選択されたプロバイダーのセクションを表示する
    sections[apiProviderSelect.value]?.classList.remove('hidden');
  });
}

function createVerificationUI(elements) {
  PROVIDER_ORDER
    .filter((provider) => getProviderUi(provider)?.supportsVerification)
    .forEach((provider) => {
      const apiKeyInput = elements[getProviderUi(provider).elements.apiKey];
      if (apiKeyInput) createProviderVerificationUI(provider, apiKeyInput);
    });
}

// APIキー検証UI作成の共通関数
function createProviderVerificationUI(provider, apiKeyInput) {
  const container = document.createElement('div');
  container.className = 'verify-row';

  const keyStatus = document.createElement('span');
  keyStatus.className = 'verify-status';
  keyStatus.textContent = '';

  const verifyButton = document.createElement('button');
  verifyButton.textContent = 'APIキーを検証';
  verifyButton.type = 'button';
  verifyButton.className = 'verify-button';

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
  const {
    saveButton,
    featureSaveButton,
    testButton,
    advancedToggleButton,
    advancedBody,
    resetSystemPromptButton,
    translationSystemPromptTextarea,
    separatorPromptToggleButton,
    separatorPromptBody,
    resetSeparatorPromptButton,
    pageTranslationSeparatorPromptTextarea
  } = elements;
  
  saveButton.addEventListener('click', () => saveSettings(elements));
  if (featureSaveButton) featureSaveButton.addEventListener('click', () => saveFeatureSettings(elements));
  testButton.addEventListener('click', () => testApi(elements));
  
  MODEL_PROVIDER_IDS.forEach((provider) => {
    const config = getProviderUi(provider);
    const apiKeyInput = elements[config.elements.apiKey];
    const serverInput = elements[config.elements.server];
    const modelSelect = elements[config.elements.model];
    if (config.supportsVerification && apiKeyInput && modelSelect) {
      apiKeyInput.addEventListener('change',
        PopupUtils.createApiKeyChangeHandler(provider, apiKeyInput, modelSelect));
    }
    if (serverInput && modelSelect) {
      const refreshModels = async () => {
        const options = {
          server: serverInput.value.trim() || config.defaultServer
        };
        if (apiKeyInput) options.apiKey = apiKeyInput.value.trim();
        try {
          const models = await fetchModels(provider, options);
          populateModelSelect(provider, modelSelect, models);
        } catch (error) {
          console.error(`${config.label}モデル一覧の取得に失敗:`, error);
        }
      };
      serverInput.addEventListener('change', refreshModels);
      apiKeyInput?.addEventListener('change', refreshModels);
    }
  });

  // 高度な設定の開閉
  if (advancedToggleButton && advancedBody) {
    advancedToggleButton.addEventListener('click', () => {
      advancedBody.classList.toggle('hidden');
    });
  }

  if (separatorPromptToggleButton && separatorPromptBody) {
    separatorPromptToggleButton.addEventListener('click', () => {
      separatorPromptBody.classList.toggle('hidden');
    });
  }

  // プロンプトをデフォルトに戻す
  if (resetSystemPromptButton) {
    resetSystemPromptButton.addEventListener('click', () => {
      if (translationSystemPromptTextarea) {
        translationSystemPromptTextarea.value = DEFAULT_TRANSLATION_SYSTEM_PROMPT;
      }
    });
  }

  if (resetSeparatorPromptButton) {
    resetSeparatorPromptButton.addEventListener('click', () => {
      if (pageTranslationSeparatorPromptTextarea) {
        pageTranslationSeparatorPromptTextarea.value = DEFAULT_PAGE_TRANSLATION_SEPARATOR_PROMPT;
      }
    });
  }
}

// 機能タブの設定保存（Twitter / YouTube 有効化）
function saveFeatureSettings({
  twitterFeatureCheckbox,
  youtubeFeatureCheckbox,
  featureStatusMessage,
  translationSystemPromptTextarea,
  pageTranslationSeparatorPromptTextarea
}) {
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
    pageTranslationSeparatorPrompt: (
      pageTranslationSeparatorPromptTextarea?.value ||
      DEFAULT_PAGE_TRANSLATION_SEPARATOR_PROMPT
    ).trim(),
    pageTranslationMaxChars: num(els.pageTranslationMaxCharsInput, 3500, 500, 32000),
    pageTranslationMaxItemsPerChunk: num(els.pageTranslationMaxItemsInput, 50, 5, 500),
    pageTranslationChunksPerPass: num(els.pageTranslationChunksPerPassInput, 6, 1, 100),
    pageTranslationDelayMs: num(els.pageTranslationDelayMsInput, 400, 0, 60000),
    pageTranslationConcurrency: num(els.pageTranslationConcurrencyInput, 4, 1, 20),
    pageTranslationSeparator: ((els.pageTranslationSeparatorInput?.value || '[[[SEP]]]').trim() || '[[[SEP]]]')
  };
  // 空ならデフォルトを保存（空文字を避ける）
  if (!partial.translationSystemPrompt) {
    partial.translationSystemPrompt = DEFAULT_TRANSLATION_SYSTEM_PROMPT;
  }
  if (!partial.pageTranslationSeparatorPrompt) {
    partial.pageTranslationSeparatorPrompt = DEFAULT_PAGE_TRANSLATION_SEPARATOR_PROMPT;
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
        action: 'verifyApiKey',
        provider,
        apiKey
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
function loadSettings(elements) {
  const {
    apiProviderSelect,
    openrouterSection,
    geminiSection,
    cerebrasSection,
    zaiSection,
    ollamaSection,
    lmstudioSection,
    chromePromptSection,
    twitterFeatureCheckbox,
    youtubeFeatureCheckbox
  } = elements;
  chrome.storage.sync.get(
    null,
    settings => {
      const apiProvider = settings.apiProvider || 'openrouter';
      apiProviderSelect.value = apiProvider;
      PROVIDER_ORDER.forEach((provider) => {
        const config = getProviderUi(provider);
        const { settingsKeys } = config;
        const apiKeyInput = elements[config.elements.apiKey];
        const serverInput = elements[config.elements.server];
        const modelSelect = elements[config.elements.model];
        const temperatureInput = elements[config.elements.temperature];
        if (apiKeyInput) apiKeyInput.value = settings[settingsKeys.apiKey] || '';
        if (serverInput) serverInput.value = settings[settingsKeys.server] || config.defaultServer || '';
        if (modelSelect) modelSelect.value = settings[settingsKeys.model] || '';
        if (temperatureInput) {
          temperatureInput.value = settings[settingsKeys.temperature] ?? config.defaultTemperature ?? 0.2;
        }
      });

      // 機能オン/オフの復元（デフォルトtrue）
      if (twitterFeatureCheckbox) twitterFeatureCheckbox.checked = settings.enableTwitterTranslation !== false;
      if (youtubeFeatureCheckbox) youtubeFeatureCheckbox.checked = settings.enableYoutubeTranslation !== false;

      // 翻訳システムプロンプトの復元
      try {
        const els = getElements();
        const usesLegacyCombinedPrompt =
          settings.translationSystemPrompt === LEGACY_COMBINED_TRANSLATION_SYSTEM_PROMPT;
        const translationPrompt = usesLegacyCombinedPrompt
          ? DEFAULT_TRANSLATION_SYSTEM_PROMPT
          : (settings.translationSystemPrompt || DEFAULT_TRANSLATION_SYSTEM_PROMPT);
        const separatorPrompt =
          settings.pageTranslationSeparatorPrompt || DEFAULT_PAGE_TRANSLATION_SEPARATOR_PROMPT;

        if (els.translationSystemPromptTextarea) {
          els.translationSystemPromptTextarea.value = translationPrompt;
        }
        if (els.pageTranslationSeparatorPromptTextarea) {
          els.pageTranslationSeparatorPromptTextarea.value = separatorPrompt;
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
        if (els.pageTranslationConcurrencyInput) els.pageTranslationConcurrencyInput.value = (settings.pageTranslationConcurrency ?? 4);
        if (els.pageTranslationSeparatorInput) els.pageTranslationSeparatorInput.value = (settings.pageTranslationSeparator ?? '[[[SEP]]]');
      } catch (e) {
        console.warn('詳細設定の復元に失敗:', e);
      }
      
      // APIプロバイダーに応じたセクションの表示制御
      const sections = getProviderSections({ openrouterSection, geminiSection, cerebrasSection, zaiSection, ollamaSection, lmstudioSection, chromePromptSection });
      
      // すべてのセクションを非表示にする
      Object.values(sections).forEach(section => section?.classList.add('hidden'));
      
      // 選択されたプロバイダーのセクションを表示する
      sections[apiProvider]?.classList.remove('hidden');
      
      // モデルの選択状態を復元
      MODEL_PROVIDER_IDS.forEach((provider) => {
        const config = getProviderUi(provider);
        PopupUtils.restoreModelSelection(
          provider,
          elements[config.elements.model],
          settings[config.settingsKeys.model]
        );
      });
    }
  );
}

// 設定の保存
function saveSettings(elements) {
  const { apiProviderSelect, statusMessage, twitterFeatureCheckbox, youtubeFeatureCheckbox } = elements;
  const settings = {
    apiProvider: apiProviderSelect.value
  };

  PROVIDER_ORDER.forEach((provider) => {
    const config = getProviderUi(provider);
    const { settingsKeys } = config;
    const apiKeyInput = elements[config.elements.apiKey];
    const serverInput = elements[config.elements.server];
    const modelSelect = elements[config.elements.model];
    const temperatureInput = elements[config.elements.temperature];
    if (apiKeyInput) settings[settingsKeys.apiKey] = apiKeyInput.value.trim();
    if (serverInput) settings[settingsKeys.server] = serverInput.value.trim() || config.defaultServer;
    if (modelSelect) settings[settingsKeys.model] = modelSelect.value;
    if (temperatureInput) {
      const temperature = Number(temperatureInput.value);
      settings[settingsKeys.temperature] = Number.isFinite(temperature)
        ? Math.max(0, Math.min(2, temperature))
        : config.defaultTemperature ?? 0.2;
    }
  });

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

function buildProviderSettingsForTest(apiProvider, settings) {
  const config = getProviderUi(apiProvider);
  if (!config) {
    return { error: `未対応のプロバイダーです: ${apiProvider}` };
  }

  for (const rule of config.testRequired || []) {
    if (!settings[rule.key]) {
      return { error: rule.message };
    }
  }

  const providerSettings = { apiProvider };
  const { settingsKeys } = config;
  if (settingsKeys.apiKey) providerSettings[settingsKeys.apiKey] = settings[settingsKeys.apiKey] || '';
  if (settingsKeys.server) providerSettings[settingsKeys.server] = settings[settingsKeys.server] || config.defaultServer;
  if (settingsKeys.model) providerSettings[settingsKeys.model] = settings[settingsKeys.model] || '';
  if (settingsKeys.temperature) {
    providerSettings[settingsKeys.temperature] = settings[settingsKeys.temperature] ?? config.defaultTemperature ?? 0.2;
  }
  return { providerSettings };
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
      const { providerSettings, error } = buildProviderSettingsForTest(apiProvider, settings);
      if (error) {
        showStatus(testStatus, error, false);
        testButton.disabled = false;
        return;
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

function storageLocalGet(key) {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get(key, (data) => resolve(data || {}));
    } catch {
      resolve({});
    }
  });
}

function storageLocalSet(obj) {
  return new Promise((resolve, reject) => {
    try {
      chrome.storage.local.set(obj, () => {
        if (chrome.runtime.lastError) return reject(chrome.runtime.lastError);
        resolve();
      });
    } catch (e) {
      reject(e);
    }
  });
}

async function refreshLogs({ logView }) {
  if (!logView) return;
  const key = 'pageTranslationLogs';
  const data = await storageLocalGet(key);
  const arr = Array.isArray(data[key]) ? data[key] : [];

  if (!arr.length) {
    logView.textContent = 'ログはまだありません。';
    return;
  }

  const lines = arr
    .slice()
    .reverse()
    .map((e) => {
      const ts = new Date(e.ts || Date.now()).toLocaleString();
      const lvl = (e.level || 'info').toUpperCase();
      const meta = [e.provider, e.model].filter(Boolean).join(' ');
      const msg = e.message ? ` - ${e.message}` : '';
      const details = [];
      if (typeof e.chunkIndex === 'number') details.push(`chunk=${e.chunkIndex}`);
      if (typeof e.items === 'number') details.push(`items=${e.items}`);
      if (typeof e.len === 'number') details.push(`len=${e.len}`);
      if (typeof e.ms === 'number') details.push(`ms=${e.ms}`);
      if (typeof e.timeoutMs === 'number') details.push(`timeoutMs=${e.timeoutMs}`);
      if (typeof e.processedItems === 'number' && typeof e.totalItems === 'number') details.push(`progress=${e.processedItems}/${e.totalItems}`);
      const detailsStr = details.length ? ` (${details.join(', ')})` : '';
      return `[${ts}] [${lvl}] ${e.event || e.type || 'log'}${meta ? ' ' + meta : ''}${detailsStr}${msg}`;
    });

  logView.textContent = lines.join('\n');
}

function bindLogHandlers({ logClearButton, logStatus, logView }) {
  if (logClearButton) {
    logClearButton.addEventListener('click', async () => {
      try {
        await storageLocalSet({ pageTranslationLogs: [] });
        if (logView) logView.textContent = 'ログをクリアしました。';
        if (logStatus) showStatus(logStatus, 'ログをクリアしました', true);
      } catch (e) {
        console.error('ログクリア失敗:', e);
        if (logStatus) showStatus(logStatus, `ログクリア失敗: ${e.message || e}`, false);
      }
    });
  }

  // ログタブが開かれたらリフレッシュ
  document.querySelectorAll('.tab[data-tab="log"]').forEach((tab) => {
    tab.addEventListener('click', () => refreshLogs({ logView }));
  });
}
