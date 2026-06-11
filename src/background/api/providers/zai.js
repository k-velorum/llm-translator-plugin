import { createOpenAICompatibleProvider } from '../openai-compatible.js';

function getConfig(settings) {
  if (!settings.zaiApiKey) {
    throw new Error('Z-AI APIキーが設定されていません');
  }
  if (!settings.zaiModel) {
    throw new Error('Z-AIのモデルが選択されていません');
  }

  return {
    apiUrl: 'https://api.z.ai/api/paas/v4/chat/completions',
    model: settings.zaiModel,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${settings.zaiApiKey}`,
      'Accept-Language': 'en-US,en'
    }
  };
}

export default createOpenAICompatibleProvider({
  providerLabel: 'Z-AI',
  getConfig,
  responseFormatCandidates: () => [{ type: 'json_object' }]
});
