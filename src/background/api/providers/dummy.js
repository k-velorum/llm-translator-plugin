import { createOpenAICompatibleProvider } from '../openai-compatible.js';

function getConfig(settings) {
  if (!settings.dummyApiKey) {
    throw new Error('Dummy APIキーが設定されていません');
  }
  if (!settings.dummyModel) {
    throw new Error('Dummy のモデルが選択されていません');
  }

  return {
    apiUrl: 'https://dummy.invalid/v1/chat/completions',
    model: settings.dummyModel,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${settings.dummyApiKey}`
    }
  };
}

export default createOpenAICompatibleProvider({
  providerLabel: 'Dummy',
  getConfig
});
