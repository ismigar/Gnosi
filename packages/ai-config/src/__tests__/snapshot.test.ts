import { describe, it, expect } from 'vitest';
import { normalizeCatalog } from '../catalog/normalize.js';
import { buildCatalogSnapshot } from '../catalog/snapshot.js';
import type { Catalog } from '../domain/catalog.js';

function buildInputA(): Catalog {
  return {
    mode: 'merge',
    providers: [
      { id: 'openai', name: 'OpenAI', type: 'api', auth: { mode: 'api_key', value: 'x' } },
      { id: 'anthropic', name: 'Anthropic', type: 'api', auth: { mode: 'api_key', value: 'y' } },
    ],
    models: [
      {
        id: 'gpt-4o-mini',
        name: 'GPT',
        providerId: 'openai',
        compat: { context: ['chat'], reasoning: ['fast'], tools: ['function'], transport: ['http'] },
      },
      {
        id: 'claude-3-5-sonnet',
        name: 'Claude',
        providerId: 'anthropic',
        compat: { context: ['chat'], reasoning: ['deep'], tools: ['function'], transport: ['http'] },
      },
    ],
    defaults: { provider: 'openai', model: 'gpt-4o-mini', byContext: {} },
  };
}

function buildInputB(): Catalog {
  return {
    mode: 'merge',
    providers: [
      { id: 'anthropic', name: 'Anthropic', type: 'api', auth: { mode: 'api_key', value: 'y' } },
      { id: 'openai', name: 'OpenAI', type: 'api', auth: { mode: 'api_key', value: 'x' } },
    ],
    models: [
      {
        id: 'claude-3-5-sonnet',
        name: 'Claude',
        providerId: 'anthropic',
        compat: { context: ['chat'], reasoning: ['deep'], tools: ['function'], transport: ['http'] },
      },
      {
        id: 'gpt-4o-mini',
        name: 'GPT',
        providerId: 'openai',
        compat: { context: ['chat'], reasoning: ['fast'], tools: ['function'], transport: ['http'] },
      },
    ],
    defaults: { provider: 'openai', model: 'gpt-4o-mini', byContext: {} },
  };
}

describe('catalog snapshot determinism', () => {
  it('produces the same snapshot for equivalent catalogs with different order', () => {
    const snapshotA = buildCatalogSnapshot(normalizeCatalog(buildInputA()));
    const snapshotB = buildCatalogSnapshot(normalizeCatalog(buildInputB()));

    expect(snapshotA).toBe(snapshotB);
  });
});
