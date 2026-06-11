import { describe, expect, it } from 'vitest';

import { sanitizeForLog } from '../src/shared/logger.js';

describe('sanitizeForLog', () => {
  it('redacts sensitive keys recursively', () => {
    expect(
      sanitizeForLog({
        apiKey: 'abc',
        nested: {
          Authorization: 'Bearer secret',
          value: 'visible'
        },
        list: [{ token: 'secret-token' }]
      })
    ).toEqual({
      apiKey: '[redacted]',
      nested: {
        Authorization: '[redacted]',
        value: 'visible'
      },
      list: [{ token: '[redacted]' }]
    });
  });
});
