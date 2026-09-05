import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_TRANSLATION_SYSTEM_PROMPT, LEGACY_SEPARATOR_INSTRUCTION,
  normalizeTranslationPolicy, buildSeparatorInstruction } from '../src/shared/translation-policy.js';
import { getSystemPrompt } from '../src/background/api/prompt.js';
import { buildStructuredBatchInstruction } from '../src/shared/structured-batch.js';
import { collectSettings, loadSettings as loadForm } from '../src/popup/settings-form.js';
import { loadSettings } from '../src/background/settings.js';

afterEach(() => vi.unstubAllGlobals());

describe('翻訳方針と旧SEP指示の分離', () => {
  it('既知の定型文だけを取り除き、前後の独自指示を保つ', () => {
    const value = `敬体で訳してください。${LEGACY_SEPARATOR_INSTRUCTION}専門用語は原語を併記してください。`;
    expect(normalizeTranslationPolicy(value)).toBe('敬体で訳してください。専門用語は原語を併記してください。');
    const custom = 'SEPは製品名です。[[[SEP]]] は訳さないでください。';
    expect(normalizeTranslationPolicy(custom)).toBe(custom);
  });

  it.each(['', undefined, LEGACY_SEPARATOR_INSTRUCTION])('方針が空なら既定に戻す: %s', value => {
    expect(normalizeTranslationPolicy(value)).toBe(DEFAULT_TRANSLATION_SYSTEM_PROMPT);
  });

  it('通常・JSONのどちらにも旧SEP指示を送らない', () => {
    const settings = { translationSystemPrompt: '敬体で訳してください。' + LEGACY_SEPARATOR_INSTRUCTION };
    expect(getSystemPrompt(settings)).toBe('敬体で訳してください。');
    const instruction = buildStructuredBatchInstruction(settings);
    expect(instruction).toContain('JSON');
    expect(instruction).toContain('敬体で訳してください。');
    expect(instruction).not.toContain('SEP');
  });

  it('実際の区切り文字から形式の指示を生成する', () => {
    expect(buildSeparatorInstruction('|||')).toContain('"|||"');
    expect(buildSeparatorInstruction('|||')).not.toContain('SEP');
  });

  it('編集された旧プロンプトも読み込み時に移行し、以降は再保存しない', async () => {
    let stored = { translationSystemPrompt: '敬体。' + LEGACY_SEPARATOR_INSTRUCTION };
    const set = vi.fn(values => { stored = { ...stored, ...values }; });
    vi.stubGlobal('chrome', { storage: { sync: { get: (_keys, cb) => cb(stored), set } } });
    expect((await loadSettings()).translationSystemPrompt).toBe('敬体。');
    await loadSettings();
    expect(set).toHaveBeenCalledExactlyOnceWith({ translationSystemPrompt: '敬体。' });
  });

  it('設定画面でも独自方針を残し、廃止した専用指示を保存しない', async () => {
    const elements = { apiProviderSelect: {}, translationSystemPromptTextarea: {} };
    vi.stubGlobal('chrome', { runtime: {}, storage: { sync: { get: (_keys, cb) => cb({
      translationSystemPrompt: '敬体。' + LEGACY_SEPARATOR_INSTRUCTION,
      pageTranslationSeparatorPrompt: 'old custom format'
    }) } } });
    await loadForm(elements);
    expect(elements.translationSystemPromptTextarea.value).toBe('敬体。');
    elements.translationSystemPromptTextarea.value += LEGACY_SEPARATOR_INSTRUCTION;
    const collected = collectSettings(elements);
    expect(collected.translationSystemPrompt).toBe('敬体。');
    expect(collected).not.toHaveProperty('pageTranslationSeparatorPrompt');
  });
});
