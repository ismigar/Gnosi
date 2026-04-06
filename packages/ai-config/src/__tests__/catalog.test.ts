import { describe, it, expect } from 'vitest';
import { mergeCatalogs } from '../catalog/merge.js';
import { normalizeCatalog } from '../catalog/normalize.js';
import type { Catalog } from '../domain/catalog.js';

const explicit: Catalog = {
  mode: 'replace' as const,
  providers: [
    { id: 'OpenAI', name: 'OpenAI', type: 'api', auth: { mode: 'api_key' as const, value: 'a' } },
  ],
  models: [
    {
      id: 'GPT-4O-MINI',
      name: 'GPT',
      providerId: 'OpenAI',
      compat: { context: [], reasoning: [], tools: [], transport: [] },
    },
  ],
};

const implicit: Partial<Catalog> = {
  providers: [
    { id: 'Anthropic', name: 'Anthropic', type: 'api', auth: { mode: 'api_key' as const, value: 'b' } },
  ],
  models: [
    {
      id: 'Claude-3-5-sonnet',
      name: 'Claude',
      providerId: 'Anthropic',
      compat: { context: [], reasoning: [], tools: [], transport: [] },
    },
  ],
};

describe('catalog merge and normalize', () => {
  it('replaces in replace mode', () => {
    const merged = mergeCatalogs(explicit, implicit);
    expect(merged.providers).toHaveLength(1);
    expect(merged.providers[0].id).toBe('Anthropic');
  });

  it('preserves explicit secret values in merge mode when implicit provider has no value', () => {
    const merged = mergeCatalogs(
      {
        ...explicit,
        mode: 'merge',
        providers: [
          {
            id: 'openai',
            name: 'OpenAI',
            type: 'api',
            auth: { mode: 'api_key', value: 'resolved-env-secret' },
          },
        ],
      },
      {
        providers: [
          {
            id: 'openai',
            name: 'OpenAI from plugin',
            type: 'api',
            auth: { mode: 'api_key' },
          },
        ],
      },
    );

    expect(merged.providers).toHaveLength(1);
    expect(merged.providers[0].auth.value).toBe('resolved-env-secret');
    expect(merged.providers[0].name).toBe('OpenAI from plugin');
  });

  it('normalizes ids deterministically', () => {
    const normalized = normalizeCatalog({
      ...explicit,
      mode: 'merge',
      providers: [...explicit.providers, ...(implicit.providers ?? [])],
      models: [...explicit.models, ...(implicit.models ?? [])],
    });
    expect(normalized.providers.map((p: { id: string }) => p.id)).toEqual(['anthropic', 'openai']);
    expect(normalized.models.map((m: { providerId?: string; id: string }) => `${m.providerId}/${m.id}`)).toEqual([
      'anthropic/claude-3-5-sonnet',
      'openai/gpt-4o-mini',
    ]);
  });
});
