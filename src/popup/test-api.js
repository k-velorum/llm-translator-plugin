import { formatUserError } from '../shared/errors.js';
import { getProviderUi } from './provider-ui.js';
import { showStatus, showPendingStatus } from './status.js';
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

// 保存前の入力で接続を確認できるよう、storageではなく画面の設定を受け取る。
export async function testApi(elements, settings) {
  const version = (elements.testRequestVersion || 0) + 1;
  elements.testRequestVersion = version;
  const { testTextArea, testButton, testStatus, testResult, testErrorDetails, testErrorBody } = elements;
  const testText = testTextArea.value.trim();
  testResult.classList.add('hidden');
  testErrorDetails.classList.add('hidden');
  testErrorDetails.open = false;
  const { providerSettings, error } = buildProviderSettingsForTest(settings.apiProvider, settings);
  if (!testText || error) {
    showStatus(testStatus, error || 'テスト文章を入力してください', false);
    return;
  }
  testButton.disabled = true;
  testButton.textContent = '翻訳しています…';
  showPendingStatus(testStatus, '応答を待っています…');
  try {
    const response = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ action: 'testTranslate', text: testText,
        settings: { ...providerSettings, translationSystemPrompt: settings.translationSystemPrompt } }, (result) => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        if (!result) return reject(new Error('拡張から応答がありません。拡張を再読み込みしてください。'));
        if (result.error) return reject(result.error);
        resolve(result);
      });
    });
    if (elements.testRequestVersion !== version) return;
    showStatus(testStatus, '翻訳できました。この設定で接続できます。', true, { autoHide: false });
    testResult.textContent = response.result;
    testResult.classList.remove('hidden');
  } catch (error) {
    if (elements.testRequestVersion !== version) return;
    log.error('popup.testApi', 'APIテストエラー', { error });
    showStatus(testStatus, formatUserError(error), false);
    const details = error.details || error.stack;
    if (details) {
      testErrorBody.textContent = details;
      testErrorDetails.classList.remove('hidden');
    }
  } finally {
    testButton.disabled = false;
    testButton.textContent = '翻訳して確認';
    if (elements.testRequestVersion !== version) {
      showPendingStatus(testStatus, '設定が変更されています。現在の設定でもう一度お試しください。');
    }
  }
}

export function invalidateTestResult(elements) {
  elements.testRequestVersion = (elements.testRequestVersion || 0) + 1;
  elements.testResult.classList.add('hidden');
  elements.testErrorDetails.classList.add('hidden');
  if (elements.testButton.disabled) {
    showPendingStatus(elements.testStatus, '設定が変更されました。実行中の確認が終わったら、もう一度お試しください。');
  } else {
    elements.testStatus.classList.add('hidden');
  }
}
