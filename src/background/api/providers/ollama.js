import { TRANSLATION_TIMEOUT_MS } from '../../../shared/constants.js';
import {
  STRUCTURED_BATCH_SCHEMA,
  buildStructuredBatchInstruction,
  buildStructuredBatchItems,
  normalizeStructuredBatchResult,
  parseJsonLoose
} from '../../../shared/structured-batch.js';
import { makeApiRequest } from '../http.js';
import { getSystemPrompt } from '../prompt.js';

function getServer(settings) {
  return (settings.ollamaServer || 'http://localhost:11434').replace(/\/$/, '');
}

function requireModel(settings) {
  if (!settings.ollamaModel) {
    throw new Error('Ollamaのモデルが選択されていません');
  }
}

function parseStructuredBatchResponse(text, texts) {
  const parsed = parseJsonLoose(text);
  if (!parsed) {
    throw new Error('構造化出力(JSON)の解析に失敗しました');
  }
  return normalizeStructuredBatchResult(parsed, texts);
}

async function translate(text, settings, requestOptions = {}) {
  requireModel(settings);

  const data = await makeApiRequest(
    `${getServer(settings)}/api/generate`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: settings.ollamaModel,
        prompt: `${getSystemPrompt(settings)}\n\n${text}`,
        stream: false
      }),
      timeoutMs: requestOptions.timeoutMs ?? TRANSLATION_TIMEOUT_MS,
      signal: requestOptions.signal
    },
    'Ollama API リクエスト中にエラーが発生'
  );

  return (data.response || '').trim();
}

async function translateBatchStructured(texts, settings, requestOptions = {}) {
  requireModel(settings);

  const items = buildStructuredBatchItems(texts);
  const instr = buildStructuredBatchInstruction(settings);
  const prompt = `${instr}\n\nitems = ${JSON.stringify(items)}`;
  const formatCandidates = [STRUCTURED_BATCH_SCHEMA, 'json'];
  let lastError = null;

  for (let i = 0; i < formatCandidates.length; i++) {
    const format = formatCandidates[i];
    try {
      const data = await makeApiRequest(
        `${getServer(settings)}/api/generate`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: settings.ollamaModel,
            prompt,
            stream: false,
            format
          }),
          timeoutMs: requestOptions.timeoutMs ?? TRANSLATION_TIMEOUT_MS,
          signal: requestOptions.signal
        },
        'Ollama API (structured batch) リクエスト中にエラーが発生'
      );

      const responseText = (data?.response ?? '').toString();
      return parseStructuredBatchResponse(responseText, texts);
    } catch (error) {
      if (error?.name === 'AbortError' || error?.name === 'TimeoutError') throw error;
      lastError = error;
      if (i >= formatCandidates.length - 1) break;
    }
  }

  throw lastError || new Error('Ollama structured batch translation failed');
}

async function getModels(message, settings) {
  const server = (message.server || settings.ollamaServer || 'http://localhost:11434').replace(/\/$/, '');
  const result = await makeApiRequest(
    `${server}/api/tags`,
    { method: 'GET' },
    'Ollama モデル一覧取得中にエラーが発生',
    'info'
  );
  const arr = result.models || [];
  return arr.map((model) => ({ id: model.name, name: model.name }));
}

export default {
  translate,
  translateBatchStructured,
  getModels
};
