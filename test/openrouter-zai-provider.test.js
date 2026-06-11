import { afterEach, describe, expect, it, vi } from 'vitest';

import openrouterProvider, {
  OPENROUTER_HEADERS_BASE
} from '../src/background/api/providers/openrouter.js';
import zaiProvider from '../src/background/api/providers/zai.js';

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

describe('openrouter provider', () => {
  it('keeps the current non-streaming translation body shape', async () => {
    const fetch = vi.fn(async () =>
      mockJsonResponse({
        choices: [{ message: { content: ' 翻訳済み ' } }]
      })
    );
    globalThis.fetch = fetch;

    await expect(
      openrouterProvider.translate('hello', {
        apiProvider: 'openrouter',
        openrouterApiKey: 'test-openrouter-key',
        openrouterModel: 'openai/gpt-4o-mini'
      })
    ).resolves.toBe('翻訳済み');

    const [url, options] = fetch.mock.calls[0];
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(options.headers).toEqual({
      'Content-Type': 'application/json',
      'Authorization': 'Bearer test-openrouter-key',
      ...OPENROUTER_HEADERS_BASE
    });
    expect(JSON.parse(options.body)).toEqual({
      model: 'openai/gpt-4o-mini',
      messages: [
        { role: 'system', content: expect.any(String) },
        { role: 'user', content: 'hello' }
      ]
    });
  });

  it('verifies API keys through the provider models endpoint', async () => {
    const fetch = vi.fn(async () => mockJsonResponse({ data: [{ id: 'openai/gpt-4o-mini' }] }));
    globalThis.fetch = fetch;

    await expect(
      openrouterProvider.verify({ apiKey: 'test-openrouter-key' }, {})
    ).resolves.toEqual({
      success: true,
      models: [{ id: 'openai/gpt-4o-mini' }]
    });

    const [url, options] = fetch.mock.calls[0];
    expect(url).toBe('https://openrouter.ai/api/v1/models');
    expect(options.headers).toEqual({
      'Authorization': 'Bearer test-openrouter-key',
      ...OPENROUTER_HEADERS_BASE
    });
  });

  it('loads models with the saved OpenRouter key when the message has no key', async () => {
    const fetch = vi.fn(async () => mockJsonResponse({ data: [{ id: 'anthropic/claude-haiku' }] }));
    globalThis.fetch = fetch;

    await expect(
      openrouterProvider.getModels({}, { openrouterApiKey: 'saved-openrouter-key' })
    ).resolves.toEqual([{ id: 'anthropic/claude-haiku' }]);

    const [url, options] = fetch.mock.calls[0];
    expect(url).toBe('https://openrouter.ai/api/v1/models');
    expect(options.headers).toEqual({
      'Authorization': 'Bearer saved-openrouter-key',
      ...OPENROUTER_HEADERS_BASE
    });
  });
});

describe('zai provider', () => {
  it('uses json_object as the first structured batch response format', async () => {
    const fetch = vi.fn(async () =>
      mockJsonResponse({
        choices: [
          {
            message: {
              content: '{"items":[{"id":0,"translation":"一"}]}'
            }
          }
        ]
      })
    );
    globalThis.fetch = fetch;

    await expect(
      zaiProvider.translateBatchStructured(['one'], {
        apiProvider: 'zai',
        zaiApiKey: 'test-zai-key',
        zaiModel: 'glm-4.7'
      })
    ).resolves.toEqual(['一']);

    const [url, options] = fetch.mock.calls[0];
    expect(url).toBe('https://api.z.ai/api/paas/v4/chat/completions');
    expect(options.headers).toEqual({
      'Content-Type': 'application/json',
      'Authorization': 'Bearer test-zai-key',
      'Accept-Language': 'en-US,en'
    });
    expect(JSON.parse(options.body).response_format).toEqual({ type: 'json_object' });
  });
});
