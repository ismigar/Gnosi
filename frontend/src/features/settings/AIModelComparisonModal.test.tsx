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
        t: (key: string) => key,
    }),
}));
vi.mock('../../shared/hooks/useModalKeyboard', () => ({
    useModalKeyboard: mocks.useModalKeyboard,
}));
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


describe('AIModelComparisonModal', () => {
    it('exposes parameter filters and explicit mode matching', () => {
        act(() => { root.render(<AIModelComparisonModal isOpen onClose={vi.fn()} />); });
        const tokenInputs = container.querySelectorAll<HTMLInputElement>('.model-cost-calculator input');
        expect([...tokenInputs].map(input => input.value)).toEqual(['5.000.000', '1.000.000']);
        const group = container.querySelector('.model-parameter-filters');
        expect(group?.querySelectorAll('input[type="number"]')).toHaveLength(2);
        const status = group?.querySelector('select');
        if (!status) throw new Error('Missing parameter status filter');
        act(() => { status.value = 'known'; status.dispatchEvent(new Event('change', { bubbles: true })); });
        expect(container.textContent).not.toContain('Model One');
        act(() => { status.value = 'all'; status.dispatchEvent(new Event('change', { bubbles: true })); });
        expect(container.textContent).toContain('Model One');
        const button = container.querySelector<HTMLButtonElement>('.model-modes-filter > button');
        act(() => { button?.click(); });
        const match = container.querySelector<HTMLSelectElement>('.model-modes-menu select');
        expect(match?.value).toBe('all');
        if (!match) throw new Error('Missing mode matching filter');
        act(() => { match.value = 'any'; match.dispatchEvent(new Event('change', { bubbles: true })); });
        expect(match.value).toBe('any');
        act(() => { match.dispatchEvent(new Event('pointerdown', { bubbles: true })); });
        expect(container.querySelector('.model-modes-menu')).not.toBeNull();
        act(() => { container.querySelector('.model-search input')?.dispatchEvent(new Event('pointerdown', { bubbles: true })); });
        expect(container.querySelector('.model-modes-menu')).toBeNull();
        expect(button?.getAttribute('aria-expanded')).toBe('false');
        act(() => { button?.click(); });
        expect(container.querySelector<HTMLSelectElement>('.model-modes-menu select')?.value).toBe('any');
    });

    it('explains missing catalog data and verification protocols, and offers refresh', () => {
        const implementation = mocks.useData.getMockImplementation();
        if (!implementation) throw new Error('Missing data fixture');
        const data = implementation() as ReturnType<typeof useModelComparisonData>;
        mocks.useData.mockReturnValue({ ...data, state: { ...data.state, feed: {
            ...FEED, models: [{ ...FEED.models[0], role_assessments: [{
                role: 'documentalist', status: 'catalog_compatible', score: 75, coverage: 80, method: 'weighted_catalog_v1', source: 'mixed',
                weights: { intelligence: .25, long_context: .45, token_cost: .15, speed: .10, latency: .05 },
                proofs: [], missing: ['speed', 'citation_fidelity'],
            }] }],
        } } });
        act(() => { root.render(<AIModelComparisonModal isOpen onClose={vi.fn()} />); });
        const details = container.querySelector('details.model-role-assessments');
        expect(details?.querySelector('summary')?.textContent).toContain('75/100');
        expect(details?.textContent).toContain('agent_team.missing_catalog');
        expect(details?.textContent).toContain('agent_team.verify_roles.documentalist');
        expect(details?.textContent).toContain('agent_team.verification_pending');
        const refresh = container.querySelector<HTMLButtonElement>('[aria-label="common.refresh"]');
        expect(refresh).not.toBeNull();
        act(() => { refresh?.click(); });
        expect(data.retry).toHaveBeenCalledOnce();
    });

    it.each([
        ['Qwen3 30B A3B (Reasoning)', 'Alibaba', '30.5 B', 'https://huggingface.co/Qwen/Qwen3-30B-A3B'],
        ['GPT-6 Astra (max)', 'OpenAI', 'model_comparison.parameters_not_published', 'https://developers.openai.com/api/docs/models'],
    ])('renders parameter evidence for %s', (name, creator, label, source) => {
        const implementation = mocks.useData.getMockImplementation();
        if (!implementation) throw new Error('Missing data fixture');
        const data = implementation() as ReturnType<typeof useModelComparisonData>;
        mocks.useData.mockReturnValue({ ...data, state: { ...data.state, feed: {
            ...FEED, models: [{ ...FEED.models[0], name, creator }],
        } } });
        act(() => { root.render(<AIModelComparisonModal isOpen onClose={vi.fn()} />); });
        const cell = container.querySelectorAll('tbody tr:first-child > td')[8];
        expect(cell?.textContent).toContain(label);
        expect(cell?.querySelector('a')?.getAttribute('href')).toBe(source);
        expect(cell?.querySelector('a')?.title).toContain('model_comparison.parameters_checked');
    });

    it('renders the typed table and routes active-model deactivation', () => {
        const onClose = vi.fn();
        act(() => {
            root.render(<AIModelComparisonModal isOpen onClose={onClose} />);
        });

        const headers = [...container.querySelectorAll('thead th')].map((cell) => cell.querySelector('button')?.getAttribute('aria-label') ?? cell.textContent.trim());
        expect(headers).toEqual([
            'model', 'profile', 'intelligence', 'context', 'input_price', 'output_price', 'monthly_cost',
            'modes', 'parameters', 'speed', 'latency', 'coding', 'agentic', 'creator', 'available',
        ].map((key) => `model_comparison.columns.${key}`));
        const cells = [...container.querySelectorAll('tbody tr:first-child > td')];
        expect(cells).toHaveLength(headers.length);
        expect(cells[2]?.textContent).toContain('85');
        expect(cells[3]?.textContent).toBe('128K');
        expect(cells[6]?.textContent).toContain('9');
        expect(cells[8]?.textContent).toContain('model_comparison.parameters_missing');
        expect(cells[13]?.textContent).toBe('OpenAI');
        expect(container.textContent).toContain('Model One');
        expect(container.textContent).toContain('model_comparison.title');
        const toggle = container.querySelector<HTMLButtonElement>(
            'tbody [role="switch"]',
        );
        if (!toggle) throw new Error('Availability switch was not rendered');
        act(() => {
            toggle.click();
        });
        expect(mocks.deactivateModel).toHaveBeenCalledWith(FEED.models[0]);

        const close = container.querySelector<HTMLButtonElement>(
            'button.gnosi-close-btn',
        );
        if (!close) throw new Error('Close action was not rendered');
        act(() => {
            close.click();
        });
        expect(onClose).toHaveBeenCalledOnce();
    });

    it('does not render the modal while closed', () => {
        act(() => {
            root.render(<AIModelComparisonModal isOpen={false} onClose={vi.fn()} />);
        });
        expect(container.textContent).toBe('');
    });
});
