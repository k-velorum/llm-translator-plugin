export function normalizeError(error, context = {}) {
  const base = extractErrorShape(error);
  return {
    ...getErrorPolicy(error),
    message: base.message || context.message || 'unknown error',
    details: base.details || context.details || '',
    ...(base.name ? { name: base.name } : {}),
    ...(base.status !== undefined ? { status: base.status } : {}),
    ...(context.provider ? { provider: context.provider } : {})
  };
}

export function serializeError(error, context = {}) {
  const normalized = normalizeError(error, context);
  return {
    ...getErrorPolicy(normalized),
    name: normalized.name || error?.name || 'Error',
    message: normalized.message,
    details: normalized.details,
    ...(normalized.status !== undefined ? { status: normalized.status } : {}),
    ...(normalized.provider ? { provider: normalized.provider } : {})
  };
}

function extractErrorShape(error) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      details: error.stack || '',
      status: error.status ?? error.cause?.status
    };
  }

  if (typeof error === 'string') {
    return { message: error, details: '' };
  }

  if (error && typeof error === 'object') {
    return {
      name: stringOrEmpty(error.name),
      message: stringOrEmpty(error.message) || stringOrEmpty(error.error),
      details: stringOrEmpty(error.details) || stringOrEmpty(error.stack),
      status: error.status ?? error.statusCode
    };
  }

  return { message: String(error || 'unknown error'), details: '' };
}

function stringOrEmpty(value) {
  return typeof value === 'string' ? value : '';
}

// retryable は同じリクエストの再送可否。入力形式変更の可否とは分ける。
const HTTP_POLICIES = {
  400: ['invalid_request', false, 'モデルと送信内容・対応パラメータを確認してください。'],
  401: ['authentication', false, 'APIキーと有効期限を確認してください。'],
  402: ['payment_required', false, 'API提供元の残高・請求設定・モデルの利用条件を確認してください。'],
  403: ['permission_denied', false, 'モデルの利用権限やAPI提供元のアクセス設定を確認してください。'],
  404: ['not_found', false, 'モデル名と接続先URLを確認してください。'],
  408: ['timeout', true, '時間をおいて再試行するか、翻訳する文章を短くしてください。'],
  413: ['input_too_large', false, '翻訳する文章や画像を小さくしてください。'],
  422: ['invalid_request', false, 'モデルと送信内容・対応パラメータを確認してください。'],
  429: ['rate_limited', true, '時間をおいて再試行してください。繰り返す場合は並列数や利用上限を確認してください。']
};

export function getErrorPolicy(error) {
  const status = error?.status ?? error?.statusCode ?? error?.cause?.status;
  let policy = HTTP_POLICIES[status];
  if (!policy && status >= 500 && status < 600) {
    policy = ['service_unavailable', true, 'API提供元の稼働状況を確認し、時間をおいて再試行してください。'];
  }
  policy ||= getRuntimeErrorPolicy(error);
  if (!policy) return {};
  const [code, retryable, hint] = policy;
  return { code, retryable, hint };
}

function getRuntimeErrorPolicy(error) {
  let policy;
  if (error?.name === 'TimeoutError') policy = HTTP_POLICIES[408];
  if (!policy && error?.name === 'AbortError') policy = ['cancelled', false, ''];
  if (!policy && error?.name === 'TypeError' && /Failed to fetch|fetch failed|NetworkError/.test(error.message)) {
    policy = ['network', true, '接続先サーバーの起動状態・ネットワーク・CORS設定を確認してください。'];
  }
  return policy;
}

// 認証・課金・通信障害には、JSON形式変更や文章の分割は効果がない。
export function canFallbackAfterError(error) {
  const { code } = getErrorPolicy(error);
  return !code || ['invalid_request', 'input_too_large'].includes(code);
}

export function shouldPauseTranslationQueue(error) {
  const { code } = getErrorPolicy(error);
  return ['authentication', 'payment_required', 'permission_denied', 'not_found',
    'rate_limited', 'service_unavailable', 'network'].includes(code);
}

export function formatUserError(error) {
  const normalized = normalizeError(error);
  return [normalized.message, normalized.hint].filter(Boolean).join('\n');
}
