import { createConfigurationError } from '../../../shared/errors.js';
import { createOpenAICompatibleProvider } from '../openai-compatible.js';
import { getReasoningRequestOptions } from '../../../shared/reasoning.js';

function getConfig(settings) {
  if (!settings.zaiApiKey) {
    throw createConfigurationError('Z-AI APIキーが設定されていません');
  }
  if (!settings.zaiModel) {
    throw createConfigurationError('Z-AIのモデルが選択されていません');
  }

  return {
    apiUrl: 'https://api.z.ai/api/paas/v4/chat/completions',
    model: settings.zaiModel,
    requestBodyOptions: getReasoningRequestOptions('zai', settings.zaiReasoning),
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
