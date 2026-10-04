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
        i18n: { language: 'en' },
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
    HTMLDivElement.prototype.scrollTo = vi.fn();
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


function openCatalogue() {
    act(() => { container.querySelector<HTMLButtonElement>('.settings-section-tabs button:nth-child(2)')?.click(); });
}

describe('AIModelComparisonModal', () => {
    it('exposes parameter filters and explicit mode matching', () => {
        act(() => { root.render(<AIModelComparisonModal isOpen onClose={vi.fn()} />); });
        openCatalogue();
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

    it('shows provider context and directional capabilities instead of general model claims', () => {
        const implementation = mocks.useData.getMockImplementation();
        if (!implementation) throw new Error('Missing data fixture');
        const data = implementation() as ReturnType<typeof useModelComparisonData>;
        const base = FEED.models[0];
        if (!base || !base.routes[0]) throw new Error('Missing model fixture');
        mocks.useData.mockReturnValue({ ...data, state: { ...data.state, feed: {
            ...FEED, models: [{ ...base, context_window: 1000000, modes: ['video'], routes: [{
                ...base.routes[0], context_window: 8000, input_modes: ['text', 'image'],
                output_modes: ['text'], tool_call: false, reasoning: null,
            }] }],
        } } });
        act(() => { root.render(<AIModelComparisonModal isOpen onClose={vi.fn()} />); });
        openCatalogue();
        const row = container.querySelector('tbody tr');
        expect(row?.textContent).toContain('OpenAI — 8K');
        expect(row?.textContent).not.toContain('1M');
        expect(row?.textContent).toContain('model_comparison.input_modes — model_comparison.modes_list.text, model_comparison.modes_list.image');
        expect(row?.textContent).toContain('model_comparison.output_modes — model_comparison.modes_list.text');
        expect(row?.textContent).toContain('model_comparison.tool_call — model_comparison.unsupported');
        expect(row?.textContent).toContain('model_comparison.reasoning — model_comparison.unknown_capability');
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
        openCatalogue();
        const details = container.querySelector('.model-role-assessments');
        expect(details?.querySelector('button')?.textContent).toContain('75%');
        expect(details?.querySelector('.model-role-assessments__body')).toBeNull();
        act(() => { details?.querySelector<HTMLButtonElement>('button')?.click(); });
        expect(container.querySelector('.model-role-assessments__body')?.textContent).toContain('agent_team.missing_catalog');
        expect(container.querySelector('.model-role-assessments__body')?.textContent).toContain('agent_team.verify_roles.documentalist');
        expect(container.querySelector('.model-role-assessments__body')?.textContent).toContain('agent_team.verification_pending');
        const refresh = container.querySelector<HTMLButtonElement>('[aria-label="common.refresh"]');
        expect(refresh).not.toBeNull();
        act(() => { refresh?.click(); });
        expect(data.retry).toHaveBeenCalledOnce();
    });

    it('shows only the selected role and orders it by suitability', () => {
        const data = mocks.useData.getMockImplementation()?.() as ReturnType<typeof useModelComparisonData>;
        mocks.useData.mockReturnValue({ ...data, state: { ...data.state, feed: {
            ...FEED, models: [
                { ...FEED.models[0], id: 'a', name: 'A', role_assessments: [{ role: 'worker', status: 'catalog_compatible', score: 65 }, { role: 'expert', status: 'catalog_compatible', score: 99 }] },
                { ...FEED.models[0], id: 'b', name: 'B', role_assessments: [{ role: 'worker', status: 'catalog_compatible', score: 90 }, { role: 'expert', status: 'catalog_compatible', score: 60 }] },
            ],
        } } });
        act(() => { root.render(<AIModelComparisonModal isOpen onClose={vi.fn()} />); });
        openCatalogue();
        const filter = [...container.querySelectorAll('select')].find(s => s.querySelector('option[value="worker"]'));
        if (!filter) throw new Error('Missing role filter');
        act(() => { filter.value = 'worker'; filter.dispatchEvent(new Event('change', { bubbles: true })); });
        const summaries = [...container.querySelectorAll('.model-role-assessments > .model-details-trigger')];
        expect(summaries.map(s => s.textContent)).toEqual(['model_comparison.profiles.worker · 90%', 'model_comparison.profiles.worker · 65%']);
        expect(container.querySelector('.model-role-assessments')?.textContent).not.toContain('model_comparison.profiles.expert');
        const sort = container.querySelector<HTMLButtonElement>('[aria-label="model_comparison.columns.profile"]');
        act(() => { sort?.click(); });
        act(() => { sort?.click(); });
        expect(container.querySelector('tbody tr:first-child strong')?.textContent).toBe('B');
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
        openCatalogue();
        const cell = container.querySelectorAll('tbody tr:first-child > td')[9];
        expect(cell?.textContent).toContain(label);
        expect(cell?.querySelector('a')?.getAttribute('href')).toBe(source);
        expect(cell?.querySelector('a')?.title).toContain('model_comparison.parameters_checked');
    });

    it('renders the typed table and routes active-model deactivation', () => {
        const onClose = vi.fn();
        act(() => {
            root.render(<AIModelComparisonModal isOpen onClose={onClose} />);
        });
        openCatalogue();

        const headers = [...container.querySelectorAll('thead th')].map((cell) => cell.querySelector('button')?.getAttribute('aria-label') ?? cell.textContent.trim());
        expect(headers).toEqual([
            'model', 'profile', 'monthly_cost', 'creator', 'intelligence', 'context', 'input_price', 'output_price',
            'modes', 'parameters', 'speed', 'latency', 'coding', 'agentic', 'available',
        ].map((key) => `model_comparison.columns.${key}`));
        const cells = [...container.querySelectorAll('tbody tr:first-child > td')];
        expect(cells).toHaveLength(headers.length);
        expect(cells[4]?.textContent).toContain('85');
        expect(cells[5]?.textContent).toBe('OpenAI — 128K');
        expect(cells[2]?.textContent).toContain('9');
        expect(cells[2]?.textContent).toContain('OpenAI —');
        expect(cells[9]?.textContent).toContain('model_comparison.parameters_missing');
        expect(cells[14]?.textContent).toBe('OpenAI');
        expect(container.textContent).toContain('Model One');
        expect(container.textContent).toContain('model_comparison.title');
        const toggle = container.querySelector<HTMLButtonElement>(
            'tbody [role="switch"]',
        );
        if (!toggle) throw new Error('Availability switch was not rendered');
        act(() => {
            toggle.click();
        });
        expect(mocks.deactivateModel).toHaveBeenCalledWith(FEED.models[0], 'all');

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

it('keeps a model with many provider offers compact and reveals the remaining offers on demand', () => {
    const data = mocks.useData.getMockImplementation()?.() as ReturnType<typeof useModelComparisonData>;
    const base = FEED.models[0];
    if (!base || !base.routes[0]) throw new Error('Missing route fixture');
    const routes = Array.from({ length: 24 }, (_, index) => ({ ...base.routes[0], provider: `provider-${String(index)}`, provider_name: `Provider ${String(index)}`, cost_in: index + 1 }));
    mocks.useData.mockReturnValue({ ...data, state: { ...data.state, feed: { ...FEED, models: [{ ...base, routes }] } } });
    act(() => { root.render(<AIModelComparisonModal isOpen onClose={vi.fn()} />); });
        openCatalogue();
    const row = container.querySelector('tbody tr');
    expect(row?.textContent).toContain('Model One');
    const offerLists = [...container.querySelectorAll('.model-offer-list')];
    expect(offerLists).toHaveLength(5);
    for (const list of offerLists) {
        expect(list.querySelectorAll(':scope > div')).toHaveLength(1);
        expect(list.querySelector('.model-offer-list__details')).toBeNull();
    }
    const firstList = offerLists[0];
    if (!firstList) throw new Error('Missing offers');
    const offers = firstList.querySelector<HTMLButtonElement>('button');
    act(() => { offers?.click(); });
    expect(container.querySelectorAll('.model-offer-list__details > div')).toHaveLength(24);
    expect(container.querySelector('.model-details-popover')?.textContent).toContain('Provider 23');
    act(() => { offers?.click(); });
    expect(container.querySelector('.model-offer-list__details')).toBeNull();
    act(() => { firstList.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); });
    expect(container.querySelectorAll('.model-offer-list__details > div')).toHaveLength(24);
});

it('starts with a bot decision view and separates the catalogue and optional tests', async () => {
    await act(async () => { root.render(<AIModelComparisonModal isOpen onClose={vi.fn()} bots={[
        { id: 'principal', name: 'Principal', provider: 'openai', model: 'model-1' },
        { id: 'wiki', name: 'Knowledge', managed_by: 'builtin:llm-wiki', provider: 'openai', model: 'model-1' },
        { id: 'suspended', name: 'Hidden', managed_by: 'builtin:mail', plugin_suspended: true },
    ]} principalId="principal" />);  await Promise.resolve(); });
    expect(container.querySelector('.model-comparison-table')).toBeNull();
    expect(container.querySelector('.model-comparison-toolbar')).toBeNull();
    expect(container.querySelector('.agent-evaluation-lab')).toBeNull();
    expect(container.textContent).not.toContain('Hidden');
    const botSelect = container.querySelector<HTMLSelectElement>('.model-bot-context select');
    expect(botSelect?.value).toBe('principal');
    const taskSelect = () => container.querySelector<HTMLSelectElement>('.model-task-recommendations select');
    expect(taskSelect()?.value).toBe('workflow');
    await act(async () => { if (botSelect) { botSelect.value = 'wiki'; botSelect.dispatchEvent(new Event('change', { bubbles: true })); }  await Promise.resolve(); });
    expect(taskSelect()?.value).toBe('book');
    await act(async () => { const select = taskSelect(); if (select) { select.value = 'retrieve'; select.dispatchEvent(new Event('change', { bubbles: true })); }  await Promise.resolve(); });
    openCatalogue(); expect(container.querySelector('.model-comparison-table')).not.toBeNull();
    expect(container.querySelector('.model-task-recommendations')).toBeNull();
    await act(async () => { container.querySelector<HTMLButtonElement>('.settings-section-tabs button:nth-child(3)')?.click();  await Promise.resolve(); });
    expect(container.querySelector('.agent-evaluation-lab')).not.toBeNull();
    expect(container.querySelector('.model-comparison-table')).toBeNull();
    expect(mocks.beginActivation).not.toHaveBeenCalled();
    await act(async () => { container.querySelector<HTMLButtonElement>('.settings-section-tabs button:first-child')?.click();  await Promise.resolve(); });
    expect(taskSelect()?.value).toBe('retrieve');
});

it('assigns an explicitly chosen active route to the selected bot and opens its existing settings', async () => {
    const assign = vi.fn(); const configure = vi.fn();
    await act(async () => { root.render(<AIModelComparisonModal isOpen onClose={vi.fn()} bots={[
        { id: 'wiki', name: 'Knowledge', managed_by: 'builtin:llm-wiki', provider: 'old', model: 'old-model' },
    ]} onAssignModel={assign} onConfigureBot={configure} saveStatus="error" />);  await Promise.resolve(); });
    const route = container.querySelector<HTMLSelectElement>('.model-bot-context details select');
    const button = container.querySelector<HTMLButtonElement>('.model-bot-context details button');
    expect(button?.disabled).toBe(true);
    act(() => { if (route) { route.value = JSON.stringify(['openai', 'model-1']); route.dispatchEvent(new Event('change', { bubbles: true })); } });
    expect(assign).not.toHaveBeenCalled();
    act(() => { button?.click(); });
    expect(assign).toHaveBeenCalledWith('wiki', 'openai', 'model-1');
    act(() => { container.querySelector<HTMLButtonElement>('.model-bot-context__summary > button')?.click(); });
    expect(configure).toHaveBeenCalledWith('wiki');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('model_comparison.workspace.save_error');
});
