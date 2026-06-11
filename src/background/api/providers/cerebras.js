import { createOpenAICompatibleProvider } from '../openai-compatible.js';

function getConfig(settings) {
  if (!settings.cerebrasApiKey) {
    throw new Error('Cerebras APIキーが設定されていません');
  }
  if (!settings.cerebrasModel) {
    throw new Error('Cerebras のモデルが選択されていません');
  }

  return {
    apiUrl: 'https://api.cerebras.ai/v1/chat/completions',
    model: settings.cerebrasModel,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${settings.cerebrasApiKey}`
    }
  };
}

export default createOpenAICompatibleProvider({
  providerLabel: 'Cerebras',
  getConfig
});
