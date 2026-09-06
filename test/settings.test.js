import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_SETTINGS,
  DEFAULT_TRANSLATION_SYSTEM_PROMPT,
  loadSettings
} from '../src/background/settings.js';
import { LEGACY_SEPARATOR_INSTRUCTION } from '../src/shared/translation-policy.js';

afterEach(() => {
  vi.restoreAllMocks();
  delete globalThis.chrome;
});

function installChromeStorageMock(settings) {
  const set = vi.fn();

  globalThis.chrome = {
    storage: {
      sync: {
        get: vi.fn((_defaults, callback) => callback(settings)),
        set
      }
    }
  };

  return { set };
}

describe('loadSettings', () => {
  it('uses one compatible connection type by default', () => {
    expect(DEFAULT_SETTINGS).toMatchObject({
      apiProvider: 'openai',
      openaiPreset: 'openrouter',
      geminiModel: 'gemini-flash-2.0',
      chromePromptTemperature: 0.2,
      enableTwitterTranslation: true,
      enableYoutubeTranslation: true,
      pageTranslationUseStructuredOutput: true
    });
  });

  it('removes the legacy instruction from the saved policy', async () => {
    const { set } = installChromeStorageMock({
      translationSystemPrompt: DEFAULT_TRANSLATION_SYSTEM_PROMPT + LEGACY_SEPARATOR_INSTRUCTION,
      pageTranslationSeparatorPrompt: ''
    });

    await expect(loadSettings()).resolves.toMatchObject({
      translationSystemPrompt: DEFAULT_TRANSLATION_SYSTEM_PROMPT
    });

    expect(set).toHaveBeenCalledWith({
      translationSystemPrompt: DEFAULT_TRANSLATION_SYSTEM_PROMPT
    });
  });

  it('normalizes connection settings without writing during reads', async () => {
    const current = {
      translationSystemPrompt: DEFAULT_TRANSLATION_SYSTEM_PROMPT
    };
    const { set } = installChromeStorageMock(current);

    await expect(loadSettings()).resolves.toMatchObject({ ...current, apiProvider: 'openai', openaiPreset: 'openrouter' });
    expect(set).not.toHaveBeenCalled();
  });
  it('保存済みの任意接続を読み込み、既定の接続先へ戻さない', async () => {
    const stored = { apiProvider: 'openai', openaiPreset: 'custom', openaiConnections: {
      custom: { baseUrl: 'https://example.test/gateway/v3', apiKey: 'saved-key', model: 'manual/model', reasoning: 'low', streaming: false }
    } };
    installChromeStorageMock(stored);
    const loaded = await loadSettings();
    expect(globalThis.chrome.storage.sync.get.mock.calls[0][0]).toBeNull();
    expect(loaded).toMatchObject(stored);
  });

});
