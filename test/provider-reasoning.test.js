import { afterEach, describe, expect, it, vi } from 'vitest';
import openrouter from '../src/background/api/providers/openrouter.js';
import cerebras from '../src/background/api/providers/cerebras.js';
import zai from '../src/background/api/providers/zai.js';
import { collectSettings, loadSettings } from '../src/popup/settings-form.js';
import { REASONING_OPTIONS } from '../src/shared/reasoning.js';

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

describe('接続先別の推論設定の保存・復元', () => {
  it('接続先を切り替えてもそれぞれの選択値を維持する', async () => {
    const elements = { apiProviderSelect: { value: 'openrouter' },
      openrouterReasoningSelect: { value: 'xhigh' }, cerebrasReasoningSelect: { value: 'low' },
      zaiReasoningSelect: { value: 'off' }, lmstudioReasoningSelect: { value: 'on' } };
    const saved = collectSettings(elements);
    vi.stubGlobal('chrome', { runtime: {}, storage: { sync: { get: (_keys, cb) => cb(saved) } } });
    for (const id of Object.keys(REASONING_OPTIONS)) elements[`${id}ReasoningSelect`].value = '';
    await loadSettings(elements);
    expect(elements.openrouterReasoningSelect.value).toBe('xhigh');
    expect(elements.cerebrasReasoningSelect.value).toBe('low');
    expect(elements.zaiReasoningSelect.value).toBe('off');
    expect(elements.lmstudioReasoningSelect.value).toBe('on');
    elements.apiProviderSelect.value = 'zai';
    expect(collectSettings(elements)).toEqual({ ...saved, apiProvider: 'zai' });
  });

  it('無効な保存値は既定に戻す', async () => {
    const elements = { apiProviderSelect: {}, zaiReasoningSelect: {} };
    vi.stubGlobal('chrome', { runtime: {}, storage: { sync: { get: (_keys, cb) => cb({ zaiReasoning: 'high' }) } } });
    await loadSettings(elements);
    expect(elements.zaiReasoningSelect.value).toBe('default');
  });
});
