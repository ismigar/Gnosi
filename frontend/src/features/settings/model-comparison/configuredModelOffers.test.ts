import { describe, expect, it } from 'vitest';
import type { AiModelComparisonEntry } from '../../../shared/api/ai';
import { configuredModelOffers } from './configuredModelOffers';

type Provider = Parameters<typeof configuredModelOffers>[1][number];
const provider = (id: string, extra: Partial<Provider> = {}): Provider => ({ id, enabled: true, connected: true,
    has_api_key: true, is_local: false, live: false, configured: true, validated_models: [], ...extra });
const route = (id: string) => ({ provider: id, model_id: `${id}/model`, model_name: 'Model', provider_name: id, is_local: false,
    cost_in: 1, cost_out: 2, context_window: 128000, quality: 4, tags: [] });
const model: AiModelComparisonEntry = { id: 'model', slug: 'model', name: 'Model', creator: 'Maker',
    intelligence: 80, coding: 70, agentic: 60, context_window: 128000, input_price: 1, output_price: 2,
    latency: 1, speed: 100, release_date: '', modes: ['text'], tags: [], profile: 'expert',
    routes: [route('pareto'), route('openrouter')] };
const registry = [{ provider: 'openrouter', model_id: 'openrouter/model', enabled: true }];

describe('configured provider offers', () => {
    it('excludes unfinished credentials and keeps the activated provider and its own tariff', () => {
        const result = configuredModelOffers([model], [provider('pareto'), provider('openrouter')], registry, 'configured');
        expect(result[0]?.routes).toEqual([model.routes[1]]);
        expect(model.routes).toHaveLength(2);
    });
    it('includes a verified provider before activating its first model', () => {
        expect(configuredModelOffers([model], [provider('pareto', { validated_models: ['pareto/model'] })], [], 'configured')[0]?.routes)
            .toEqual([model.routes[0]]);
    });
    it.each([{ enabled: false }, { has_api_key: false }, { connected: false }])('excludes inactive or unavailable providers %j', changes => {
        expect(configuredModelOffers([model], [provider('openrouter', changes)], registry, 'configured')[0]?.routes).toEqual([]);
    });
    it('does not treat a disabled registry row as a completed setup', () => {
        expect(configuredModelOffers([model], [provider('openrouter')], [{ ...registry[0], provider: 'openrouter', model_id: 'openrouter/model', enabled: false }], 'configured')[0]?.routes).toEqual([]);
    });
    it('allows explicit new-provider selection and all-provider browsing', () => {
        expect(configuredModelOffers([model], [], [], 'pareto')[0]?.routes).toEqual([model.routes[0]]);
        expect(configuredModelOffers([model], [], [], 'all')).toEqual([model]);
    });
    it('includes an installed local provider without a key, but excludes an uninstalled one', () => {
        const local = { ...model, routes: [{ ...route('ollama'), is_local: true }] };
        const installed = provider('ollama', { has_api_key: false, is_local: true, live: true });
        expect(configuredModelOffers([local], [installed], [], 'configured')[0]?.routes).toEqual(local.routes);
        expect(configuredModelOffers([local], [{ ...installed, live: false }], [], 'configured')[0]?.routes).toEqual([]);
    });
});
