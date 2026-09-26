import { describe, expect, it } from 'vitest';
import type { AiModelComparisonEntry } from '../../../shared/api/ai';
import { comparisonRouteCapabilities, routeContextValue } from './modelRouteCapabilities';
import { filteredComparisonModels, INITIAL_COMPARISON_UI_STATE } from '../modelComparison';

const route = (provider: string, context_window: number | null, input_modes: string[] | null, cost_in = 1) => ({ provider, provider_name: provider, model_id: provider, model_name: 'X', context_window, input_modes, output_modes: ['text'], cost_in, cost_out: 1, is_local: false, tags: [], quality: 2 });
const model: AiModelComparisonEntry = { id: 'x', name: 'X', slug: 'x', creator: 'Maker', context_window: 1000000, modes: ['text', 'image'], routes: [route('small', 8000, ['text'], .1), route('large', 200000, ['text', 'image'], 5), route('unknown', null, null)], profile: 'unrated', agentic: null, coding: null, intelligence: null, speed: null, latency: null, input_price: 0, output_price: 0, release_date: '', tags: [] };
const ui = { ...INITIAL_COMPARISON_UI_STATE, showIncomplete: true };
const feed = { models: [model], currency: { usd_rate: 1 } } as NonNullable<Parameters<typeof filteredComparisonModels>[0]>;

describe('provider capabilities', () => {
    it('never substitutes a provider context with the general model window', () => {
        expect(routeContextValue(model, 'small')).toBe(8000);
        expect(routeContextValue(model, 'unknown')).toBeNull();
        expect(routeContextValue(model, 'all')).toBe(200000);
        expect(filteredComparisonModels(feed, [], { ...ui, provider: 'small', minContext: '100' })).toHaveLength(0);
        expect(filteredComparisonModels(feed, [], { ...ui, provider: 'large', minContext: '100' })).toHaveLength(1);
    });
    it('requires price, context and modes on the same offer', () => {
        expect(filteredComparisonModels(feed, [], { ...ui, maxPrice: '1', minContext: '100' })).toHaveLength(0);
        expect(filteredComparisonModels(feed, [], { ...ui, maxPrice: '1', modes: ['image'] })).toHaveLength(0);
        expect(filteredComparisonModels(feed, [], { ...ui, provider: 'unknown', modes: ['image'] })).toHaveLength(0);
        expect(filteredComparisonModels(feed, [], { ...ui, provider: 'large', modes: ['image'] })).toHaveLength(1);
        expect(filteredComparisonModels(feed, [], { ...ui, minContext: '100' })[0]?.routes.map(r => r.provider)).toEqual(['large']);
    });
    it('retains distinct capabilities, deduplicates equivalents and sorts unknown last', () => {
        const duplicated = { ...model, routes: [...model.routes, route('small', 8000, ['text'], .1), route('small', 16000, ['text'])] };
        expect(comparisonRouteCapabilities(duplicated, 'all').map(r => r.context_window)).toEqual([8000, 16000, 200000, null]);
    });
    it('sorts context using the selected provider and places unknown last both ways', () => {
        const bigger = { ...model, id: 'bigger', context_window: 1, routes: [route('small', 32000, ['text'])] };
        const unknown = { ...model, id: 'unknown', routes: [route('small', null, null)] };
        const models = [model, unknown, bigger];
        for (const direction of ['asc', 'desc'] as const) {
            expect(filteredComparisonModels({ ...feed, models }, [], { ...ui, provider: 'small', sort: { key: 'context_window', direction } }).map(m => m.id)).toEqual(direction === 'asc' ? ['x', 'bigger', 'unknown'] : ['bigger', 'x', 'unknown']);
        }
    });
});
