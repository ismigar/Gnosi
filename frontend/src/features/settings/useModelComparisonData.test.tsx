import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
    AiModelComparison,
    AiModelComparisonEntry,
} from '../../shared/api/ai';
import {
    useModelComparisonData,
    type ModelComparisonDataController,
} from './useModelComparisonData';


const mocks = vi.hoisted(() => ({
    emitAppEvent: vi.fn(),
    fetchCatalog: vi.fn(),
    fetchComparison: vi.fn(),
    fetchModels: vi.fn(),
    logError: vi.fn(),
    setCredentials: vi.fn(),
    setStatus: vi.fn(),
    updateModels: vi.fn(),
}));


vi.mock('../../shared/notifications/notifyError', () => ({ logError: mocks.logError }));
vi.mock('../../shared/platform/app-events', () => ({
    emitAppEvent: mocks.emitAppEvent,
}));
vi.mock('../../shared/api/ai', () => ({
    fetchAiModelCatalog: mocks.fetchCatalog,
    fetchAiModelComparison: mocks.fetchComparison,
    fetchAiModels: mocks.fetchModels,
    setAiProviderCredentials: mocks.setCredentials,
    setAiProviderStatus: mocks.setStatus,
    updateAiModels: mocks.updateModels,
}));


const MODEL: AiModelComparisonEntry = {
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
};


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
    models: [MODEL],
    source: 'test',
    source_url: 'https://example.test/models',
};


interface HarnessProps {
    readonly onController: (controller: ModelComparisonDataController) => void;
}


function ControllerHarness({ onController }: HarnessProps) {
    const controller = useModelComparisonData(true);
    useEffect(() => {
        onController(controller);
    }, [controller, onController]);
    return <span>{controller.state.feed?.count ?? 0}</span>;
}


const reactTestGlobal = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
};
reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true;


let container: HTMLDivElement;
let root: Root;
let latestController: ModelComparisonDataController | null;


beforeEach(() => {
    vi.resetAllMocks();
    latestController = null;
    mocks.fetchComparison.mockResolvedValue(FEED);
    mocks.fetchModels.mockResolvedValue({
        budget: { monthly_usd: 10 },
        configured_models: [{
            enabled: true,
            model_id: 'model-1',
            provider: 'openai',
        }],
        currency: FEED.currency,
        default: [],
        models: [],
    });
    mocks.fetchCatalog.mockResolvedValue({
        providers: [{
            api: 'https://api.openai.test/v1',
            base_url: null,
            configured: true,
            connected: true,
            doc: '',
            enabled: true,
            env: [],
            has_api_key: true,
            id: 'openai',
            is_local: false,
            models: [],
            name: 'OpenAI',
            npm: '',
        }],
        schema: 1,
        source: 'test',
    });
    mocks.updateModels.mockResolvedValue({ count: 1, status: 'success' });
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


const currentController = (): ModelComparisonDataController => {
    if (!latestController) throw new Error('Controller was not published');
    return latestController;
};


describe('useModelComparisonData', () => {
    it('loads both contracts and disables the exact configured route', async () => {
        await act(async () => {
            root.render(
                <ControllerHarness onController={(controller) => {
                    latestController = controller;
                }} />,
            );
            await Promise.resolve();
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(container.textContent).toBe('1');
        expect(mocks.fetchComparison).toHaveBeenCalledOnce();
        expect(mocks.fetchModels).toHaveBeenCalledOnce();
        expect(mocks.fetchCatalog).toHaveBeenCalledOnce();

        await act(async () => {
            await currentController().deactivateModel(MODEL);
        });

        expect(mocks.updateModels).toHaveBeenCalledWith({
            budget: { monthly_usd: 10 },
            models: [{
                enabled: false,
                model_id: 'model-1',
                provider: 'openai',
            }],
        });
        expect(mocks.emitAppEvent).toHaveBeenCalledWith(
            'gnosi-ai-models-changed',
            { source: 'model-comparison' },
        );
        expect(currentController().state.actionMessage).toMatchObject({
            key: 'model_disabled',
            model: 'Model One',
            type: 'success',
        });
    });
});
