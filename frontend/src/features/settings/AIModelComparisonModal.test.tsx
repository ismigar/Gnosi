import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AiModelComparison } from '../../shared/api/ai';
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
    it('renders the typed table and routes active-model deactivation', () => {
        const onClose = vi.fn();
        act(() => {
            root.render(<AIModelComparisonModal isOpen onClose={onClose} />);
        });

        expect(container.textContent).toContain('Model One');
        expect(container.textContent).toContain('model_comparison.title');
        const toggle = container.querySelector<HTMLButtonElement>(
            '[role="switch"]',
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
