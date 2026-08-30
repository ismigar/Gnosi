import { describe, expect, it } from 'vitest';

import {
  comparisonRoutesForMode,
  comparisonRouteToRegistryEntry,
  matchingRegistryIndexes,
  registryEntryMatchesModel,
} from './modelComparisonRegistry';


const comparisonModel = {
  slug: 'gpt-5-6-sol',
  name: 'GPT-5.6 Sol',
  routes: [{ provider: 'openai', model_id: 'gpt-5.6-sol' }],
};


describe('model comparison registry helpers', () => {
  it('matches exact provider routes and normalized custom ids', () => {
    expect(registryEntryMatchesModel(
      { provider: 'openai', model_id: 'gpt-5.6-sol' },
      comparisonModel,
    )).toBe(true);
    expect(registryEntryMatchesModel(
      { provider: 'custom', model_id: 'GPT 5.6 Sol' },
      comparisonModel,
    )).toBe(true);
    expect(registryEntryMatchesModel(
      { provider: 'openai', model_id: 'gpt-5.6-terra' },
      comparisonModel,
    )).toBe(false);
  });

  it('returns every registry row that must be disabled together', () => {
    const indexes = matchingRegistryIndexes([
      { provider: 'openai', model_id: 'gpt-5.6-sol' },
      { provider: 'openrouter', model_id: 'openai/gpt-5.6-sol' },
      { provider: 'anthropic', model_id: 'claude-sonnet-5' },
    ], comparisonModel);
    expect(indexes).toEqual([0]);
  });

  it('does not fuzzy-match provider-qualified ids without an exact route', () => {
    expect(registryEntryMatchesModel(
      { provider: 'openrouter', model_id: 'openai/gpt-5.6-sol' },
      comparisonModel,
    )).toBe(false);
  });

  it('builds a router row directly from an exact comparison route', () => {
    expect(comparisonRouteToRegistryEntry({
      provider: 'ollama',
      model_id: 'qwen3:8b',
      is_local: true,
      cost_in: 0,
      cost_out: 0,
      context_window: 32768,
      quality: 2,
      tags: ['code'],
    })).toEqual({
      provider: 'ollama',
      model_id: 'qwen3:8b',
      is_local: true,
      enabled: true,
      priority: 100,
      cost_in: 0,
      cost_out: 0,
      context_window: 32768,
      quality: 2,
      tags: ['code'],
    });
  });

  it('returns one exact route per provider and prefers connected providers', () => {
    const routes = comparisonRoutesForMode({
      routes: [
        { provider: 'gateway', model_id: 'vendor/model-v1', is_local: false },
        { provider: 'gateway', model_id: 'vendor/model-v2', is_local: false },
        { provider: 'direct', model_id: 'model', is_local: false },
      ],
    }, [
      { id: 'gateway', name: 'Gateway', connected: false },
      { id: 'direct', name: 'Direct', connected: true },
    ], 'remote');

    expect(routes.map((route) => [route.provider, route.model_id])).toEqual([
      ['direct', 'model'],
      ['gateway', 'vendor/model-v1'],
    ]);
  });

  it('exposes only installed or configured local routes', () => {
    const routes = comparisonRoutesForMode({
      routes: [
        { provider: 'ollama', model_id: 'installed', is_local: true },
        { provider: 'lmstudio', model_id: 'not-installed', is_local: true },
        { provider: 'remote', model_id: 'hosted', is_local: false },
      ],
    }, [
      { id: 'ollama', name: 'Ollama', live: true },
      { id: 'lmstudio', name: 'LM Studio', live: false, configured: false },
      { id: 'remote', name: 'Remote' },
    ], 'local');

    expect(routes.map((route) => route.model_id)).toEqual(['installed']);
  });
});
