import { afterEach, describe, expect, it, vi } from 'vitest';

import lmstudioProvider from '../src/background/api/providers/lmstudio.js';
import ollamaProvider from '../src/background/api/providers/ollama.js';

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

describe('ollama provider', () => {
  it('builds the current /api/generate translation request', async () => {
    const fetch = vi.fn(async () => mockJsonResponse({ response: ' 翻訳済み ' }));
    globalThis.fetch = fetch;

    await expect(
      ollamaProvider.translate('hello', {
        ollamaServer: 'http://localhost:11434/',
        ollamaModel: 'qwen'
      })
    ).resolves.toBe('翻訳済み');

    const [url, options] = fetch.mock.calls[0];
    expect(url).toBe('http://localhost:11434/api/generate');
    expect(JSON.parse(options.body)).toMatchObject({
      model: 'qwen',
      stream: false
    });
    expect(JSON.parse(options.body).prompt).toContain('hello');
  });

  it('keeps structured batch format fallback order', async () => {
    const fetch = vi.fn(async () =>
      mockJsonResponse({
        response: '{"items":[{"id":0,"translation":"一"}]}'
      })
    );
    globalThis.fetch = fetch;

    await expect(
      ollamaProvider.translateBatchStructured(['one'], {
        ollamaServer: 'http://localhost:11434',
        ollamaModel: 'qwen'
      })
    ).resolves.toEqual(['一']);

    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.format).toMatchObject({
      type: 'object',
      required: ['items']
    });
  });

  it('loads models from the requested server before falling back to settings', async () => {
    const fetch = vi.fn(async () => mockJsonResponse({ models: [{ name: 'qwen3' }] }));
    globalThis.fetch = fetch;

    await expect(
      ollamaProvider.getModels({ server: 'http://192.0.2.10:11434/' }, { ollamaServer: 'http://localhost:11434' })
    ).resolves.toEqual([{ id: 'qwen3', name: 'qwen3' }]);

    expect(fetch.mock.calls[0][0]).toBe('http://192.0.2.10:11434/api/tags');
  });
});

describe('lmstudio provider', () => {
  it('builds the OpenAI-compatible chat completion request', async () => {
    const fetch = vi.fn(async () =>
      mockJsonResponse({
        choices: [{ message: { content: ' 翻訳済み ' } }]
      })
    );
    globalThis.fetch = fetch;

    await expect(
      lmstudioProvider.translate('hello', {
        lmstudioServer: 'http://localhost:1234/',
        lmstudioModel: 'local-model',
        lmstudioApiKey: 'optional-key'
      })
    ).resolves.toBe('翻訳済み');

    const [url, options] = fetch.mock.calls[0];
    expect(url).toBe('http://localhost:1234/v1/chat/completions');
    expect(options.headers).toEqual({
      'Content-Type': 'application/json',
      'Authorization': 'Bearer optional-key'
    });
    expect(JSON.parse(options.body)).toMatchObject({
      model: 'local-model',
      temperature: 0.2,
      stream: false,
      messages: [
        { role: 'system', content: expect.any(String) },
        { role: 'user', content: 'hello' }
      ]
    });
  });
});

describe('lmstudio provider image and model endpoints', () => {
  it('sends the image translation request in the /api/v1/chat shape', async () => {
    const fetch = vi.fn(async () =>
      mockJsonResponse({
        output: [
          {
            type: 'message',
            content: [{ text: '画像内テキスト' }]
          }
        ]
      })
    );
    globalThis.fetch = fetch;

    await expect(
      lmstudioProvider.translateImage(
        { dataUrl: 'data:image/png;base64,xxx', mimeType: 'image/png' },
        {
          lmstudioServer: 'http://localhost:1234',
          lmstudioModel: 'vision-model'
        }
      )
    ).resolves.toBe('画像内テキスト');

    const [url, options] = fetch.mock.calls[0];
    expect(url).toBe('http://localhost:1234/api/v1/chat');
    expect(JSON.parse(options.body)).toMatchObject({
      model: 'vision-model',
      input: [
        { type: 'text', content: expect.any(String) },
        { type: 'image', data_url: 'data:image/png;base64,xxx' }
      ],
      temperature: 0.2,
      stream: false,
      store: false
    });
  });

  it('loads models from a Tailscale LM Studio server with an optional key', async () => {
    const fetch = vi.fn(async () =>
      mockJsonResponse({
        data: [{ id: 'local-model' }]
      })
    );
    globalThis.fetch = fetch;

    await expect(
      lmstudioProvider.getModels(
        { server: 'http://100.115.98.13:1234', apiKey: 'message-key' },
        { lmstudioServer: 'http://localhost:1234', lmstudioApiKey: 'saved-key' }
      )
    ).resolves.toEqual([{ id: 'local-model', name: 'local-model' }]);

    const [url, options] = fetch.mock.calls[0];
    expect(url).toBe('http://100.115.98.13:1234/v1/models');
    expect(options.headers).toEqual({
      'Authorization': 'Bearer message-key'
    });
  });
});
