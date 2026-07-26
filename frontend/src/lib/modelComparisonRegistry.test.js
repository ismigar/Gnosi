import { describe, expect, it } from 'vitest';
import {
    catalogModelToRegistryEntry,
    matchingRegistryIndexes,
    registryEntryMatchesModel,
    suggestedCatalogModel,
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

    it('builds a router row exclusively from catalog-owned metadata', () => {
        expect(catalogModelToRegistryEntry(
            { id: 'ollama', is_local: true },
            {
                id: 'qwen3:8b',
                cost_in: 0,
                cost_out: 0,
                context_window: 32768,
                quality: 2,
                tags: ['code'],
            },
        )).toEqual({
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

    it('prefers the exact route offered by the selected provider', () => {
        const provider = {
            id: 'openai',
            models: [
                { id: 'gpt-5.6-terra', name: 'GPT-5.6 Terra' },
                { id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol' },
            ],
        };
        expect(suggestedCatalogModel(provider, comparisonModel)?.id).toBe('gpt-5.6-sol');
    });
});
