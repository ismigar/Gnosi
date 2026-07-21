import { describe, it, expect } from 'vitest';
import { selectModel } from '../selection/selector.js';
import { normalizeCatalog } from '../catalog/normalize.js';
import type { Catalog } from '../domain/catalog.js';

const catalog: Catalog = {
  providers: [
    {
      id: 'openai',
      name: 'OpenAI',
      type: 'api',
      auth: { mode: 'api_key', value: 'x' },
    },
    {
      id: 'anthropic',
      name: 'Anthropic',
      type: 'api',
      auth: { mode: 'api_key', value: 'y' },
    },
  ],
  models: [
    {
      id: 'gpt-4o-mini',
      name: 'GPT-4o mini',
      providerId: 'openai',
      compat: { context: [], reasoning: [], tools: [], transport: [] },
    },
    {
      id: 'claude-3-5-sonnet',
      name: 'Claude',
      providerId: 'anthropic',
      compat: { context: [], reasoning: [], tools: [], transport: [] },
    },
  ],
  defaults: {
    provider: 'openai',
    model: 'gpt-4o-mini',
    byContext: {
      analyst: { provider: 'anthropic', model: 'claude-3-5-sonnet', fallback: 'openai/gpt-4o-mini' },
    },
  },
};

describe('model selection', () => {
  it('selects context default first', () => {
    const result = selectModel(catalog, { contextId: 'analyst' });
    expect(result.provider).toBe('anthropic');
    expect(result.model).toBe('claude-3-5-sonnet');
    expect(result.fallbackUsed).toBe(false);
  });

  it('applies allowlist and falls back', () => {
    const result = selectModel(catalog, {
      contextId: 'analyst',
      allowlist: ['openai/gpt-4o-mini'],
      fallback: 'openai/gpt-4o-mini',
    });

    expect(result.provider).toBe('openai');
    expect(result.model).toBe('gpt-4o-mini');
    expect(result.fallbackUsed).toBe(true);
  });

  it('resolves model with implicit provider using catalog default provider', () => {
    const implicitProviderCatalog = normalizeCatalog({
      providers: [
        {
          id: 'openai',
          name: 'OpenAI',
          type: 'api',
          auth: { mode: 'api_key', value: 'x' },
        },
      ],
      models: [
        {
          id: 'gpt-4o-mini',
          name: 'GPT-4o mini',
          compat: { context: [], reasoning: [], tools: [], transport: [] },
        },
      ],
      defaults: {
        provider: 'openai',
        model: 'gpt-4o-mini',
        byContext: {},
      },
    });

    const result = selectModel(implicitProviderCatalog, { requested: 'gpt-4o-mini' });
    expect(result.provider).toBe('openai');
    expect(result.model).toBe('gpt-4o-mini');
  });

  it('uses safe fallback when requested primary is not allowlisted', () => {
    const result = selectModel(catalog, {
      requested: 'anthropic/claude-3-5-sonnet',
      fallback: 'openai/gpt-4o-mini',
      allowlist: ['openai/gpt-4o-mini'],
    });

    expect(result.provider).toBe('openai');
    expect(result.model).toBe('gpt-4o-mini');
    expect(result.fallbackUsed).toBe(true);
  });
});
