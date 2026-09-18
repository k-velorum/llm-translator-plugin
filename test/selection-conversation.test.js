import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSessionStorage } from './helpers/session-storage.js';
import { createSelectionConversation, loadSelectionConversation, saveSelectionAnswer,
  buildConversationRequest, discardSelectionConversation, discardSelectionConversationsForTab
} from '../src/background/selection-conversation.js';
import { handleBackgroundMessage } from '../src/background/message-handlers.js';
import { translateTextStream } from '../src/background/api.js';
vi.mock('../src/background/api.js', () => ({ translateTextStream: vi.fn(), translateText: vi.fn(), getProviderCapabilities: vi.fn() }));
vi.mock('../src/background/logging.js', () => ({ appendLog: vi.fn(), getProviderMeta: () => ({}) }));

const settings = { apiProvider: 'openai', translationSystemPrompt: '日本語に翻訳してください。', model: 'original-model' };
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('chrome', { storage: { session: createSessionStorage() }, tabs: { sendMessage: vi.fn(async () => ({})) } });
});
afterEach(() => vi.unstubAllGlobals());

describe('選択翻訳の会話', () => {
  it('原文・初回指示・過去の全ターンと接続設定を維持する', async () => {
    const initial = await createSelectionConversation(1, 3, '中文原文', settings);
    await saveSelectionAnswer(1, 3, initial, '中文回答');
    const loaded = await loadSelectionConversation(1, 3, initial.id);
    await saveSelectionAnswer(1, 3, loaded, '日本語の回答', '日本語にして');
    const request = buildConversationRequest(await loadSelectionConversation(1, 3, initial.id), 'もっと自然に');
    expect(request.messages).toEqual([
      { role: 'user', content: '中文原文' }, { role: 'assistant', content: '中文回答' },
      { role: 'user', content: '日本語にして' }, { role: 'assistant', content: '日本語の回答' },
      { role: 'user', content: 'もっと自然に' }
    ]);
    expect(request.settings.model).toBe('original-model');
    expect(request.input).toBe('もっと自然に');
    expect(request.settings.translationSystemPrompt).toBe(settings.translationSystemPrompt);
    expect(settings.translationSystemPrompt).toBe('日本語に翻訳してください。');
  });
  it('別タブ・別フレーム・旧会話から参照できず、古い結果で新しい会話を上書きしない', async () => {
    const old = await createSelectionConversation(1, 3, '原文', settings);
    await expect(loadSelectionConversation(2, 3, old.id)).rejects.toThrow();
    await expect(loadSelectionConversation(1, 0, old.id)).rejects.toThrow();
    const fresh = await createSelectionConversation(1, 3, '次の原文', settings);
    await expect(saveSelectionAnswer(1, 3, old, '遅延回答')).rejects.toThrow();
    await discardSelectionConversation(1, 3, old.id);
    expect((await loadSelectionConversation(1, 3, fresh.id)).messages).toHaveLength(1);
    await discardSelectionConversation(1, 3, fresh.id);
    await expect(loadSelectionConversation(1, 3, fresh.id)).rejects.toThrow();
  });
  it('タブ終了時はそのタブの履歴だけを破棄する', async () => {
    const first = await createSelectionConversation(1, 0, 'a', settings);
    const second = await createSelectionConversation(2, 0, 'b', settings);
    await discardSelectionConversationsForTab(1);
    await expect(loadSelectionConversation(1, 0, first.id)).rejects.toThrow();
    expect((await loadSelectionConversation(2, 0, second.id)).id).toBe(second.id);
  });
  it('失敗・空回答を履歴に残さず、同じ指示で再送できる', async () => {
    const initial = await createSelectionConversation(1, 3, '原文', settings);
    await saveSelectionAnswer(1, 3, initial, '初回の回答');
    const send = async requestId => {
      handleBackgroundMessage({ action: 'continueSelectionConversation', requestId,
        conversationId: initial.id, text: '日本語にして' }, { tab: { id: 1 }, frameId: 3 }, () => {});
      await vi.waitFor(() => expect(globalThis.chrome.tabs.sendMessage).toHaveBeenCalledWith(1,
        expect.objectContaining({ requestId, action: expect.stringMatching(/translationStream(Error|Complete)/) }), { frameId: 3 }));
    };
    translateTextStream.mockRejectedValueOnce(new Error('通信失敗')).mockResolvedValueOnce('').mockResolvedValueOnce('日本語の回答');
    await send('failed');
    await send('empty');
    expect((await loadSelectionConversation(1, 3, initial.id)).messages).toHaveLength(2);
    await send('retry');
    expect((await loadSelectionConversation(1, 3, initial.id)).messages).toHaveLength(4);
    expect(translateTextStream.mock.calls[2][0]).toBe('日本語にして');
    expect(translateTextStream.mock.calls[2][3].messages).toHaveLength(3);
  });
});
