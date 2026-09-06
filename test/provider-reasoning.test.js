import { afterEach, describe, expect, it, vi } from 'vitest';
import openrouter from '../src/background/api/providers/openrouter.js';
import cerebras from '../src/background/api/providers/cerebras.js';
import zai from '../src/background/api/providers/zai.js';
import { normalizeConnectionSettings } from '../src/shared/connections.js';

const cases = [
  ['openrouter', openrouter, 'off', { reasoning: { enabled: false } }],
  ['openrouter', openrouter, 'on', { reasoning: { enabled: true } }],
  ...['minimal', 'low', 'medium', 'high', 'xhigh'].map(value =>
    ['openrouter', openrouter, value, { reasoning: { effort: value } }]),
  ['cerebras', cerebras, 'off', { reasoning_effort: 'none' }],
  ['cerebras', cerebras, 'on', { reasoning_effort: 'medium' }],
  ...['low', 'medium', 'high'].map(value =>
    ['cerebras', cerebras, value, { reasoning_effort: value }]),
  ['zai', zai, 'off', { thinking: { type: 'disabled' } }],
  ['zai', zai, 'on', { thinking: { type: 'enabled' } }]
];

afterEach(() => vi.unstubAllGlobals());

function fakeFetch(stream = false) {
  const fetch = vi.fn(async () => stream
    ? new Response('data: {"choices":[{"delta":{"content":"訳文"}}]}\n\ndata: [DONE]\n\n')
    : new Response(JSON.stringify({ choices: [{ message: { content: '{"items":[[0,"訳文"]]}' } }] })));
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

function settings(id, value) {
  return { [`${id}ApiKey`]: 'test-key', [`${id}Model`]: 'test-model', [`${id}Reasoning`]: value,
    // 他の接続先の保存値が混入しないことも検証する。
    lmstudioReasoning: 'high' };
}

describe.each(cases)('%sの推論設定 %s %s', (id, provider, value, expected) => {
  it.each(['translate', 'translateBatchStructured', 'translateStream'])('%sへ固有の形式で渡す', async method => {
    const fetch = fakeFetch(method === 'translateStream');
    await provider[method](method === 'translateBatchStructured' ? ['text'] : 'text', settings(id, value));
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body).toMatchObject(expected);
    for (const field of ['reasoning', 'reasoning_effort', 'thinking']) {
      if (!(field in expected)) expect(body).not.toHaveProperty(field);
    }
  });
});

describe.each([['openrouter', openrouter], ['cerebras', cerebras], ['zai', zai]])('%sの既定設定', (id, provider) => {
  it.each([undefined, 'default', 'invalid'])('値が%sなら推論設定を送信しない', async value => {
    const fetch = fakeFetch();
    await provider.translate('text', settings(id, value));
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    for (const field of ['reasoning', 'reasoning_effort', 'thinking']) expect(body).not.toHaveProperty(field);
  });
});

describe('接続先別の推論設定の移行', () => {
  it('非選択の接続先も含めて設定を維持する', () => {
    const migrated = normalizeConnectionSettings({ apiProvider: 'zai', openrouterReasoning: 'xhigh',
      cerebrasReasoning: 'low', zaiReasoning: 'off', lmstudioReasoning: 'on' });
    expect(migrated).toMatchObject({ apiProvider: 'openai', openaiPreset: 'zai', openaiConnections: {
      openrouter: { reasoning: 'xhigh' }, cerebras: { reasoning: 'low' },
      zai: { reasoning: 'off' }, lmstudio: { reasoning: 'on' }
    } });
  });
  it('無効な旧保存値は既定に戻す', () => {
    expect(normalizeConnectionSettings({ zaiReasoning: 'high' }).openaiConnections.zai.reasoning).toBe('default');
  });
});
