import { describe, expect, it } from 'vitest';

import { normalizeError, serializeError } from '../src/shared/errors.js';

describe('normalizeError', () => {
  it('normalizes Error objects', () => {
    const error = new Error('失敗しました');
    error.status = 503;

    expect(normalizeError(error)).toMatchObject({
      name: 'Error',
      message: '失敗しました',
      status: 503
    });
  });

  it('normalizes plain strings', () => {
    expect(normalizeError('plain failure')).toEqual({
      message: 'plain failure',
      details: ''
    });
  });

  it('preserves existing message/details shapes', () => {
    expect(normalizeError({ message: 'bad request', details: 'stack', statusCode: 400 })).toEqual({
      message: 'bad request',
      details: 'stack',
      status: 400
    });
  });
});

describe('serializeError', () => {
  it('keeps a name field for offscreen responses', () => {
    expect(serializeError('failed')).toEqual({
      name: 'Error',
      message: 'failed',
      details: ''
    });
  });
});
