import { describe, expect, it, vi, beforeEach } from 'vitest';
vi.mock('../src/background/settings.js', () => ({ loadSettings: vi.fn() }));
vi.mock('../src/background/api.js', () => ({ translateText: vi.fn() }));
import { loadSettings } from '../src/background/settings.js';
import { translateText } from '../src/background/api.js';
import { buildSummaryRequest, handleSelectionSummary } from '../src/background/selection-summary.js';

describe('選択要約', () => {
  beforeEach(() => vi.resetAllMocks());
  it('原文と現在の要約を保持し、相対的な長さを指示する', () => {
    for (const [adjustment, hint] of [['shorter', '約半分'], ['longer', '約1.5倍']]) {
      const request = buildSummaryRequest({ text: '原文の根拠', currentSummary: '現在の結論', adjustment });
      expect(JSON.parse(request.input)).toEqual({ originalText: '原文の根拠', currentSummary: '現在の結論' });
      expect(request.systemPrompt).toContain(hint);
      expect(request.systemPrompt).toContain('事実や推測は追加しない');
    }
  });
  it.each([{ text: '' }, { text: '原文', adjustment: 'unknown' }, { text: '原文', adjustment: 'longer' }])('不正な入力では送信しない: %j', async message => {
    const respond = vi.fn();
    await handleSelectionSummary(message, {}, respond);
    expect(respond).toHaveBeenCalledWith({ error: expect.any(Object) });
    expect(translateText).not.toHaveBeenCalled();
  });
  it('接続設定を保ち、保存した翻訳指示を変更しない', async () => {
    const settings = { apiProvider: 'openrouter', translationSystemPrompt: '英訳する', openrouterModel: 'test' };
    loadSettings.mockResolvedValue(settings);
    translateText.mockResolvedValue(' 要約結果 ');
    const respond = vi.fn();
    await handleSelectionSummary({ text: '原文' }, {}, respond);
    expect(translateText.mock.calls[0][1]).toMatchObject({ apiProvider: 'openrouter', openrouterModel: 'test' });
    expect(translateText.mock.calls[0][1].translationSystemPrompt).toContain('日本語で要約');
    expect(settings.translationSystemPrompt).toBe('英訳する');
    expect(respond).toHaveBeenCalledWith({ summary: '要約結果' });
  });
  it.each(['', new Error('接続できません')])('空結果・接続エラーを返す: %s', async value => {
    loadSettings.mockResolvedValue({});
    if (value instanceof Error) translateText.mockRejectedValue(value);
    else translateText.mockResolvedValue(value);
    const respond = vi.fn();
    await handleSelectionSummary({ text: '原文' }, {}, respond);
    expect(respond).toHaveBeenCalledWith({ error: expect.objectContaining({ message: expect.any(String) }) });
  });
});
