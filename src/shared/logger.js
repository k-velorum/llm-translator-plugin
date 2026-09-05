import { getErrorLogLevel, normalizeError } from './errors.js';
import { appendLog } from '../background/logging.js';

const REDACTED = '[redacted]';
const SENSITIVE_KEY_PATTERN = /api[-_]?key|authorization|token|secret|password/i;

export const log = {
  debug: (scope, message, meta) => emit('debug', scope, message, meta),
  info: (scope, message, meta) => emit('info', scope, message, meta),
  warn: (scope, message, meta) => emit('warn', scope, message, meta),
  error: (scope, message, meta) => emit('error', scope, message, meta)
};

export function createScopedLogger(scope, level = 'error') {
  const normalizedLevel = typeof log[level] === 'function' ? level : 'error';
  return (message, meta) => log[normalizedLevel](scope, message, meta);
}

export function sanitizeForLog(value) {
  if (value instanceof Error) {
    return normalizeError(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeForLog(item));
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  const output = {};
  for (const [key, item] of Object.entries(value)) {
    output[key] = SENSITIVE_KEY_PATTERN.test(key) ? redactValue(item) : sanitizeForLog(item);
  }
  return output;
}

function redactValue(value) {
  if (value === undefined || value === null || value === '') return value;
  return REDACTED;
}

function emit(level, scope, message, meta) {
  const error = meta?.error || meta;
  if (level === 'error') level = getErrorLogLevel(error);
  // Chromeはconsole.warnも収集する。対処可能な警告は内部ログに残し、consoleにはinfoで出す。
  const method = level === 'debug' ? 'debug' : level === 'error' ? 'error' : 'info';
  const logger = console[method] || console.log;
  const sanitizedMeta = sanitizeForLog(meta);
  const prefix = scope ? `[${scope}]` : '[app]';

  if (sanitizedMeta === undefined) {
    logger(prefix, message);
  } else {
    logger(prefix, message, sanitizedMeta);
  }

  if (level === 'warn' || level === 'error' || String(scope || '').startsWith('pageTranslation')) {
    appendLog({
      level,
      type: 'log',
      event: scope,
      message: typeof message === 'string' ? message : String(message),
      meta: sanitizedMeta
    }).catch(() => {});
  }
}
