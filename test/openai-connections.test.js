import { afterEach, describe, expect, it, vi } from 'vitest';
import { normalizeConnectionSettings, getActiveConnection, normalizeBaseUrl,
  getConnectionCapabilities } from '../src/shared/connections.js';
import { translateText, translateTextStream, translateImage, translateBatchStructured } from '../src/background/api.js';
import { getProviderDefinition } from '../src/background/api/registry.js';
import { handleBackgroundMessage } from '../src/background/message-handlers.js';

const connectionSettings = (presetId, connection) => ({ apiProvider: 'openai', openaiPreset: presetId,
  openaiConnections: { [presetId]: connection } });
const mockResponse = content => new Response(JSON.stringify({ choices: [{ message: { content } }] }));
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('接続設定の移行', () => {
  it('非選択の接続先も含めてキー・URL・モデル・推論を保持する', () => {
    const settings = normalizeConnectionSettings({ apiProvider: 'lmstudio',
      lmstudioServer: 'http://192.0.2.1:1234/proxy/', lmstudioModel: 'local/model', lmstudioApiKey: 'local-key',
      lmstudioReasoning: 'off', openrouterApiKey: 'cloud-key', openrouterModel: 'cloud/model',
      openrouterReasoning: 'high', enableTwitterTranslation: false, selectionTranslationMode: 'replace' });
    expect(settings).toMatchObject({ apiProvider: 'openai', openaiPreset: 'lmstudio', openaiConnections: {
      lmstudio: { baseUrl: 'http://192.0.2.1:1234/proxy/v1', apiKey: 'local-key', model: 'local/model', reasoning: 'off' },
      openrouter: { apiKey: 'cloud-key', model: 'cloud/model', reasoning: 'high' }
    }, enableTwitterTranslation: false, selectionTranslationMode: 'replace' });
    expect(normalizeConnectionSettings(settings)).toEqual(settings);
  });
  it('保存済みの空欄を古いキーで埋め戻さず、他のプリセットとも混ぜない', () => {
    const settings = normalizeConnectionSettings({ ...connectionSettings('custom', {
      baseUrl: 'https://example.test/v1', apiKey: '', model: 'new-model', reasoning: 'low'
    }), openrouterApiKey: 'old-secret', customApiKey: 'stale-secret' });
    expect(getActiveConnection(settings)).toMatchObject({ apiKey: '', model: 'new-model' });
    expect(getActiveConnection({ ...settings, openaiPreset: 'openrouter' }).apiKey).toBe('old-secret');
  });
  it.each(['gemini', 'chromePrompt'])('%sの接続方式は変えない', apiProvider => {
    expect(normalizeConnectionSettings({ apiProvider, geminiApiKey: 'g-key' })).toMatchObject({ apiProvider, geminiApiKey: 'g-key' });
  });
  it('既に /v1 を含む旧URLへ /v1 を重複して付けない', () => {
    expect(getActiveConnection({ apiProvider: 'ollama', ollamaServer: 'http://localhost:11434/v1/' }).baseUrl)
      .toBe('http://localhost:11434/v1');
  });
});

describe('ベースURL', () => {
  it.each(['https://example.test/api/v4', 'http://localhost:1234/v1', 'https://example.test'])('%sを正規化する', url => {
    expect(normalizeBaseUrl(` ${url}/// `)).toBe(url);
  });
  it.each(['', '/v1', 'file:///tmp/api', 'ftp://example.test/v1', 'https://user:secret@example.test/v1',
    'https://example.test/v1?key=secret', 'https://example.test/v1#token',
    'https://example.test/v1/chat/completions', 'https://example.test/v1/models'])('%sを通信前に拒否する', url => {
    expect(() => normalizeBaseUrl(url)).toThrow();
  });
});

describe('OpenAI互換の共通経路', () => {
  it('任意パスのURLで翻訳し、選択中のキー・モデル・推論だけを送る', async () => {
    const fetch = vi.fn(async () => mockResponse('訳文'));
    vi.stubGlobal('fetch', fetch);
    const settings = connectionSettings('custom', { baseUrl: 'https://example.test/gateway/v4/',
      apiKey: 'custom-key', model: 'manual/model', reasoning: 'low' });
    settings.openrouterApiKey = 'other-secret';
    await expect(translateText('hello', settings)).resolves.toBe('訳文');
    const [url, request] = fetch.mock.calls[0];
    expect(url).toBe('https://example.test/gateway/v4/chat/completions');
    expect(request).toMatchObject({ headers: { Authorization: 'Bearer custom-key' }, redirect: 'error' });
    expect(JSON.parse(request.body)).toMatchObject({ model: 'manual/model', reasoning_effort: 'low' });
    expect(JSON.stringify(request)).not.toContain('other-secret');
  });
  it('カスタム接続はキーなしでも動作する', async () => {
    const fetch = vi.fn(async () => mockResponse([{ type: 'text', text: '訳文' }]));
    vi.stubGlobal('fetch', fetch);
    await expect(translateText('hello', connectionSettings('custom', {
      baseUrl: 'http://localhost:1234/v1', model: 'local-model', apiKey: ''
    }))).resolves.toBe('訳文');
    expect(fetch.mock.calls[0][1].headers).not.toHaveProperty('Authorization');
  });
  it('モデルが未入力の場合は通信しない', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    await expect(translateText('hello', connectionSettings('custom', { baseUrl: 'https://example.test/v1', model: '' })))
      .rejects.toThrow('モデル');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('Z-AIの推論形式・JSON形式をプリセットで維持する', async () => {
    const fetch = vi.fn(async () => mockResponse('{"items":[[0,"訳文"]]}'));
    vi.stubGlobal('fetch', fetch);
    await expect(translateBatchStructured(['hello'], connectionSettings('zai', {
      apiKey: 'z-key', model: 'z-model', reasoning: 'off'
    }))).resolves.toEqual(['訳文']);
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({
      thinking: { type: 'disabled' }, response_format: { type: 'json_object' }
    });
  });
  it('ストリームで完了前の差分を返す', async () => {
    const fetch = vi.fn(async () => new Response('data: {"choices":[{"delta":{"content":"訳文"}}]}\n\ndata: [DONE]\n\n'));
    vi.stubGlobal('fetch', fetch);
    const delta = vi.fn();
    await expect(translateTextStream('hello', connectionSettings('custom', {
      baseUrl: 'https://example.test/v1', model: 'm', streaming: true
    }), { onDelta: delta })).resolves.toBe('訳文');
    expect(delta).toHaveBeenCalledWith('訳文', '訳文', expect.anything());
  });
  it('LM Studio画像翻訳も編集したホストの共通APIへ送る', async () => {
    const fetch = vi.fn(async () => mockResponse('画像の訳文'));
    vi.stubGlobal('fetch', fetch);
    await expect(translateImage({ dataUrl: 'data:image/png;base64,AA==', mimeType: 'image/png' }, connectionSettings('lmstudio', {
      baseUrl: 'http://192.0.2.2:1234/proxy/v1/', apiKey: 'image-key', model: 'vision', reasoning: 'off'
    }))).resolves.toBe('画像の訳文');
    expect(fetch.mock.calls[0][0]).toBe('http://192.0.2.2:1234/proxy/v1/chat/completions');
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({ model: 'vision', reasoning_effort: 'none' });
  });
});

describe('モデル一覧と対応機能', () => {
  it('未保存のURLと空のキーをそのまま使い、保存済みキーを送らない', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ data: [{ id: 'manual-model' }] })));
    vi.stubGlobal('fetch', fetch);
    const models = await getProviderDefinition('openai').getModels({ presetId: 'custom', connection: {
      baseUrl: 'https://draft.test/api/v1', apiKey: '', model: ''
    } }, connectionSettings('custom', { baseUrl: 'https://saved.test/v1', apiKey: 'saved-secret' }));
    expect(models).toEqual([{ id: 'manual-model', name: 'manual-model' }]);
    expect(fetch.mock.calls[0][0]).toBe('https://draft.test/api/v1/models');
    expect(fetch.mock.calls[0][1].headers).not.toHaveProperty('Authorization');
  });
  it.each(['cerebras', 'zai'])('%sのURL編集後は固定の公開一覧を使わない', async presetId => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ data: [] })));
    vi.stubGlobal('fetch', fetch);
    await getProviderDefinition('openai').getModels({ presetId, connection: {
      baseUrl: 'https://custom.test/prefix', apiKey: ''
    } }, {});
    expect(fetch.mock.calls[0][0]).toBe('https://custom.test/prefix/models');
  });
  it('プリセットの標準値に加えて利用者のストリーム設定を反映する', () => {
    expect(getConnectionCapabilities(connectionSettings('custom', { streaming: false })).supportsStreaming).toBe(false);
    expect(getConnectionCapabilities(connectionSettings('ollama', {})).maxPageTranslationConcurrency).toBe(1);
    expect(getConnectionCapabilities(connectionSettings('lmstudio', {})).supportsImageTranslation).toBe(true);
  });
  it('contentに返す対応機能には接続情報やキーを含めない', async () => {
    vi.stubGlobal('chrome', { storage: { sync: { get: (_keys, callback) => callback({
      apiProvider: 'lmstudio', lmstudioApiKey: 'private-key', lmstudioModel: 'local-model'
    }) } } });
    const result = await new Promise(resolve => handleBackgroundMessage({ action: 'getTranslationCapabilities' }, {}, resolve));
    expect(result).toEqual({ capabilities: { supportsStreaming: true, streamProtocol: 'openai-chat-sse',
      supportsImageTranslation: true, maxPageTranslationConcurrency: null } });
  });
});
