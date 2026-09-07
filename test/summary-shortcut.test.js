import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const runtimeScript = readFileSync(new URL('../src/content/runtime.js', import.meta.url), 'utf8');
const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));

describe('要約ショートカット', () => {
  it('キー未割り当てのコマンドを公開する', () => {
    expect(manifest.commands['summarize-selection']).toEqual({ description: '選択したテキストを要約' });
  });
  it.each([
    [true, ' 選択した原文 ', '選択した原文'],
    [true, '  ', ''],
    [false, '別フレームに残った選択', '']
  ])('フォーカス=%s、選択=%s', (focused, selected, expected) => {
    const showSelectionSummary = vi.fn();
    const context = {
      window: { LLMT: { selection: { showSelectionSummary } }, getSelection: () => ({ toString: () => selected }) },
      document: { hasFocus: () => focused },
      chrome: { runtime: { onMessage: { addListener: vi.fn() } } }
    };
    runInNewContext(runtimeScript, context);
    const respond = vi.fn();
    context.window.LLMT.runtime.runtimeMessageHandlers.summarizeFocusedSelection({}, {}, respond);
    expect(respond).toHaveBeenCalledWith({ started: !!expected });
    if (expected) expect(showSelectionSummary).toHaveBeenCalledWith(expected);
    else expect(showSelectionSummary).not.toHaveBeenCalled();
  });
});
