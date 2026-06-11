export function normalizeError(error, context = {}) {
  const base = extractErrorShape(error);
  return {
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
