import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AiModelComparison } from '../../shared/api/ai';
import type { useModelComparisonData } from './useModelComparisonData';
import { AIModelComparisonModal } from './AIModelComparisonModal';


const mocks = vi.hoisted(() => ({
    beginActivation: vi.fn(),
    deactivateModel: vi.fn(),
    useData: vi.fn(),
    useModalKeyboard: vi.fn(),
}));


vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, options?: { count?: number }) => key === 'model_comparison.results_count' ? `Results: ${String(options?.count ?? 0)}` : key,
    }),
}));
vi.mock('../../shared/hooks/useModalKeyboard', () => ({
    useModalKeyboard: mocks.useModalKeyboard,
}));
vi.mock('./AI/AgentEvaluationLab', () => ({ AgentEvaluationLab: () => null }));
vi.mock('./useModelComparisonData', () => ({
    useModelComparisonData: mocks.useData,
}));
vi.mock('./useModelComparisonLayout', () => ({
    useModelComparisonLayout: () => ({
        bodyRef: { current: null },
        filterHeight: 48,
        modalRef: { current: null },
        onScrollbarScroll: vi.fn(),
        profileHelpRef: { current: null },
        scrollbarRef: { current: null },
        tableScrollWidth: 1200,
        tableViewportWidth: 900,
        tableWrapRef: { current: null },
        toolbarRef: { current: null },
    }),
}));


const FEED: AiModelComparison = {
    count: 1,
    currency: {
        code: 'EUR',
        fetched_at: '2026-08-29T00:00:00Z',
        source: 'test',
        symbol: '€',
        usd_rate: 1,
    },
    fetched_at: '2026-08-29T00:00:00Z',
    intelligence_index_version: '2026.08',
    models: [{
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
            provider: 'openai',
            provider_name: 'OpenAI',
            quality: 4,
            tags: ['text'],
        }],
        slug: 'model-one',
        speed: 100,
        tags: ['text'],
    }],
    source: 'test',
    source_url: 'https://example.test/models',
};


const reactTestGlobal = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
};
reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true;


let container: HTMLDivElement;
let root: Root;


beforeEach(() => {
    vi.resetAllMocks();
    mocks.deactivateModel.mockResolvedValue(undefined);
    mocks.useData.mockReturnValue({
        activateModel: vi.fn(),
        beginActivation: mocks.beginActivation,
        changeSetupMode: vi.fn(),
        changeSetupProvider: vi.fn(),
        closeSetup: vi.fn(),
        deactivateModel: mocks.deactivateModel,
        dismissFallback: vi.fn(),
        providersById: {
            openai: { id: 'openai', name: 'OpenAI' },
        },
        retry: vi.fn(),
        routesForMode: vi.fn().mockReturnValue([]),
        saveArtificialAnalysisApiKey: vi.fn(),
        setApiKeyInput: vi.fn(),
        setSetupApiKey: vi.fn(),
        setSetupBaseUrl: vi.fn(),
        state: {
            actionMessage: null,
            apiKeyInput: '',
            busyModelId: '',
            catalog: null,
            configurationError: '',
            configurationLoading: false,
            errorCode: '',
            fallbackNoticeDismissed: false,
            feed: FEED,
            loading: false,
            registry: {
                budget: {},
                models: [{
                    enabled: true,
                    model_id: 'model-1',
                    provider: 'openai',
                }],
            },
            requestVersion: 0,
            savingApiKey: false,
            setup: null,
        },
    });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});


afterEach(() => {
    act(() => {
        root.unmount();
    });
    container.remove();
});


describe('comparison audit interface regressions', () => {
    it('announces the active sort column and direction as it changes', () => {
        act(() => { root.render(<AIModelComparisonModal isOpen onClose={vi.fn()} />); });
        const button = container.querySelector<HTMLButtonElement>('[aria-label="model_comparison.columns.input_price"]');
        expect(button).not.toBeNull();
        act(() => { button?.click(); });
        expect(button?.closest('th')?.getAttribute('aria-sort')).toBe('ascending');
        expect(container.querySelectorAll('th[aria-sort]')).toHaveLength(1);
        act(() => { button?.click(); });
        expect(button?.closest('th')?.getAttribute('aria-sort')).toBe('descending');
    });

    it('updates the result count when filters exclude all models', () => {
        act(() => { root.render(<AIModelComparisonModal isOpen onClose={vi.fn()} />); });
        expect(container.textContent).toContain('Results: 1');
        const filter = container.querySelector<HTMLSelectElement>('.model-parameter-filters select');
        if (!filter) throw new Error('Missing parameter filter');
        act(() => { filter.value = 'known'; filter.dispatchEvent(new Event('change', { bubbles: true })); });
        expect(container.textContent).toContain('Results: 0');
        expect(container.textContent).toContain('model_comparison.no_results');
    });

    it('previews the same minimum price and maximum context used for sorting', () => {
        const data = mocks.useData.getMockImplementation()?.() as ReturnType<typeof useModelComparisonData>;
        const base = FEED.models[0];
        const route = base?.routes[0];
        if (!base || !route) throw new Error('Missing fixture');
        mocks.useData.mockReturnValue({ ...data, state: { ...data.state, feed: { ...FEED, models: [{ ...base, routes: [
            { ...route, provider: 'input', provider_name: 'Cheaper input', cost_in: 1, cost_out: 100, context_window: 500000 },
            { ...route, provider: 'total', provider_name: 'Cheaper total', cost_in: 2, cost_out: 1, context_window: 8000 },
        ] }] } } });
        act(() => { root.render(<AIModelComparisonModal isOpen onClose={vi.fn()} />); });
        const cells = [...container.querySelectorAll('tbody tr:first-child > td')];
        expect(cells[2]?.textContent).toContain('Cheaper total');
        expect(cells[5]?.textContent).toContain('Cheaper input — 500K');
        expect(cells[6]?.textContent).toContain('Cheaper input');
        expect(cells[7]?.textContent).toContain('Cheaper total');
    });
});

it('identifies shared offers before deactivation without requiring activation setup', () => {
    const data = mocks.useData.getMockImplementation()?.() as ReturnType<typeof useModelComparisonData>;
    const base = FEED.models[0];
    if (!base || !base.routes[0]) throw new Error('Missing fixture');
    mocks.useData.mockReturnValue({ ...data, state: { ...data.state, feed: { ...FEED, count: 2, models: [
        { ...base, id: 'reasoning', name: 'Model (Reasoning)' },
        { ...base, id: 'plain', name: 'Model (Non-reasoning)' },
    ] } } });
    act(() => { root.render(<AIModelComparisonModal isOpen onClose={vi.fn()} />); });
    const rows = [...container.querySelectorAll('tbody tr')];
    expect(rows).toHaveLength(2);
    for (const row of rows) {
        expect(row.textContent).toContain('model_comparison.setup.shared_offer_label');
        expect(row.querySelector('[role="switch"]')?.getAttribute('aria-checked')).toBe('true');
    }
    expect(mocks.beginActivation).not.toHaveBeenCalled();
});

it('shows uncertainty rather than a compatible director when the offer has unknown tools', () => {
    const data = mocks.useData.getMockImplementation()?.() as ReturnType<typeof useModelComparisonData>;
    const base = FEED.models[0];
    if (!base || !base.routes[0]) throw new Error('Missing fixture');
    mocks.useData.mockReturnValue({ ...data, state: { ...data.state, feed: { ...FEED, models: [{
        ...base, routes: [{ ...base.routes[0], tool_call: null }],
        role_assessments: [{ role: 'director', status: 'catalog_compatible', score: 85, coverage: 100 }],
    }] } } });
    act(() => { root.render(<AIModelComparisonModal isOpen onClose={vi.fn()} />); });
    const filter = [...container.querySelectorAll('select')].find(select => select.querySelector('option[value="director"]'));
    if (!filter) throw new Error('Missing role filter');
    act(() => { filter.value = 'director'; filter.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(container.querySelectorAll('tbody tr')).toHaveLength(0);
    const incomplete = container.querySelector<HTMLElement>('[role="switch"][aria-label="model_comparison.show_incomplete"]');
    if (!incomplete) throw new Error('Missing incomplete-model switch');
    act(() => { incomplete.click(); });
    expect(container.querySelectorAll('tbody tr')).toHaveLength(1);
    const summary = container.querySelector('.model-role-assessments > .model-details-trigger');
    expect(summary?.textContent).toContain('agent_team.insufficient_data');
    expect(summary?.textContent).not.toContain('85%');
});
