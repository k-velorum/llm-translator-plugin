import { describe, expect, it } from 'vitest';

import {
  PROVIDERS,
  getProviderCapabilities,
  getProviderDefinition
} from '../src/background/api/registry.js';

describe('provider registry', () => {
  it('contains the current provider ids', () => {
    expect(Object.keys(PROVIDERS)).toEqual([
      'openrouter',
      'gemini',
      'cerebras',
      'zai',
      'ollama',
      'lmstudio',
      'chromePrompt'
    ]);
  });

  it('preserves the current capability matrix', () => {
    expect(getProviderCapabilities({ apiProvider: 'cerebras' })).toEqual({
      supportsStreaming: true,
      streamProtocol: 'openai-chat-sse',
      supportsImageTranslation: false
    });
    expect(getProviderCapabilities({ apiProvider: 'lmstudio' })).toEqual({
      supportsStreaming: true,
      streamProtocol: 'openai-chat-sse',
      supportsImageTranslation: true
    });
    expect(getProviderCapabilities({ apiProvider: 'openrouter' })).toEqual({
      supportsStreaming: false,
      streamProtocol: null,
      supportsImageTranslation: false
    });
    expect(getProviderCapabilities({ apiProvider: 'unknown' })).toEqual({
      supportsStreaming: false,
      streamProtocol: null,
      supportsImageTranslation: false
    });
  });

  it('keeps existing settings key names in provider definitions', () => {
    expect(getProviderDefinition('openrouter').settingsKeys).toEqual({
      apiKey: 'openrouterApiKey',
      model: 'openrouterModel'
    });
    expect(getProviderDefinition('lmstudio').settingsKeys).toEqual({
      apiKey: 'lmstudioApiKey',
      server: 'lmstudioServer',
      model: 'lmstudioModel'
    });
  });
});
