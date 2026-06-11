import { TRANSLATION_TIMEOUT_MS } from '../../../shared/constants.js';
import { log } from '../../../shared/logger.js';
import {
  buildStructuredBatchInstruction,
  buildStructuredBatchItems,
  normalizeStructuredBatchResult,
  parseJsonLoose
} from '../../../shared/structured-batch.js';
import { makeApiRequest } from '../http.js';
import { getSystemPrompt } from '../prompt.js';

function buildGeminiGenerateContentUrl(settings) {
  return `https://generativelanguage.googleapis.com/v1beta/models/${settings.geminiModel}:generateContent?key=${settings.geminiApiKey}`;
}

function parseStructuredBatchResponse(text, texts) {
  const parsed = parseJsonLoose(text);
  if (!parsed) {
    throw new Error('構造化出力(JSON)の解析に失敗しました');
  }
  return normalizeStructuredBatchResult(parsed, texts);
}

async function translate(text, settings, requestOptions = {}) {
  if (!settings.geminiApiKey) {
    throw new Error('Gemini APIキーが設定されていません');
  }
  const apiUrl = buildGeminiGenerateContentUrl(settings);
  log.info('api', 'Gemini API リクエスト開始', {
    apiUrl: apiUrl.replace(settings.geminiApiKey, '[redacted]')
  });

  try {
    const data = await makeApiRequest(
      apiUrl,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: `${getSystemPrompt(settings)}\n\n${text}` }
              ]
            }
          ],
          generationConfig: { temperature: 0.2 }
        }),
        timeoutMs: requestOptions.timeoutMs ?? TRANSLATION_TIMEOUT_MS,
        signal: requestOptions.signal
      },
      'Gemini API リクエスト中にエラーが発生'
    );

    return data.candidates[0].content.parts[0].text.trim();
  } catch (error) {
    if (error instanceof TypeError && error.message === 'Failed to fetch') {
      throw new Error('ネットワーク接続エラー: Gemini APIに接続できません。インターネット接続を確認してください。');
    }
    throw error;
  }
}

async function translateBatchStructured(texts, settings, requestOptions = {}) {
  if (!settings.geminiApiKey) {
    throw new Error('Gemini APIキーが設定されていません');
  }

  const apiUrl = buildGeminiGenerateContentUrl(settings);
  const items = buildStructuredBatchItems(texts);
  const instr = buildStructuredBatchInstruction(settings);

  const body = {
    contents: [
      {
        parts: [
          { text: `${instr}\n\nitems = ${JSON.stringify(items)}` }
        ]
      }
    ],
    generationConfig: {
      temperature: 0.2,
      response_mime_type: 'application/json'
    }
  };

  const data = await makeApiRequest(
    apiUrl,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      timeoutMs: requestOptions.timeoutMs ?? TRANSLATION_TIMEOUT_MS,
      signal: requestOptions.signal
    },
    'Gemini API (structured batch) リクエスト中にエラーが発生'
  );

  const responseText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  return parseStructuredBatchResponse(responseText, texts);
}

export default {
  translate,
  translateBatchStructured
};
