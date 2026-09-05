import { describe, expect, it, vi } from 'vitest';

import {
  buildStructuredBatchInstruction,
  normalizeStructuredBatchResult,
  parseJsonLoose
} from '../src/shared/structured-batch.js';
import { DEFAULT_SETTINGS } from '../src/background/settings.js';

describe('parseJsonLoose', () => {
  it('parses plain JSON', () => {
    expect(parseJsonLoose('{"items":[{"id":0,"translation":"こんにちは"}]}')).toEqual({
      items: [{ id: 0, translation: 'こんにちは' }]
    });
  });

  it('parses JSON inside a code fence', () => {
    expect(parseJsonLoose('```json\n{"items":[]}\n```')).toEqual({ items: [] });
  });

  it('parses JSON surrounded by extra text', () => {
    expect(parseJsonLoose('結果です:\n{"items":[{"id":1,"translation":"世界"}]}\n以上')).toEqual({
      items: [{ id: 1, translation: '世界' }]
    });
  });

  it('returns null for broken JSON', () => {
    expect(parseJsonLoose('{"items": [')).toBeNull();
  });
});

describe('normalizeStructuredBatchResult', () => {
  it('returns translations ordered by id', () => {
    expect(
      normalizeStructuredBatchResult(
        {
          items: [
            { id: 1, translation: '二番目' },
            { id: 0, translation: '一番目' }
          ]
        },
        ['first', 'second']
      )
    ).toEqual(['一番目', '二番目']);
  });

  it('marks missing ids as untranslated', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(
      normalizeStructuredBatchResult(
        {
          items: [
            { id: 0, translation: '一番目' },
            { id: 2, translation: '三番目' }
          ]
        },
        ['first', 'second', 'third']
      )
    ).toEqual(['一番目', null, '三番目']);

    warn.mockRestore();
  });

  it('ignores extra ids outside the input range', () => {
    expect(
      normalizeStructuredBatchResult(
        {
          items: [
            { id: 0, translation: '一番目' },
            { id: 1, translation: '二番目' },
            { id: 99, translation: '余剰' }
          ]
        },
        ['first', 'second']
      )
    ).toEqual(['一番目', '二番目']);
  });

  it('throws when too many ids are missing', () => {
    expect(() =>
      normalizeStructuredBatchResult(
        {
          items: [{ id: 0, translation: '一番目' }]
        },
        ['first', 'second', 'third']
      )
    ).toThrow('構造化出力の id 欠落率が高すぎます');
  });
});

describe('buildStructuredBatchInstruction', () => {
  it('uses the built-in policy when the prompt is default', () => {
    expect(buildStructuredBatchInstruction(DEFAULT_SETTINGS)).toContain(
      '翻訳方針: 指示された文章を日本語に翻訳してください。翻訳結果のみを返してください。'
    );
  });

  it('uses a custom non-default prompt as the policy', () => {
    expect(
      buildStructuredBatchInstruction({
        ...DEFAULT_SETTINGS,
        translationSystemPrompt: '敬体で自然な日本語にしてください。'
      })
    ).toContain('翻訳方針: 敬体で自然な日本語にしてください。');
  });
});
