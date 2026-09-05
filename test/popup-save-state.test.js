import { describe, expect, it, vi, afterEach } from 'vitest';
import { createSaveState } from '../src/popup/save-state.js';
import { collectSettings, saveSettings } from '../src/popup/settings-form.js';

function element(value = '') {
  const classes = new Set();
  return { value, dataset: {}, textContent: '', disabled: false, addEventListener() {},
    classList: { add: (name) => classes.add(name), remove: (name) => classes.delete(name), contains: (name) => classes.has(name) } };
}
function setup(persist) {
  const elements = { saveButton: element(), saveState: element(), statusMessage: element() };
  return { ...elements, controller: createSaveState(elements, persist) };
}
afterEach(() => vi.unstubAllGlobals());

describe('保存状態', () => {
  it('編集後に保存でき、保存完了まで保存済みにしない', async () => {
    let complete;
    const ui = setup(() => new Promise((resolve) => { complete = resolve; }));
    expect(ui.saveButton.disabled).toBe(true);
    ui.controller.markDirty();
    expect(ui.saveButton.disabled).toBe(false);
    const running = ui.controller.save();
    expect(ui.saveState.textContent).toContain('保存しています');
    complete();
    await running;
    expect(ui.saveState.textContent).toBe('すべて保存済み');
  });

  it('保存中の追加編集は未保存として残し、二重保存を防ぐ', async () => {
    let complete;
    const persist = vi.fn(() => new Promise((resolve) => { complete = resolve; }));
    const ui = setup(persist);
    ui.controller.markDirty();
    const running = ui.controller.save();
    ui.controller.markDirty();
    await ui.controller.save();
    complete();
    await running;
    expect(persist).toHaveBeenCalledTimes(1);
    expect(ui.saveState.textContent).toContain('未保存');
    expect(ui.saveButton.disabled).toBe(false);
  });

  it('保存失敗時は未保存を維持し、再試行できる', async () => {
    const ui = setup(vi.fn().mockRejectedValueOnce(new Error('storage quota exceeded')).mockResolvedValue(undefined));
    ui.controller.markDirty();
    await ui.controller.save();
    expect(ui.statusMessage.textContent).toBe('storage quota exceeded');
    expect(ui.saveButton.disabled).toBe(false);
    await ui.controller.save();
    expect(ui.saveState.textContent).toBe('すべて保存済み');
    expect(ui.statusMessage.classList.contains('hidden')).toBe(true);
  });
});

describe('設定の一括保存', () => {
  it('モデル取得前でも保存済みのモデルを空欄で上書きしない', () => {
    const settings = collectSettings({ apiProviderSelect: element('cerebras'), cerebrasModelSelect: element(),
      cerebrasApiKeyInput: element(' draft-key '), twitterFeatureCheckbox: { checked: false },
      youtubeFeatureCheckbox: { checked: true }, translationSystemPromptTextarea: element('短く翻訳')
    }, { cerebrasModel: 'saved-model' });
    expect(settings).toMatchObject({ apiProvider: 'cerebras', cerebrasModel: 'saved-model',
      cerebrasApiKey: 'draft-key', enableTwitterTranslation: false, enableYoutubeTranslation: true,
      translationSystemPrompt: '短く翻訳' });
  });

  it('接続先と翻訳設定を一回の書き込みで保存する', async () => {
    const set = vi.fn((_settings, cb) => cb());
    vi.stubGlobal('chrome', { runtime: {}, storage: { sync: { set } } });
    const settings = { apiProvider: 'cerebras', cerebrasApiKey: 'test-key', enableTwitterTranslation: false };
    await saveSettings(settings);
    expect(set).toHaveBeenCalledExactlyOnceWith(settings, expect.any(Function));
  });

  it('storageの失敗を呼び出し元へ返す', async () => {
    vi.stubGlobal('chrome', { runtime: { lastError: { message: '保存失敗' } },
      storage: { sync: { set: (_settings, cb) => cb() } } });
    await expect(saveSettings({ apiProvider: 'ollama' })).rejects.toThrow('保存失敗');
  });

  it('未設定の接続を変更した場合だけAPIキー入力を求める', async () => {
    const set = vi.fn((_settings, cb) => cb());
    vi.stubGlobal('chrome', { runtime: {}, storage: { sync: { set } } });
    await expect(saveSettings({ apiProvider: 'cerebras' })).rejects.toThrow('APIキー');
    expect(set).not.toHaveBeenCalled();
    await expect(saveSettings({ apiProvider: 'cerebras' }, { validateConnection: false })).resolves.toBeUndefined();
  });
});
