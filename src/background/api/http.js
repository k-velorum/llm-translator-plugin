import { sleepWithSignal } from '../../shared/async-utils.js';
import { createScopedLogger, log } from '../../shared/logger.js';

const HTTP_429_RETRY_DELAY_MS = 500;
// 初回リクエストとは別に、429 発生時の再試行回数を表す。
const HTTP_429_MAX_RETRY_COUNT = 5;
const TRANSIENT_HTTP_MAX_RETRIES = 3;

function isRetriableHttpStatus(status) {
  return status === 429 || (status >= 500 && status < 600);
}

async function waitBeforeRetry({
  response,
  retryContext,
  errorMessage,
  logger,
  signal
}) {
  if (!isRetriableHttpStatus(response.status)) {
    return false;
  }

  if (response.status === 429) {
    if (retryContext.rateLimitRetries >= HTTP_429_MAX_RETRY_COUNT) {
      return false;
    }
    retryContext.rateLimitRetries += 1;
    logger(
      `${errorMessage}: HTTP 429 -> ${HTTP_429_RETRY_DELAY_MS}ms 待機後にリトライ (${retryContext.rateLimitRetries}/${HTTP_429_MAX_RETRY_COUNT})`
    );
    await sleepWithSignal(HTTP_429_RETRY_DELAY_MS, signal);
    return true;
  }

  if (retryContext.transientHttpRetries >= TRANSIENT_HTTP_MAX_RETRIES) {
    return false;
  }

  retryContext.transientHttpRetries += 1;
  const delay = Math.min(4000, 250 * Math.pow(2, retryContext.transientHttpRetries - 1));
  logger(
    `${errorMessage}: HTTP ${response.status} -> ${delay}ms 待機後にリトライ (${retryContext.transientHttpRetries}/${TRANSIENT_HTTP_MAX_RETRIES})`
  );
  await sleepWithSignal(delay, signal);
  return true;
}

function normalizeOpenAICompatibleDeltaText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((part) => {
      if (typeof part === 'string') return part;
      if (typeof part?.text === 'string') return part.text;
      return '';
    }).join('');
  }
  if (content && typeof content === 'object' && typeof content.text === 'string') {
    return content.text;
  }
  return '';
}

// APIリクエスト共通処理
export async function makeApiRequest(url, options = {}, errorMessage, logLevel = 'error') {
  const logger = createScopedLogger('api', logLevel);

  const timeoutMs = Number.isFinite(options?.timeoutMs) ? options.timeoutMs : null;
  const externalSignal = options?.signal;

  // fetch() へ渡すオプション（timeoutMs は独自）
  const baseOptions = { ...(options || {}) };
  delete baseOptions.timeoutMs;
  delete baseOptions.signal;

  const retryContext = {
    rateLimitRetries: 0,
    transientHttpRetries: 0
  };

  while (true) {
    let timeoutId = null;
    let timedOut = false;

    const controller = new AbortController();
    const onExternalAbort = () => controller.abort();

    try {
      if (externalSignal) {
        if (externalSignal.aborted) {
          controller.abort();
        } else {
          externalSignal.addEventListener('abort', onExternalAbort, { once: true });
        }
      }

      if (timeoutMs && timeoutMs > 0) {
        timeoutId = setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, timeoutMs);
      }

      const response = await fetch(url, { ...baseOptions, signal: controller.signal });

      if (!response.ok) {
        // Ollama の CORS で 403 が出やすいため、分かりやすいヒントを付与
        if (response.status === 403 && /\/api\/(generate|tags)/.test(url)) {
          throw new Error(
            'API Error: 403 Forbidden - おそらくOllamaのCORS設定が原因です。\n' +
            '環境変数 OLLAMA_ORIGINS を設定してサーバーを起動してください。例:\n' +
            '  macOS/Linux:  OLLAMA_ORIGINS=* ollama serve\n' +
            '  Windows(PowerShell):  $env:OLLAMA_ORIGINS="*"; ollama serve\n' +
            '特定の拡張IDのみ許可する場合は chrome-extension://<拡張ID> を指定してください。'
          );
        }

        if (await waitBeforeRetry({
          response,
          retryContext,
          errorMessage,
          logger,
          signal: externalSignal
        })) {
          continue;
        }

        let errorText = '';
        try {
          const errorData = await response.json();
          errorText = JSON.stringify(errorData);
          log.error('api', 'エラーレスポンス', errorData);
          throw new Error(`API Error: ${errorData.error?.message || response.statusText} (${response.status})`);
        } catch (_parseError) {
          try {
            errorText = await response.text();
            log.error('api', 'エラーテキスト', { errorText });
          } catch (_textError) {
            errorText = 'レスポンステキストを取得できませんでした';
          }
          throw new Error(`API Error: ${response.statusText} (${response.status}) - ${errorText}`);
        }
      }

      const data = await response.json();
      return data;
    } catch (error) {
      // タイムアウトは即失敗（リトライしない）
      if (timedOut) {
        const timeoutError = new Error(`API Error: request timed out after ${timeoutMs}ms`);
        timeoutError.name = 'TimeoutError';
        logger(`${errorMessage}:`, timeoutError);
        throw timeoutError;
      }

      // 明示的なキャンセル（Abort）は上位で扱う
      if (error && error.name === 'AbortError') {
        throw error;
      }

      // ネットワーク失敗は指数バックオフでリトライ
      const isNetworkError = (error instanceof TypeError && error.message === 'Failed to fetch');
      if (isNetworkError && retryContext.transientHttpRetries < TRANSIENT_HTTP_MAX_RETRIES) {
        retryContext.transientHttpRetries += 1;
        const delay = Math.min(4000, 250 * Math.pow(2, retryContext.transientHttpRetries - 1));
        logger(
          `${errorMessage}: ネットワークエラー -> ${delay}ms 待機後にリトライ (${retryContext.transientHttpRetries}/${TRANSIENT_HTTP_MAX_RETRIES})`
        );
        await sleepWithSignal(delay, externalSignal);
        continue;
      }
      logger(`${errorMessage}:`, error);
      throw error;
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
      if (externalSignal) {
        try { externalSignal.removeEventListener('abort', onExternalAbort); } catch (_) {}
      }
    }
  }
}

export async function makeStreamingApiRequest(url, options = {}, handlers = {}, errorMessage, logLevel = 'error') {
  const logger = createScopedLogger('api', logLevel);
  const timeoutMs = Number.isFinite(options?.timeoutMs) ? options.timeoutMs : null;
  const externalSignal = options?.signal;

  const baseOptions = { ...(options || {}) };
  delete baseOptions.timeoutMs;
  delete baseOptions.signal;

  const retryContext = {
    rateLimitRetries: 0,
    transientHttpRetries: 0
  };

  while (true) {
    let timeoutId = null;
    let timedOut = false;
    const controller = new AbortController();
    const onExternalAbort = () => controller.abort();

    try {
      if (externalSignal) {
        if (externalSignal.aborted) {
          controller.abort();
        } else {
          externalSignal.addEventListener('abort', onExternalAbort, { once: true });
        }
      }

      if (timeoutMs && timeoutMs > 0) {
        timeoutId = setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, timeoutMs);
      }

      const response = await fetch(url, { ...baseOptions, signal: controller.signal });
      if (!response.ok) {
        if (await waitBeforeRetry({
          response,
          retryContext,
          errorMessage,
          logger,
          signal: externalSignal
        })) {
          continue;
        }

        let errorText = '';
        try {
          const errorData = await response.json();
          errorText = JSON.stringify(errorData);
          throw new Error(`API Error: ${errorData.error?.message || response.statusText} (${response.status})`);
        } catch (_parseError) {
          try {
            errorText = await response.text();
          } catch (_) {
            errorText = 'レスポンステキストを取得できませんでした';
          }
          throw new Error(`API Error: ${response.statusText} (${response.status}) - ${errorText}`);
        }
      }

      if (!response.body) {
        throw new Error('API Error: ストリーム応答ボディが取得できませんでした');
      }

      return await readOpenAICompatibleSSE(response.body, handlers);
    } catch (error) {
      if (timedOut) {
        const timeoutError = new Error(`API Error: request timed out after ${timeoutMs}ms`);
        timeoutError.name = 'TimeoutError';
        logger(`${errorMessage}:`, timeoutError);
        throw timeoutError;
      }
      if (error && error.name === 'AbortError') {
        throw error;
      }
      logger(`${errorMessage}:`, error);
      throw error;
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
      if (externalSignal) {
        try { externalSignal.removeEventListener('abort', onExternalAbort); } catch (_) {}
      }
    }
  }
}

export async function readOpenAICompatibleSSE(stream, handlers = {}) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let aggregated = '';

  const processEvent = async (rawEvent) => {
    const lines = rawEvent.split(/\r?\n/);
    const dataLines = [];

    for (const line of lines) {
      if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
    }

    const payload = dataLines.join('\n').trim();
    if (!payload) return false;
    if (payload === '[DONE]') return true;

    let parsed;
    try {
      parsed = JSON.parse(payload);
    } catch (_) {
      throw new Error(`API Error: SSE payload JSON の解析に失敗しました: ${payload.slice(0, 200)}`);
    }

    if (parsed?.error?.message) {
      throw new Error(`API Error: ${parsed.error.message}`);
    }

    const deltaText = normalizeOpenAICompatibleDeltaText(parsed?.choices?.[0]?.delta?.content);
    if (deltaText) {
      aggregated += deltaText;
      await handlers.onDelta?.(deltaText, aggregated, parsed);
    }

    await handlers.onEvent?.(parsed);
    return false;
  };

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });

    let boundaryIndex = buffer.search(/\r?\n\r?\n/);
    while (boundaryIndex >= 0) {
      const rawEvent = buffer.slice(0, boundaryIndex);
      const separatorLength = buffer[boundaryIndex] === '\r' ? (buffer[boundaryIndex + 1] === '\n' && buffer[boundaryIndex + 2] === '\r' ? 4 : 2) : 2;
      buffer = buffer.slice(boundaryIndex + separatorLength);
      if (await processEvent(rawEvent)) {
        await handlers.onDone?.(aggregated);
        return aggregated;
      }
      boundaryIndex = buffer.search(/\r?\n\r?\n/);
    }

    if (done) {
      const rest = buffer.trim();
      if (rest) {
        await processEvent(rest);
      }
      await handlers.onDone?.(aggregated);
      return aggregated;
    }
  }
}
