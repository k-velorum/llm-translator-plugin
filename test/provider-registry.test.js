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

  it('keeps provider definitions structurally complete', () => {
    for (const [providerId, provider] of Object.entries(PROVIDERS)) {
      expect(provider.id).toBe(providerId);
      expect(provider.label).toEqual(expect.any(String));
      expect(provider.settingsKeys).toEqual(expect.any(Object));
      expect(provider.capabilities).toMatchObject({
        supportsStreaming: expect.any(Boolean),
        supportsImageTranslation: expect.any(Boolean)
      });
      expect(provider.capabilities).toHaveProperty('streamProtocol');
      expect(provider.translate).toEqual(expect.any(Function));
      expect(provider.translateBatchStructured).toEqual(expect.any(Function));
    }
  });

  it('requires streaming providers to expose translateStream', () => {
    for (const provider of Object.values(PROVIDERS)) {
      if (provider.capabilities.supportsStreaming) {
        expect(provider.capabilities.streamProtocol).toBe('openai-chat-sse');
        expect(provider.translateStream).toEqual(expect.any(Function));
      } else {
        expect(provider.capabilities.streamProtocol).toBeNull();
      }
    }
  });
});
