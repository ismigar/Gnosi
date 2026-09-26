import { routeRoleAssessments } from './model-comparison/routeRoleAssessments';
import { registryEntryMatchesModel } from './model-comparison/modelComparisonRegistry';
import { describe, expect, it } from 'vitest';

import type {
    AiModelComparison,
    AiModelComparisonEntry,
} from '../../shared/api/ai';
import {
    filteredComparisonModels,
    formatTokenCountInput,
    normalizeTokenCountInput,
    formatComparisonContext,
    formatComparisonCost,
    INITIAL_COMPARISON_UI_STATE,
    modelComparisonErrorCode,
    modelComparisonColumns,
    modelMetricAvailability,
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
        input_modes: ['text'],
        output_modes: ['text'],
        cost_in: 1,
        cost_out: 4,
        is_local: false,
        model_id: 'model-1',
        model_name: 'Model One',
        tool_call: true, provider: 'openai',
        provider_name: 'OpenAI',
        quality: 4,
        tags: ['text'],
    }],
    slug: 'model-one',
    speed: 100,
    tags: ['text'],
    ...overrides,
});


function firstRoute(model: AiModelComparisonEntry) {
    const route = model.routes[0];
    if (!route) throw new Error('Missing fixture route');
    return route;
}


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
            routes: [{ ...firstRoute(comparisonModel({})), model_id: 'model-2' }],
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
    it('groups token counts with dots while preserving integer cost calculations', () => {
        expect(formatTokenCountInput('5000000')).toBe('5.000.000');
        expect(formatTokenCountInput('123456789')).toBe('123.456.789');
        expect(formatTokenCountInput('')).toBe('');
        expect(normalizeTokenCountInput('1.234.567')).toBe('1234567');
        expect(normalizeTokenCountInput('2 000 000')).toBe('2000000');
        expect(normalizeTokenCountInput('-1')).toBeNull();
        expect(normalizeTokenCountInput('1e6')).toBeNull();
        const state = modelComparisonUiReducer(INITIAL_COMPARISON_UI_STATE,
            { type: 'set-input-tokens', value: '2.000.000' });
        const output = modelComparisonUiReducer(state,
            { type: 'set-output-tokens', value: '1.000.000' });
        expect(output.inputTokens).toBe('2000000');
        expect(modelMonthlyCost(comparisonModel({}), output.inputTokens, output.outputTokens)).toBe(6);
        expect(modelComparisonUiReducer(output, { type: 'set-input-tokens', value: 'invalid' }).inputTokens).toBe('2000000');
        expect(modelComparisonUiReducer(output, { type: 'set-input-tokens', value: '' }).inputTokens).toBe('');
    });

    it('applies the price ceiling in configured currency after USD conversion', () => {
        const models = [comparisonModel({ input_price: 0, routes: [{ ...firstRoute(comparisonModel({})), cost_in: 10 }] })];
        for (const [rate, limit, count] of [[0.9, '9', 1], [0.9, '8.99', 0], [150, '1400', 0], [1, '10', 1]] as const) {
            expect(filteredComparisonModels({ ...feed, models, currency: { ...currency, usd_rate: rate } }, [], {
                ...INITIAL_COMPARISON_UI_STATE, maxPrice: limit,
            })).toHaveLength(count);
        }
    });

    it('requires every selected mode by default and supports any mode explicitly', () => {
        const models = [
            comparisonModel({ id: 'text', modes: ['text'], routes: [{ ...firstRoute(comparisonModel({})), input_modes: ['text'], output_modes: [] }] }),
            comparisonModel({ id: 'image', modes: ['image'], routes: [{ ...firstRoute(comparisonModel({})), input_modes: ['image'], output_modes: [] }] }),
            comparisonModel({ id: 'both', modes: ['text', 'image'], routes: [{ ...firstRoute(comparisonModel({})), input_modes: ['text', 'image'], output_modes: [] }] }),
            comparisonModel({ id: 'audio', modes: ['audio'], routes: [{ ...firstRoute(comparisonModel({})), input_modes: ['audio'], output_modes: [] }] }),
        ];
        const ui = { ...INITIAL_COMPARISON_UI_STATE, modes: ['text', 'image'] as const };
        expect(filteredComparisonModels({ ...feed, models }, [], ui).map(m => m.id)).toEqual(['both']);
        expect(filteredComparisonModels({ ...feed, models }, [], { ...ui, modeMatch: 'any' }).map(m => m.id))
            .toEqual(['text', 'image', 'both']);
        expect(filteredComparisonModels({ ...feed, models }, [], { ...ui, modes: [] })).toHaveLength(4);
    });

    it('filters total parameter ranges inclusively and distinguishes missing data', () => {
        const models = [
            comparisonModel({ id: 'small', name: 'gpt-oss-20b' }),
            comparisonModel({ id: 'large', name: 'gpt-oss-120b' }),
            comparisonModel({ id: 'closed', name: 'GPT-6 Astra' }),
            comparisonModel({ id: 'pending', name: 'Unknown' }),
        ];
        const ids = (patch: Partial<typeof INITIAL_COMPARISON_UI_STATE>) => filteredComparisonModels(
            { ...feed, models }, [], { ...INITIAL_COMPARISON_UI_STATE, ...patch },
        ).map(m => m.id);
        expect(ids({})).toEqual(['small', 'large', 'closed', 'pending']);
        expect(ids({ minParameters: '21', maxParameters: '117' })).toEqual(['small', 'large']);
        expect(ids({ maxParameters: '21' })).toEqual(['small']);
        expect(ids({ minParameters: '21.1' })).toEqual(['large']);
        expect(ids({ maxParameters: '0' })).toEqual([]);
        expect(ids({ minParameters: '118', maxParameters: '21' })).toEqual([]);
        expect(ids({ parameterStatus: 'known' })).toEqual(['small', 'large']);
        expect(ids({ parameterStatus: 'not_published' })).toEqual(['closed']);
        expect(ids({ parameterStatus: 'pending' })).toEqual(['pending']);
        expect(ids({ parameterStatus: 'pending', minParameters: '1' })).toEqual([]);
    });

    it('sorts disclosed parameter counts numerically, keeping unknown sizes last', () => {
        const models = [
            comparisonModel({ id: 'unknown', name: 'Unknown 2B' }),
            comparisonModel({ id: 'large', name: 'gpt-oss-120b (high)' }),
            comparisonModel({ id: 'small', name: 'gpt-oss-20b (high)' }),
        ];
        for (const direction of ['asc', 'desc'] as const) {
            const result = filteredComparisonModels({ ...feed, models }, [], {
                ...INITIAL_COMPARISON_UI_STATE, sort: { key: 'parameters', direction },
            });
            expect(result.map((model) => model.id)).toEqual(direction === 'asc'
                ? ['small', 'large', 'unknown'] : ['large', 'small', 'unknown']);
        }
    });

    it('sorts the monthly estimate using the current input and output volumes', () => {
        const models = [
            comparisonModel({ id: 'input', input_price: 0, output_price: 0, routes: [{ ...firstRoute(comparisonModel({})), cost_in: 1, cost_out: 20 }] }),
            comparisonModel({ id: 'output', input_price: 0, output_price: 0, routes: [{ ...firstRoute(comparisonModel({})), cost_in: 10, cost_out: 2 }] }),
        ];
        const result = filteredComparisonModels({ ...feed, models }, [], {
            ...INITIAL_COMPARISON_UI_STATE, inputTokens: '0', outputTokens: '1000000',
            sort: { key: 'monthly_cost', direction: 'asc' },
        });
        expect(result.map((model) => model.id)).toEqual(['output', 'input']);
    });

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
        expect(formatComparisonContext(1_050_000)).toBe(`${(1.05).toLocaleString(
            undefined,
            { maximumFractionDigits: 1 },
        )}M`);
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

it('filters by serving provider, including models created by another vendor', () => {
    const google = comparisonModel({ id: 'google-direct', creator: 'Google', routes: [{ ...firstRoute(comparisonModel({})), provider: 'google', provider_name: 'Google' }] });
    const routed = comparisonModel({ id: 'google-routed', creator: 'Google', routes: [{ ...firstRoute(google), provider: 'openrouter', provider_name: 'OpenRouter' }] });
    const models = [google, routed];
    const ui = { ...INITIAL_COMPARISON_UI_STATE, modes: [] as const, minContext: '', maxPrice: '' };
    expect(filteredComparisonModels({ ...feed, models }, [], { ...ui, provider: 'openrouter' }).map(model => model.id)).toEqual(['google-routed']);
    expect(filteredComparisonModels({ ...feed, models }, [], { ...ui, provider: 'google' }).map(model => model.id)).toEqual(['google-direct']);
    expect(filteredComparisonModels({ ...feed, models }, [], ui)).toHaveLength(2);
});

it('shows multi-role assessments next to the model even without a legacy profile', () => {
    const model = comparisonModel({ profile: 'unrated', role_assessments: [{ role: 'documentalist', status: 'insufficient_data', coverage: 0, method: 'weighted_catalog_v1', source: 'catalog' }] });
    const available = modelMetricAvailability({ models: [model] } as AiModelComparison);
    expect(available.profile).toBe(true);
    expect(modelComparisonColumns(available).slice(0, 2).map(c => c.key)).toEqual(['name', 'profile']);
});


describe('role suitability ordering', () => {
    it('sorts by the selected role score rather than other roles or names', () => {
        const models = [
            comparisonModel({ id: 'a', role_assessments: [{ role: 'worker', status: 'catalog_compatible', coverage: 80, method: 'weighted_catalog_v1', source: 'catalog', score: 65 }, { role: 'expert', status: 'catalog_compatible', coverage: 80, method: 'weighted_catalog_v1', source: 'catalog', score: 99 }] }),
            comparisonModel({ id: 'b', role_assessments: [{ role: 'worker', status: 'catalog_compatible', coverage: 80, method: 'weighted_catalog_v1', source: 'catalog', score: 90 }, { role: 'expert', status: 'catalog_compatible', coverage: 80, method: 'weighted_catalog_v1', source: 'catalog', score: 60 }] }),
            comparisonModel({ id: 'c', role_assessments: [{ role: 'worker', status: 'catalog_compatible', coverage: 80, method: 'weighted_catalog_v1', source: 'catalog', score: null }] }),
        ];
        const ui = { ...INITIAL_COMPARISON_UI_STATE, profile: 'worker' as const, sort: { key: 'profile' as const, direction: 'desc' as const } };
        expect(filteredComparisonModels({ ...feed, models }, [], ui).map(m => m.id)).toEqual(['b', 'a', 'c']);
        expect(filteredComparisonModels({ ...feed, models }, [], { ...ui, sort: { ...ui.sort, direction: 'asc' } }).map(m => m.id)).toEqual(['a', 'b', 'c']);
        expect(modelComparisonColumns(modelMetricAvailability(feed)).slice(0,4).map(c => c.key)).toEqual(['name','profile','monthly_cost','creator']);
    });
});

it('only includes insufficient role evidence when incomplete models are explicitly enabled', () => {
    const role = { role: 'director', status: 'catalog_compatible', coverage: 80, method: 'weighted_catalog_v1', source: 'catalog', score: 85 } as const;
    const models = [comparisonModel({ id: 'unknown', coding: null, agentic: null, role_assessments: [{ ...role, status: 'insufficient_data', score: null }] }), comparisonModel({ id: 'known', role_assessments: [role] })];
    const ui = modelComparisonUiReducer(INITIAL_COMPARISON_UI_STATE, { type: 'set-profile', value: 'director' });
    expect(ui.sort).toEqual({ key: 'profile', direction: 'desc' });
    expect(filteredComparisonModels({ ...feed, models }, [], ui).map(m => m.id)).toEqual(['known']);
    expect(filteredComparisonModels({ ...feed, models }, [], { ...ui, showIncomplete: true }).map(m => m.id)).toEqual(['known', 'unknown']);
    const reset = modelComparisonUiReducer({ ...ui, provider: 'openrouter', availability: 'inactive', modes: ['image'], maxPrice: '1', inputTokens: '12' }, { type: 'compare-role-candidates' });
    expect(reset).toMatchObject({ profile: 'director', provider: 'all', availability: 'all', modes: [], maxPrice: '', inputTokens: '12', showIncomplete: true });
    expect(filteredComparisonModels({ ...feed, models }, [], reset).map(m => m.id)).toEqual(['known', 'unknown']);
});

it('sorts the manufacturer column by creator, independently of hosting routes', () => {
    const models = [comparisonModel({ id: 'openai', creator: 'OpenAI' }), comparisonModel({ id: 'anthropic', creator: 'Anthropic' })];
    expect(filteredComparisonModels({ ...feed, models }, [], { ...INITIAL_COMPARISON_UI_STATE, sort: { key: 'creator', direction: 'asc' } }).map(m => m.id)).toEqual(['anthropic', 'openai']);
});

 it('keeps benchmarked models visible when optional route modalities are unknown', () => {
    const model = comparisonModel({ routes: comparisonModel({}).routes.map(route => ({ ...route, input_modes: undefined, output_modes: undefined })) });
    expect(filteredComparisonModels({ ...feed, models: [model] }, [], INITIAL_COMPARISON_UI_STATE)).toHaveLength(1);
    expect(filteredComparisonModels({ ...feed, models: [model] }, [], { ...INITIAL_COMPARISON_UI_STATE, modes: ['image'] })).toHaveLength(0);
});


it('does not treat an active worker or its alias as evidence of director suitability', () => {
    const assessment = { coverage: 75, method: 'weighted_catalog_v1', source: 'catalog' } as const;
    const models = [comparisonModel({
        id: 'flash-lite', name: 'Gemini Flash-Lite',
        role_assessments: [
            { ...assessment, role: 'worker', status: 'catalog_compatible', score: 90 },
            { ...assessment, role: 'director', status: 'insufficient_data', score: null },
        ],
    })];
    const registry = [{ provider: 'openai', model_id: 'model-1', enabled: true, alias: 'Peó - multimode' }];
    const ui = { ...INITIAL_COMPARISON_UI_STATE, profile: 'director' as const, availability: 'active' as const };
    expect(filteredComparisonModels({ ...feed, models }, registry, ui)).toEqual([]);
    expect(filteredComparisonModels({ ...feed, models }, registry, { ...ui, showIncomplete: true }).map(m => m.id)).toEqual(['flash-lite']);
    expect(filteredComparisonModels({ ...feed, models }, registry, { ...ui, profile: 'worker' }).map(m => m.id)).toEqual(['flash-lite']);
});

describe('comparison identity and filter regressions', () => {
    it('does not match a different model variant through a substring', () => {
        expect(registryEntryMatchesModel({provider:'openai', model_id:'gpt-4.1-mini'}, {id:'aa-main', slug:'gpt-4.1', name:'GPT-4.1', routes:[{provider:'openai',model_id:'gpt-4.1'}]})).toBe(false);
    });
    it('filters active state within the selected provider', () => {
        const model = comparisonModel({routes:[...comparisonModel({}).routes, {...firstRoute(comparisonModel({})),provider:'openrouter',model_id:'vendor/model-1'}]});
        const registry=[{provider:'openai',model_id:'model-1',enabled:true}];
        expect(filteredComparisonModels({...feed,models:[model]}, registry,{...INITIAL_COMPARISON_UI_STATE,provider:'openrouter',availability:'active'})).toEqual([]);
    });
    it('keeps incomplete models hidden when entering a search query', () => {
        const model=comparisonModel({coding:null, agentic:null, profile:'unrated', name:'Unknown Model'});
        expect(filteredComparisonModels({...feed,models:[model]},[],{...INITIAL_COMPARISON_UI_STATE,query:'Unknown',showIncomplete:false})).toEqual([]);
    });
    it('searches the provider advertised by the search placeholder', () => {
        const model=comparisonModel({routes:[{...firstRoute(comparisonModel({})),provider:'openrouter',provider_name:'OpenRouter'}]});
        expect(filteredComparisonModels({...feed,models:[model]},[],{...INITIAL_COMPARISON_UI_STATE,query:'OpenRouter',showIncomplete:true})).toHaveLength(1);
    });
    it('rejects a director route that explicitly cannot call tools', () => {
        const model=comparisonModel({role_assessments:[{role:'director',status:'catalog_compatible',score:85,coverage:100,method:'weighted_catalog_v1',source:'catalog'}],routes:[{...firstRoute(comparisonModel({})),tool_call:false}]});
        expect(filteredComparisonModels({...feed,models:[model]},[],{...INITIAL_COMPARISON_UI_STATE,profile:'director'})).toEqual([]);
    });
});


it('does not label a low numeric score as unrated', () => {
    const model = comparisonModel({role_assessments: [{role:'worker',status:'below_threshold',score:35,coverage:100,method:'weighted_catalog_v1',source:'catalog'}]});
    expect(filteredComparisonModels({...feed,models:[model]},[],{...INITIAL_COMPARISON_UI_STATE,profile:'unrated'})).toEqual([]);
});

it('requires declared tools for a director unless incomplete routes are requested', () => {
    const model = comparisonModel({role_assessments: [{role:'director',status:'catalog_compatible',score:85,coverage:100,method:'weighted_catalog_v1',source:'catalog'}], routes:[{...firstRoute(comparisonModel({})),tool_call:null}]});
    const ui = {...INITIAL_COMPARISON_UI_STATE,profile:'director' as const};
    expect(filteredComparisonModels({...feed,models:[model]},[],ui)).toEqual([]);
    expect(filteredComparisonModels({...feed,models:[model]},[],{...ui,showIncomplete:true})).toHaveLength(1);
});


it('replaces global role capability evidence with the visible route limitation', () => {
    const model = comparisonModel({role_assessments:[{role:'director',status:'catalog_compatible',score:85,coverage:100,method:'weighted_catalog_v1',source:'catalog',proofs:[{metric:'tool_support',source:'declared',value:true}],weights:{tool_support:.2},missing:[]}],routes:[{...firstRoute(comparisonModel({})),tool_call:false}]});
    const assessment = routeRoleAssessments(model)[0];
    expect(assessment).toMatchObject({status:'limitation',score:null});
    expect(assessment?.proofs).toEqual([{metric:'tool_support',source:'declared',value:false}]);
    const unknown = routeRoleAssessments({...model,routes:[{...firstRoute(model),tool_call:null}]})[0];
    expect(unknown).toMatchObject({status:'insufficient_data',score:null,coverage:80,missing:['tool_support'],proofs:[]});
});
