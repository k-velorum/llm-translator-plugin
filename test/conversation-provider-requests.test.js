import { afterEach, describe, expect, it, vi } from 'vitest';
import { translateTextStream } from '../src/background/api.js';
import { buildConversationRequest } from '../src/background/selection-conversation.js';

const systemPrompt = '指示された文章を日本語に翻訳してください。翻訳結果のみを出力してください。';
const history = [
  { role: 'user', content: '这是原文。' },
  { role: 'assistant', content: '这是回答。' }
];
const instruction = '中国語のままです。日本語にしてください。';
const messages = [...history, { role: 'user', content: instruction }];
const openaiSettings = streaming => ({ apiProvider: 'openai', translationSystemPrompt: systemPrompt,
  openaiPreset: 'custom', openaiConnections: { custom: {
    baseUrl: 'https://example.test/v1', model: 'test-model', streaming
  } } });
afterEach(() => vi.unstubAllGlobals());

describe('会話の送信形式', () => {
  it.each([true, false])('OpenAI互換 streaming=%s: 初回指示を変えずロール付き履歴を送る', async streaming => {
    const settings = openaiSettings(streaming);
    const response = streaming
      ? () => new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: '回答' } }] })}\n\ndata: [DONE]\n\n`)
      : () => new Response(JSON.stringify({ choices: [{ message: { content: '回答' } }] }));
    const fetch = vi.fn(async () => response());
    vi.stubGlobal('fetch', fetch);
    await translateTextStream(history[0].content, settings);
    const initialBody = JSON.parse(fetch.mock.calls[0][1].body);
    const request = buildConversationRequest({ settings, messages: history }, instruction);
    await translateTextStream(request.input, request.settings, {}, { messages: request.messages });
    const followupBody = JSON.parse(fetch.mock.calls[1][1].body);
    expect(followupBody.messages).toEqual([initialBody.messages[0], ...messages]);
    expect(followupBody.messages[0]).toEqual({ role: 'system', content: systemPrompt });
    expect(followupBody.messages.filter(message => message.role === 'system')).toHaveLength(1);
    expect(followupBody.messages.at(-1).content).toBe(instruction);
    expect(followupBody.model).toBe(initialBody.model);
  });

  it('Gemini: 同じsystemInstructionとuser/modelの履歴を送る', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '回答' }] } }] })));
    vi.stubGlobal('fetch', fetch);
    const settings = { apiProvider: 'gemini', geminiApiKey: 'dummy', geminiModel: 'test-model', translationSystemPrompt: systemPrompt };
    await translateTextStream(history[0].content, settings);
    const initialBody = JSON.parse(fetch.mock.calls[0][1].body);
    const request = buildConversationRequest({ settings, messages: history }, instruction);
    await translateTextStream(request.input, request.settings, {}, { messages: request.messages });
    const followupBody = JSON.parse(fetch.mock.calls[1][1].body);
    expect(followupBody.systemInstruction).toEqual(initialBody.systemInstruction);
    expect(followupBody.systemInstruction).toEqual({ parts: [{ text: systemPrompt }] });
    expect(followupBody.contents).toEqual(messages.map(message => ({
      role: message.role === 'assistant' ? 'model' : 'user', parts: [{ text: message.content }]
    })));
  });
});
