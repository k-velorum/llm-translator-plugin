import {
  MODEL_PROVIDER_IDS,
  getProviderUi
} from './provider-ui.js';
import {
  setupOrResetSelect2,
  updateModelInfo
} from './model-info.js';
import { log } from '../shared/logger.js';

function createApiKeyChangeHandler(provider, apiKeyInput, modelSelect) {
  return async () => {
    const apiKey = apiKeyInput.value.trim();
    if (!apiKey) return;
    try {
      const models = await fetchModels(provider, apiKey);
      populateModelSelect(provider, modelSelect, models);
    } catch (error) {
      log.error('popup.models', 'APIキー変更時のモデル一覧取得エラー', { error, provider });
    }
  };
}

export function restoreModelSelection(provider, modelSelect, modelValue) {
  if (!modelValue || !modelSelect) return;

  setTimeout(() => {
    if (Array.from(modelSelect.options).some(opt => opt.value === modelValue)) {
      modelSelect.value = modelValue;

      if (typeof jQuery !== 'undefined' && jQuery.fn.select2) {
        $(modelSelect).trigger('change');
        const modelData = $(modelSelect).find(`option[value="${modelValue}"]`).data('model');
        if (modelData) {
          updateModelInfo(provider, modelData);
        }
      }
    }
  }, 500);
}

export function initSelect2() {
  if (typeof jQuery !== 'undefined' && jQuery.fn.select2) {
    $('.model-select').each(function() {
      setupOrResetSelect2($(this));
    });

    $(MODEL_PROVIDER_IDS.map((provider) => `#${provider}-model`).join(', ')).on('select2:select', function(event) {
      const provider = this.id.split('-')[0];
      const modelId = event.params.data.id;
      const modelData = $(this).find(`option[value="${modelId}"]`).data('model');
      if (modelData) {
        updateModelInfo(provider, modelData);
      }
    });
  } else {
    log.error('popup.models', 'Select2またはjQueryが読み込まれていません');
  }
}

export function loadModels(elements) {
  MODEL_PROVIDER_IDS.forEach(provider => loadProviderModels(provider, elements));
}

function loadProviderModels(provider, elements) {
  const providerConfig = getProviderUi(provider);
  const modelSelect = elements[providerConfig?.elements?.model];
  log.info('popup.models', 'loadProviderModels:start', {
    provider,
    hasModelSelect: Boolean(modelSelect)
  });

  if (!providerConfig || !modelSelect) return;

  const { settingsKeys } = providerConfig;

  if (providerConfig.staticModelsOnly) {
    chrome.storage.sync.get([settingsKeys.model], (settings) => {
      setDefaultModels(provider, modelSelect);
      restoreModelSelection(provider, modelSelect, settings[settingsKeys.model]);
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
        log.info('popup.models', `loadProviderModels:${provider}:fetched`, {
          server,
          modelCount: Array.isArray(models) ? models.length : null
        });
        populateModelSelect(provider, modelSelect, models, settings[settingsKeys.model] || '');
      } catch (error) {
        log.info('popup.models', `${providerConfig.label}モデル一覧の取得に失敗`, { error, provider });
      }
    });
    return;
  }

  const apiKeyKey = settingsKeys.apiKey;
  const modelKey = settingsKeys.model;
  chrome.storage.sync.get([apiKeyKey, modelKey], async (settings) => {
    if (settings[apiKeyKey]) {
      try {
        const models = await fetchModels(provider, { apiKey: settings[apiKeyKey] });
        populateModelSelect(provider, modelSelect, models, settings[modelKey] || '');
      } catch (error) {
        log.error('popup.models', `${provider}モデル一覧の取得に失敗`, { error, provider });
        setDefaultModels(provider, modelSelect);
      }
    } else {
      setDefaultModels(provider, modelSelect);

      if (providerConfig.publicModelsWithoutApiKey) {
        try {
          const models = await fetchModels(provider);
          populateModelSelect(provider, modelSelect, models, settings[modelKey] || '');
        } catch (error) {
          log.error('popup.models', `公開APIからの${provider}モデル一覧の取得に失敗`, { error, provider });
        }
      }
    }
  });
}

export async function fetchModels(provider, options) {
  try {
    return await fetchModelsViaBackground(provider, options);
  } catch (error) {
    const isLocal = Boolean(getProviderUi(provider)?.settingsKeys?.server);
    if (isLocal) {
      log.info('popup.models', `${provider}モデル取得エラー`, { error, provider });
    } else {
      log.error('popup.models', `${provider}モデル取得エラー`, { error, provider });
    }
    throw error;
  }
}

export function fetchModelsViaBackground(provider, options) {
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
    log.info('popup.models', 'fetchModelsViaBackground:request', {
      provider,
      action: payload.action,
      server: payload.server || null,
      hasApiKey: Boolean(payload.apiKey)
    });
    chrome.runtime.sendMessage(
      payload,
      response => {
        if (chrome.runtime.lastError) {
          log.warn('popup.models', 'fetchModelsViaBackground:lastError', {
            provider,
            action: payload.action,
            message: chrome.runtime.lastError.message
          });
          return reject(new Error(`バックグラウンドスクリプトエラー: ${chrome.runtime.lastError.message}`));
        }
        if (response.error) {
          log.warn('popup.models', 'fetchModelsViaBackground:errorResponse', {
            provider,
            action: payload.action,
            message: response.error.message || 'モデル取得エラー'
          });
          return reject(new Error(response.error.message || 'モデル取得エラー'));
        }
        log.info('popup.models', 'fetchModelsViaBackground:response', {
          provider,
          action: payload.action,
          modelCount: Array.isArray(response.models) ? response.models.length : null
        });
        resolve(response.models || []);
      }
    );
  });
}

export function populateModelSelect(provider, selectElement, models, preferredValue = '') {
  const selectedModel = selectElement.value;
  selectElement.innerHTML = '';

  if (models && models.length > 0) {
    const emptyOption = document.createElement('option');
    emptyOption.value = '';
    emptyOption.textContent = '';
    selectElement.appendChild(emptyOption);

    models.forEach(model => {
      const option = document.createElement('option');
      option.value = model.id;
      option.textContent = `${model.name || model.id} (${model.id})`;
      $(option).data('model', model);
      selectElement.appendChild(option);
    });

    const hasPreferred = preferredValue && Array.from(selectElement.options).some(opt => opt.value === preferredValue);
    const hasPrev = selectedModel && Array.from(selectElement.options).some(opt => opt.value === selectedModel);
    const valueToSet = hasPreferred ? preferredValue : (hasPrev ? selectedModel : '');
    if (valueToSet) selectElement.value = valueToSet;

    if (typeof jQuery !== 'undefined' && jQuery.fn.select2) {
      setupOrResetSelect2($(selectElement));
      if (valueToSet) {
        $(selectElement).trigger('change');
        const modelData = $(selectElement).find(`option[value="${valueToSet}"]`).data('model');
        if (modelData) updateModelInfo(provider, modelData);
      }
    }
  } else {
    setDefaultModels(provider, selectElement);
  }
}

export function setDefaultModels(provider, selectElement) {
  const defaultModels = getProviderUi(provider)?.defaultModels || [];
  const selectedModel = selectElement.value;
  selectElement.innerHTML = '';

  if (defaultModels.length) {
    const emptyOption = document.createElement('option');
    emptyOption.value = '';
    emptyOption.textContent = '';
    selectElement.appendChild(emptyOption);

    defaultModels.forEach(model => {
      const option = document.createElement('option');
      option.value = model.id;
      option.textContent = model.name;
      $(option).data('model', model);
      selectElement.appendChild(option);
    });
  }

  if (selectedModel && Array.from(selectElement.options).some(opt => opt.value === selectedModel)) {
    selectElement.value = selectedModel;
    if (typeof jQuery !== 'undefined' && jQuery.fn.select2) {
      $(selectElement).trigger('change');
    }
  }
}

export function bindProviderModelRefreshHandlers(elements) {
  MODEL_PROVIDER_IDS.forEach((provider) => {
    const config = getProviderUi(provider);
    const apiKeyInput = elements[config.elements.apiKey];
    const serverInput = elements[config.elements.server];
    const modelSelect = elements[config.elements.model];
    if (config.supportsVerification && apiKeyInput && modelSelect) {
      apiKeyInput.addEventListener('change', createApiKeyChangeHandler(provider, apiKeyInput, modelSelect));
    }
    if (serverInput && modelSelect) {
      const refreshModels = async () => {
        const options = { server: serverInput.value.trim() || config.defaultServer };
        if (apiKeyInput) options.apiKey = apiKeyInput.value.trim();
        try {
          const models = await fetchModels(provider, options);
          populateModelSelect(provider, modelSelect, models);
        } catch (error) {
          log.error('popup.models', `${config.label}モデル一覧の取得に失敗`, { error, provider });
        }
      };
      serverInput.addEventListener('change', refreshModels);
      apiKeyInput?.addEventListener('change', refreshModels);
    }
  });
}
