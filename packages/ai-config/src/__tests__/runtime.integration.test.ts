import { describe, it, expect } from 'vitest';
import { resolveEffectiveModel } from '../runtime/resolveEffectiveModel.js';
import type { ProviderDiscoveryPlugin } from '../discovery/pluginInterface.js';

describe('runtime integration', () => {
  it('resolves secrets with env precedence and plugin discovery', async () => {
    const raw = {
      mode: 'merge',
      providers: [
        {
          id: 'openai',
          name: 'OpenAI',
          type: 'api',
          auth: { mode: 'api_key', value: 'config-key' },
        },
      ],
      models: [
        {
          id: 'gpt-4o-mini',
          name: 'GPT',
          providerId: 'openai',
          compat: { context: ['chat'], reasoning: ['fast'], tools: ['function'], transport: ['http'] },
        },
      ],
      defaults: {
        provider: 'openai',
        model: 'gpt-4o-mini',
      },
    };

    const plugin: ProviderDiscoveryPlugin = {
      id: 'dynamic-anthropic',
      order: 20,
      discover: async () => ({
        providers: [
          {
            id: 'anthropic',
            name: 'Anthropic',
            type: 'api',
            auth: { mode: 'api_key' as const, value: 'plugin-key' },
          },
        ],
        models: [
          {
            id: 'claude-3-5-sonnet',
            name: 'Claude',
            providerId: 'anthropic',
            compat: { context: ['chat'], reasoning: ['deep'], tools: ['function'], transport: ['http'] },
          },
        ],
      }),
    };

    const { catalog, selection } = await resolveEffectiveModel(raw, {
      env: { OPENAI_API_KEY: 'env-key' },
      plugins: [plugin],
      requested: 'openai/gpt-4o-mini',
    });

    const openai = catalog.providers.find((p: { id: string }) => p.id === 'openai');
    expect(openai?.auth.from).toBe('env');
    expect(selection.model).toBe('gpt-4o-mini');
    expect(catalog.providers.map((p: { id: string }) => p.id)).toEqual(['anthropic', 'openai']);
  });
});
