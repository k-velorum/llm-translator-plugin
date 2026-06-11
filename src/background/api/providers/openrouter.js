import { createOpenAICompatibleProvider } from '../openai-compatible.js';

export const OPENROUTER_HEADERS_BASE = {
  'HTTP-Referer': 'chrome-extension://llm-translator',
  'X-Title': 'LLM Translation Plugin'
};

function getConfig(settings) {
  if (!settings.openrouterApiKey) {
    throw new Error('OpenRouter APIキーが設定されていません');
  }
  if (!settings.openrouterModel) {
    throw new Error('OpenRouter のモデルが選択されていません');
  }

  return {
    apiUrl: 'https://openrouter.ai/api/v1/chat/completions',
    model: settings.openrouterModel,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${settings.openrouterApiKey}`,
      ...OPENROUTER_HEADERS_BASE
    }
  };
}

export default createOpenAICompatibleProvider({
  providerLabel: 'OpenRouter',
  getConfig,
  buildTranslateBody: ({ cfg, messages }) => ({
    model: cfg.model,
    messages
  })
});
