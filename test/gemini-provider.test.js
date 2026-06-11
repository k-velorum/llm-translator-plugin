import { afterEach, describe, expect, it, vi } from 'vitest';

import geminiProvider from '../src/background/api/providers/gemini.js';

function mockJsonResponse(payload) {
  return {
    ok: true,
    json: async () => payload
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  delete globalThis.fetch;
});

describe('gemini provider', () => {
  it('verifies API keys through the Gemini models endpoint', async () => {
    const fetch = vi.fn(async () => mockJsonResponse({ models: [] }));
    globalThis.fetch = fetch;

    await expect(
      geminiProvider.verify({ apiKey: 'test-gemini-key' }, {})
    ).resolves.toEqual({ success: true });

    expect(fetch.mock.calls[0][0]).toBe('https://generativelanguage.googleapis.com/v1beta/models?key=test-gemini-key');
    expect(fetch.mock.calls[0][1]).toMatchObject({ method: 'GET' });
  });

  it('normalizes Gemini model list entries', async () => {
    const fetch = vi.fn(async () =>
      mockJsonResponse({
        models: [
          {
            name: 'models/gemini-2.5-flash',
            displayName: 'Gemini 2.5 Flash',
            inputTokenLimit: 1048576
          }
        ]
      })
    );
    globalThis.fetch = fetch;

    await expect(
      geminiProvider.getModels({ apiKey: 'test-gemini-key' }, {})
    ).resolves.toEqual([
      {
        id: 'gemini-2.5-flash',
        name: 'Gemini 2.5 Flash',
        context_length: 1048576
      }
    ]);
  });
});
