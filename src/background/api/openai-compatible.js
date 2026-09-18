import { imageConversationMessages } from '../../shared/image-translation.js';
import { canFallbackAfterError } from '../../shared/errors.js';
import { TRANSLATION_TIMEOUT_MS } from '../../shared/constants.js';
import {
  STRUCTURED_BATCH_SCHEMA,
  buildStructuredBatchInstruction,
  buildStructuredBatchItems,
  normalizeStructuredBatchResult,
  parseJsonLoose
} from '../../shared/structured-batch.js';
import { makeApiRequest, makeStreamingApiRequest } from './http.js';
import { getSystemPrompt } from './prompt.js';

function extractChatMessageContent(data) {
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((part) => {
      if (typeof part === 'string') return part;
      if (typeof part?.text === 'string') return part.text;
      return '';
    }).join('');
  }
  if (content && typeof content === 'object') return JSON.stringify(content);
  return '';
}

function parseStructuredBatchResponse(text, texts) {
  const parsed = parseJsonLoose(text);
  if (!parsed) {
    throw new Error('構造化出力(JSON)の解析に失敗しました');
  }
  return normalizeStructuredBatchResult(parsed, texts);
}

function getDefaultResponseFormatCandidates() {
  return [
    {
      type: 'json_schema',
      json_schema: {
        name: 'translations',
        strict: true,
        schema: STRUCTURED_BATCH_SCHEMA
      }
    },
    { type: 'json_object' }
  ];
}

export function createOpenAICompatibleProvider({
  providerLabel,
  getConfig,
  buildTranslateBody = ({ cfg, messages }) => ({
    model: cfg.model,
    messages,
    temperature: 0.2,
    stream: false
  }),
  responseFormatCandidates = getDefaultResponseFormatCandidates,
  ...extras
}) {
  async function translate(text, settings, requestOptions = {}) {
    const cfg = getConfig(settings);
    const messages = [
      { role: 'system', content: getSystemPrompt(settings) },
      ...(requestOptions.messages || [{ role: 'user', content: text }])
    ];

    const data = await makeApiRequest(
      cfg.apiUrl,
      {
        method: 'POST',
        headers: cfg.headers,
        redirect: 'error',
        body: JSON.stringify({
          ...buildTranslateBody({ cfg, messages, settings, text }),
          ...cfg.requestBodyOptions
        }),
        timeoutMs: requestOptions.timeoutMs ?? TRANSLATION_TIMEOUT_MS,
        signal: requestOptions.signal
      },
      `${providerLabel} API リクエスト中にエラーが発生`
    );

    const translated = extractChatMessageContent(data).trim();
    if (!translated) throw new Error('翻訳結果が空でした。モデルと接続先を確認してください。');
    return translated;
  }

  async function translateStream(text, settings, handlers = {}, requestOptions = {}) {
    const cfg = getConfig(settings);
    const messages = [
      { role: 'system', content: getSystemPrompt(settings) },
      ...(requestOptions.messages || [{ role: 'user', content: text }])
    ];

    return makeStreamingApiRequest(
      cfg.apiUrl,
      {
        method: 'POST',
        headers: cfg.headers,
        redirect: 'error',
        body: JSON.stringify({
          model: cfg.model,
          messages,
          temperature: 0.2,
          stream: true,
          ...cfg.requestBodyOptions
        }),
        timeoutMs: requestOptions.timeoutMs ?? TRANSLATION_TIMEOUT_MS,
        signal: requestOptions.signal
      },
      handlers,
      `${providerLabel} API ストリーミング中にエラーが発生`
    );
  }

  function imageMessages(imageInput, messages) {
    if (!/^data:image\/[a-z0-9.+-]+;base64,/i.test(imageInput?.dataUrl || '')) {
      throw new Error('画像入力データが不正です');
    }
    return imageConversationMessages(messages, text => [
      { type: 'text', text },
      { type: 'image_url', image_url: { url: imageInput.dataUrl } }
    ]);
  }

  async function translateImage(imageInput, settings, requestOptions = {}) {
    return translate('', settings, { ...requestOptions, messages: imageMessages(imageInput, requestOptions.messages) });
  }

  async function translateImageStream(imageInput, settings, handlers, requestOptions = {}) {
    return translateStream('', settings, handlers, { ...requestOptions, messages: imageMessages(imageInput, requestOptions.messages) });
  }

  async function translateBatchStructured(texts, settings, requestOptions = {}) {
    const cfg = getConfig(settings);
    const items = buildStructuredBatchItems(texts);
    const instr = buildStructuredBatchInstruction(settings);
    const messages = [
      {
        role: 'system',
        content: 'あなたは翻訳結果を厳密なJSONとして返すアシスタントです。JSON以外は出力しないでください。'
      },
      {
        role: 'user',
        content: `${instr}\n\nitems = ${JSON.stringify(items)}`
      }
    ];

    const formats = responseFormatCandidates(settings) || getDefaultResponseFormatCandidates();
    let lastError = null;

    for (let i = 0; i < formats.length; i++) {
      const responseFormat = formats[i];
      try {
        const streaming = typeof requestOptions.onDelta === 'function';
        const request = streaming ? makeStreamingApiRequest : makeApiRequest;
        const data = await request(
          cfg.apiUrl,
          {
            method: 'POST',
            headers: cfg.headers,
            redirect: 'error',
            body: JSON.stringify({
              model: cfg.model,
              messages,
              temperature: 0.2,
              stream: streaming,
              response_format: responseFormat,
              ...cfg.requestBodyOptions
            }),
            timeoutMs: requestOptions.timeoutMs ?? TRANSLATION_TIMEOUT_MS,
            signal: requestOptions.signal
          },
          ...(streaming ? [{ onDelta: requestOptions.onDelta }] : []),
          `${providerLabel} API (structured batch) リクエスト中にエラーが発生`
        );

        return parseStructuredBatchResponse(streaming ? data : extractChatMessageContent(data), texts);
      } catch (error) {
        if (!canFallbackAfterError(error)) throw error;
        lastError = error;
        if (i >= formats.length - 1) break;
      }
    }

    throw lastError || new Error(`${providerLabel} structured batch translation failed`);
  }

  return {
    translate,
    translateImage,
    translateImageStream,
    translateStream,
    translateBatchStructured,
    translateBatchStructuredStream: (texts, settings, handlers, options) =>
      translateBatchStructured(texts, settings, { ...options, onDelta: handlers.onDelta }),
    ...extras
  };
}
