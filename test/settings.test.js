import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_SETTINGS,
  DEFAULT_PAGE_TRANSLATION_SEPARATOR_PROMPT,
  DEFAULT_TRANSLATION_SYSTEM_PROMPT,
  LEGACY_COMBINED_TRANSLATION_SYSTEM_PROMPT,
  loadSettings
} from '../src/background/settings.js';

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
  it('keeps the default settings keys stable', () => {
    expect(DEFAULT_SETTINGS).toMatchObject({
      apiProvider: 'openrouter',
      openrouterModel: 'openai/gpt-4o-mini',
      geminiModel: 'gemini-flash-2.0',
      cerebrasModel: 'llama3.1-8b',
      zaiModel: 'glm-4.7',
      ollamaServer: 'http://localhost:11434',
      lmstudioServer: 'http://localhost:1234',
      chromePromptTemperature: 0.2,
      enableTwitterTranslation: true,
      enableYoutubeTranslation: true,
      pageTranslationUseStructuredOutput: true
    });
  });

  it('migrates the legacy combined prompt into separate prompt settings', async () => {
    const { set } = installChromeStorageMock({
      translationSystemPrompt: LEGACY_COMBINED_TRANSLATION_SYSTEM_PROMPT,
      pageTranslationSeparatorPrompt: ''
    });

    await expect(loadSettings()).resolves.toMatchObject({
      translationSystemPrompt: DEFAULT_TRANSLATION_SYSTEM_PROMPT,
      pageTranslationSeparatorPrompt: DEFAULT_PAGE_TRANSLATION_SEPARATOR_PROMPT
    });

    expect(set).toHaveBeenCalledWith({
      translationSystemPrompt: DEFAULT_TRANSLATION_SYSTEM_PROMPT,
      pageTranslationSeparatorPrompt: DEFAULT_PAGE_TRANSLATION_SEPARATOR_PROMPT
    });
  });

  it('returns current settings without migration when prompt is already split', async () => {
    const current = {
      translationSystemPrompt: DEFAULT_TRANSLATION_SYSTEM_PROMPT,
      pageTranslationSeparatorPrompt: DEFAULT_PAGE_TRANSLATION_SEPARATOR_PROMPT
    };
    const { set } = installChromeStorageMock(current);

    await expect(loadSettings()).resolves.toBe(current);
    expect(set).not.toHaveBeenCalled();
  });
});
