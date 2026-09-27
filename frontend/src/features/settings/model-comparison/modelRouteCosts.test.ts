import { describe, expect, it } from 'vitest';
import type { AiModelComparisonEntry } from '../../../shared/api/ai';
import { comparisonRouteCosts, routePriceValue } from './modelRouteCosts';
import { filteredComparisonModels, INITIAL_COMPARISON_UI_STATE, formatComparisonCost } from '../modelComparison';

const route = (provider: string, cost_in: number | null, cost_out: number | null) => ({ provider, provider_name: provider, cost_in, cost_out, model_id: 'x', model_name: 'X', context_window: 100000, is_local: false, quality: 2, tags: [] });
const model: AiModelComparisonEntry = { agentic: null, coding: null, context_window: 100000, intelligence: null, latency: null, speed: null, profile: 'unrated', release_date: '', tags: [], id: 'x', name: 'X', slug: 'x', creator: 'Maker', modes: ['text'], input_price: 0, output_price: 0, routes: [route('cohere', 0, 0), route('openrouter', .3, 1.5), route('unknown', null, null)] };

describe('route pricing', () => {
    it('uses the selected provider even when the benchmark price is zero', () => {
        expect(routePriceValue(model, 'openrouter', 'monthly_cost', '5000000', '1000000')).toBe(3);
        expect(routePriceValue(model, 'missing', 'monthly_cost', '5000000', '1000000')).toBeNull();
    });
    it('keeps distinct provider offers sorted, deduplicates identical offers and places unknowns last', () => {
        const duplicate = { ...model, routes: [...model.routes, route('openrouter', .3, 1.5), route('openrouter', .4, 2)] };
        expect(comparisonRouteCosts(duplicate, 'all', '5.000.000', '1.000.000').map(c => [c.route.provider, c.cost])).toEqual([['cohere', 0], ['openrouter', 3], ['openrouter', 4], ['unknown', null]]);
    });
    it('does not turn partial or invalid prices into free service', () => {
        const partial = { ...model, routes: [route('x', 0, null), route('y', -1, 0), route('z', NaN, 0)] };
        expect(comparisonRouteCosts(partial, 'all', '0', '0').every(c => c.cost === null)).toBe(true);
        expect(formatComparisonCost(.0001, '€')).toMatch(/^< /);
        expect(formatComparisonCost(0, '€')).not.toMatch(/^< /);
    });
    it('filters and sorts with route prices rather than generic catalog prices', () => {
        const second = { ...model, id: 'y', routes: [route('openrouter', .1, .2)] };
        const feed = { models: [model, second], currency: { usd_rate: 1 } } as Parameters<typeof filteredComparisonModels>[0];
        const ui = { ...INITIAL_COMPARISON_UI_STATE, showIncomplete: true, provider: 'openrouter', sort: { key: 'monthly_cost' as const, direction: 'asc' as const } };
        expect(filteredComparisonModels(feed, [], ui).map(m => m.id)).toEqual(['y','x']);
        expect(filteredComparisonModels(feed, [], { ...ui, maxPrice: '.2' }).map(m => m.id)).toEqual(['y']);
    });
});


it('previews the same offer value used to sort each price column', () => {
    const crossed = { ...model, routes: [route('input-cheap', 1, 100), route('output-cheap', 2, 1)] };
    expect(comparisonRouteCosts(crossed, 'all', '5000000', '1000000', 'input_price')[0]?.route.cost_in).toBe(1);
    expect(comparisonRouteCosts(crossed, 'all', '5000000', '1000000', 'output_price')[0]?.route.cost_out).toBe(1);
    expect(comparisonRouteCosts(crossed, 'all', '5000000', '1000000')[0]?.cost).toBe(11);
});
