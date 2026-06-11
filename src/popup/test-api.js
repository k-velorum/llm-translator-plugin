import { getProviderUi } from './provider-ui.js';
import { showStatus } from './status.js';
import { log } from '../shared/logger.js';

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

export function testApi(elements) {
  const { testApiProviderSelect, testTextArea, testButton, testStatus, testResult } = elements;
  const apiProvider = testApiProviderSelect.value;
  const testText = testTextArea.value.trim();
  if (!testText) {
    showStatus(testStatus, 'テスト文章を入力してください', false);
    return;
  }

  chrome.storage.sync.get(null, async settings => {
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
      log.error('popup.testApi', 'APIテストエラー', { error });
      showStatus(testStatus, `エラー: ${error.message}`, false);
      testResult.textContent = error.stack || 'スタックトレース情報なし';
      testResult.classList.remove('hidden');
      testButton.disabled = false;
    }
  });
}
