import { afterEach, describe, expect, it, vi } from 'vitest';

import cerebrasProvider from '../src/background/api/providers/cerebras.js';

const settings = {
  apiProvider: 'cerebras',
  cerebrasApiKey: 'test-cerebras-key',
  cerebrasModel: 'llama3.1-8b'
};

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

describe('cerebras provider', () => {
  it('builds the current chat completion request for text translation', async () => {
    const fetch = vi.fn(async () =>
      mockJsonResponse({
        choices: [{ message: { content: ' 翻訳済み ' } }]
      })
    );
    globalThis.fetch = fetch;

    await expect(cerebrasProvider.translate('hello', settings)).resolves.toBe('翻訳済み');

    const [url, options] = fetch.mock.calls[0];
    expect(url).toBe('https://api.cerebras.ai/v1/chat/completions');
    expect(options.headers).toEqual({
      'Content-Type': 'application/json',
      'Authorization': 'Bearer test-cerebras-key'
    });
    expect(JSON.parse(options.body)).toMatchObject({
      model: 'llama3.1-8b',
      temperature: 0.2,
      stream: false,
      messages: [
        { role: 'system', content: expect.any(String) },
        { role: 'user', content: 'hello' }
      ]
    });
  });

  it('uses OpenAI-compatible SSE streaming', async () => {
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            'data: {"choices":[{"delta":{"content":"こ"}}]}\n\n' +
            'data: {"choices":[{"delta":{"content":"んにちは"}}]}\n\n' +
            'data: [DONE]\n\n'
          )
        );
        controller.close();
      }
    });
    globalThis.fetch = vi.fn(async () => ({ ok: true, body }));

    await expect(cerebrasProvider.translateStream('hello', settings)).resolves.toBe('こんにちは');
  });

  it('keeps the structured batch response_format fallback order', async () => {
    const fetch = vi.fn(async () =>
      mockJsonResponse({
        choices: [
          {
            message: {
              content: '{"items":[{"id":0,"translation":"一"},{"id":1,"translation":"二"}]}'
            }
          }
        ]
      })
    );
    globalThis.fetch = fetch;

    await expect(cerebrasProvider.translateBatchStructured(['one', 'two'], settings)).resolves.toEqual(['一', '二']);

    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.response_format).toMatchObject({
      type: 'json_schema',
      json_schema: {
        name: 'translations',
        strict: true
      }
    });
  });
});
