import {
  PROVIDER_ORDER,
  getProviderUi
} from './provider-ui.js';
import {
  fetchModels,
  fetchModelsViaBackground,
  populateModelSelect
} from './models.js';

export function createVerificationUI(elements) {
  PROVIDER_ORDER
    .filter((provider) => getProviderUi(provider)?.supportsVerification)
    .forEach((provider) => {
      const config = getProviderUi(provider);
      const apiKeyInput = elements[config.elements.apiKey];
      const modelSelect = elements[config.elements.model];
      if (apiKeyInput && modelSelect) {
        createProviderVerificationUI(provider, apiKeyInput, modelSelect);
      }
    });
}

function createProviderVerificationUI(provider, apiKeyInput, modelSelect) {
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
    await verifyApiKey(provider, apiKey, keyStatus, verifyButton, modelSelect);

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

async function verifyApiKey(provider, apiKey, statusElem, buttonElem, modelSelect) {
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

    const models = await fetchModelsViaBackground(provider, apiKey);
    populateModelSelect(provider, modelSelect, models);
  } catch (error) {
    console.error('APIキー検証エラー:', error);
    statusElem.textContent = `✗ APIキー検証失敗: ${error.message || 'ネットワークエラー'}`;
    statusElem.style.color = '#d32f2f';
  } finally {
    buttonElem.disabled = false;
  }
}

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
