import openai from './providers/openai.js';
import { getActiveConnection, legacyBaseUrl, getConnectionPreset } from '../../shared/connections.js';

// 保存済みセッションや旧messageの入口だけを維持し、通信は共通実装へ流す。
export function createLegacyCompatibleProvider(id) {
  const convert = settings => ({ ...settings, apiProvider: id });
  const getModels = (message = {}, settings = {}) => {
    const connection = getActiveConnection(convert(settings));
    if (message.apiKey !== undefined) connection.apiKey = message.apiKey;
    if (message.server !== undefined) connection.baseUrl = legacyBaseUrl(message.server);
    return openai.getModels({ presetId: id, connection }, convert(settings));
  };
  return {
    translate: (text, settings, options) => openai.translate(text, convert(settings), options),
    translateStream: (text, settings, handlers, options) => openai.translateStream(text, convert(settings), handlers, options),
    translateBatchStructured: (texts, settings, options) => openai.translateBatchStructured(texts, convert(settings), options),
    translateImage: (image, settings, options) => openai.translateImage(image, convert(settings), options),
    getModels,
    verify: async (message, settings) => {
      if (getConnectionPreset(id).needsApiKey && !message.apiKey) throw new Error('APIキーを入力してください');
      const models = await getModels(message, settings);
      return id === 'openrouter' ? { success: true, models } : { success: true };
    }
  };
}
