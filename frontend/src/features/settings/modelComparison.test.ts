import { describe, expect, it } from 'vitest';

import type {
    AiModelComparison,
    AiModelComparisonEntry,
} from '../../shared/api/ai';
import {
    filteredComparisonModels,
    formatComparisonContext,
    formatComparisonCost,
    INITIAL_COMPARISON_UI_STATE,
    modelComparisonErrorCode,
    modelComparisonUiReducer,
    modelMonthlyCost,
} from './modelComparison';


const comparisonModel = (
    overrides: Partial<AiModelComparisonEntry>,
): AiModelComparisonEntry => ({
    agentic: 80,
    coding: 75,
    context_window: 128_000,
    creator: 'OpenAI',
    id: 'model-1',
    input_price: 1,
    intelligence: 85,
    latency: 0.5,
    modes: ['text'],
    name: 'Model One',
    output_price: 4,
    profile: 'worker',
    release_date: '2026-08-01',
    routes: [{
        context_window: 128_000,
        cost_in: 1,
        cost_out: 4,
        is_local: false,
        model_id: 'model-1',
        model_name: 'Model One',
        provider: 'openai',
        provider_name: 'OpenAI',
        quality: 4,
        tags: ['text'],
    }],
    slug: 'model-one',
    speed: 100,
    tags: ['text'],
    ...overrides,
});


const currency = {
    code: 'EUR',
    fetched_at: '2026-08-29T00:00:00Z',
    source: 'test',
    symbol: '€',
    usd_rate: 0.9,
};


const feed: AiModelComparison = {
    count: 4,
    currency,
    fetched_at: '2026-08-29T00:00:00Z',
    intelligence_index_version: '2026.08',
    models: [
        comparisonModel({}),
        comparisonModel({ name: 'Duplicate row' }),
        comparisonModel({
            creator: 'Anthropic',
            id: 'model-2',
            input_price: 2,
            intelligence: 90,
            name: 'Model Two',
            profile: 'expert',
            slug: 'model-two',
        }),
        comparisonModel({
            agentic: null,
            coding: null,
            context_window: null,
            id: 'unrated',
            input_price: null,
            intelligence: null,
            name: 'Unrated Model',
            output_price: null,
            profile: 'unrated',
            slug: 'unrated',
        }),
    ],
    source: 'test',
    source_url: 'https://example.test/models',
};


describe('model comparison domain', () => {
    it('reduces typed filters and sort changes without parallel local state', () => {
        const withMode = modelComparisonUiReducer(
            INITIAL_COMPARISON_UI_STATE,
            { mode: 'image', type: 'toggle-mode' },
        );
        const sorted = modelComparisonUiReducer(
            withMode,
            { key: 'name', type: 'change-sort' },
        );

        expect(sorted.modes).toEqual(['image']);
        expect(sorted.sort).toEqual({ direction: 'asc', key: 'name' });
        expect(modelComparisonUiReducer(
            sorted,
            { key: 'name', type: 'change-sort' },
        ).sort.direction).toBe('desc');
    });

    it('deduplicates, filters and sorts the generated comparison contract', () => {
        const models = filteredComparisonModels(feed, [{
            enabled: true,
            model_id: 'model-2',
            provider: 'openai',
        }], {
            ...INITIAL_COMPARISON_UI_STATE,
            availability: 'active',
            query: 'model two',
            sort: { direction: 'desc', key: 'intelligence' },
        });

        expect(models.map((model) => model.id)).toEqual(['model-2']);
        expect(filteredComparisonModels(
            feed,
            [],
            INITIAL_COMPARISON_UI_STATE,
        ).map((model) => model.id)).toEqual(['model-2', 'model-1']);
    });

    it('formats costs and calculates monthly token spend', () => {
        const model = comparisonModel({ input_price: 2, output_price: 8 });

        expect(modelMonthlyCost(model, '5000000', '1000000')).toBe(18);
        expect(formatComparisonContext(1_050_000)).toBe('1.1M');
        expect(formatComparisonCost(1.5, '€')).toMatch(/^1[,.]50 €$/);
        expect(formatComparisonCost(null, '€')).toBe('—');
    });

    it('preserves structured upstream error codes', () => {
        expect(modelComparisonErrorCode({
            payload: { detail: { code: 'missing_api_key' } },
        })).toBe('missing_api_key');
        expect(modelComparisonErrorCode({ code: 'network_down' })).toBe(
            'network_down',
        );
        expect(modelComparisonErrorCode(new Error('boom'))).toBe('network_error');
    });
});
