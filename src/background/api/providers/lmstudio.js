import { TRANSLATION_TIMEOUT_MS } from '../../../shared/constants.js';
import { makeApiRequest } from '../http.js';
import { createOpenAICompatibleProvider } from '../openai-compatible.js';
import { getSystemPrompt } from '../prompt.js';

function getServer(settings) {
  return (settings.lmstudioServer || 'http://localhost:1234').replace(/\/$/, '');
}

function getHeaders(settings) {
  const headers = { 'Content-Type': 'application/json' };
  if (settings.lmstudioApiKey) headers.Authorization = `Bearer ${settings.lmstudioApiKey}`;
  return headers;
}

function getConfig(settings) {
  if (!settings.lmstudioModel) {
    throw new Error('LM Studio のモデルが選択されていません');
  }

  return {
    apiUrl: `${getServer(settings)}/v1/chat/completions`,
    model: settings.lmstudioModel,
    headers: getHeaders(settings)
  };
}

function buildImageTranslationPrompt() {
  return [
    'この画像に含まれるテキストを読み取り、日本語に翻訳してください。',
    '翻訳結果のみを出力してください。',
    'テキストが見当たらない場合は「翻訳対象のテキストが見つかりませんでした。」とだけ出力してください。'
  ].join('\n');
}

function extractRestMessageContent(data) {
  const output = Array.isArray(data?.output) ? data.output : [];

  const normalizeContent = (content) => {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return content.map((part) => {
        if (typeof part === 'string') return part;
        if (typeof part?.text === 'string') return part.text;
        if (typeof part?.content === 'string') return part.content;
        return '';
      }).join('');
    }
    if (content && typeof content === 'object' && typeof content.text === 'string') {
      return content.text;
    }
    return '';
  };

  return output
    .filter((item) => item?.type === 'message')
    .map((item) => normalizeContent(item?.content).trim())
    .filter(Boolean)
    .join('\n')
    .trim();
}

async function translateImage(imageInput, settings, requestOptions = {}) {
  if (!settings.lmstudioModel) {
    throw new Error('LM Studio のモデルが選択されていません');
  }
  if (!imageInput?.dataUrl || !imageInput?.mimeType) {
    throw new Error('画像入力データが不正です');
  }

  const data = await makeApiRequest(
    `${getServer(settings)}/api/v1/chat`,
    {
      method: 'POST',
      headers: getHeaders(settings),
      body: JSON.stringify({
        model: settings.lmstudioModel,
        system_prompt: getSystemPrompt(settings),
        // リクエストの input はレスポンス output と型名が非対称で、テキストは 'message' ではなく 'text'
        input: [
          {
            type: 'text',
            content: buildImageTranslationPrompt()
          },
          {
            type: 'image',
            data_url: imageInput.dataUrl
          }
        ],
        temperature: 0.2,
        stream: false,
        // 翻訳は使い捨てのため、LM Studio 側に stateful chat を蓄積させない
        store: false
      }),
      timeoutMs: requestOptions.timeoutMs ?? TRANSLATION_TIMEOUT_MS,
      signal: requestOptions.signal
    },
    'LM Studio 画像翻訳 API リクエスト中にエラーが発生'
  );

  const text = extractRestMessageContent(data);
  if (!text) {
    throw new Error('LM Studio から画像翻訳結果を取得できませんでした');
  }
  return text;
}

export default {
  ...createOpenAICompatibleProvider({
    providerLabel: 'LM Studio',
    getConfig
  }),
  translateImage
};
