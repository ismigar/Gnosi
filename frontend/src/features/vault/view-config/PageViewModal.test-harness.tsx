import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, vi } from 'vitest';

import { PageViewModal } from './PageViewModal';
import type { PageViewModalProps } from './page-view-modal/types';

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (
            key: string,
            fallbackOrOptions?: string | { readonly defaultValue?: string },
        ) => {
            if (typeof fallbackOrOptions === 'string') return fallbackOrOptions;
            return fallbackOrOptions?.defaultValue || key;
        },
    }),
}));

interface TestView {
    readonly filters: readonly unknown[];
    readonly id: string;
    readonly name: string;
    readonly sorts: readonly unknown[];
    readonly table_id: string;
    readonly type: string;
    readonly visibleProperties: string[];
}

type CloseHandler = (saved?: boolean, result?: unknown) => void;

interface CreateViewInput {
    readonly [key: string]: unknown;
    readonly id?: string | null;
    readonly name?: string | null;
}

let container: HTMLDivElement | undefined;
let root: Root | undefined;

export const existingView: TestView = {
    id: 'view-1',
    table_id: 'resources',
    name: 'Alphabetical',
    type: 'gallery',
    visibleProperties: ['title'],
    filters: [],
    sorts: [],
};

beforeAll(() => {
    const reactTestGlobal = globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
    };
    reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
    // Advance the autosave debounce explicitly instead of waiting on a busy CI host.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});

afterEach(async () => {
    if (root) {
        await act(async () => {
            root?.unmount();
            await Promise.resolve();
        });
    }
    document.body.replaceChildren();
    container = undefined;
    root = undefined;
    vi.useRealTimers();
    vi.clearAllMocks();
});

export const settle = async (): Promise<void> => {
    await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
        await Promise.resolve();
    });
};

const createApi = () => ({
        createVaultView: vi.fn((view: CreateViewInput) => Promise.resolve(
            { ...view, id: view.id || 'view-2' },
        )),
        deleteVaultView: vi.fn(() => Promise.resolve({ status: 'success' })),
        fetchAiModels: vi.fn(() => Promise.resolve({ models: [], budget: {}, configured_models: [], default: [],
            currency: { code: 'EUR', symbol: '€', source: 'fixture', fetched_at: '', usd_rate: 1 } })),
        fetchVaultPages: vi.fn(() => Promise.resolve([])),
        fetchVaultPagesByTable: vi.fn(() => Promise.resolve([])),
        fetchVaultSummarySettings: vi.fn(() => Promise.resolve({})),
        fetchVaultView: vi.fn<(viewId: string) => Promise<unknown>>((viewId) => Promise.resolve(
            viewId === existingView.id ? existingView : null,
        )),
        fetchVaultViews: vi.fn<() => Promise<unknown>>(() => Promise.resolve([existingView])),
        fetchVaultViewUsage: vi.fn(() => Promise.resolve({ count: 0, pages: [], view_id: 'view-1' })),
        updateVaultView: vi.fn((_viewId: string, _view: CreateViewInput) => Promise.resolve({ status: 'success' })),
        upsertPageView: vi.fn(() => Promise.resolve({ status: 'success' })),
});

export const renderModal = async (
    onClose: CloseHandler = vi.fn<CloseHandler>(),
    overrides: Partial<PageViewModalProps> = {},
    prepareApi?: (api: ReturnType<typeof createApi>) => void,
) => {
    const api = createApi();
    prepareApi?.(api);

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    const currentRoot = root;
    let props: PageViewModalProps = {
        isOpen: true, onClose, pageId: 'page-1', api,
        allTables: [{ id: 'resources', name: 'Resources', properties: [{ name: 'title', type: 'title' }] }],
        preselectedTableId: 'resources', editingBlock: { props: { view_id: 'view-1' } },
        ...overrides,
    };
    const rerender = async (patch: Partial<PageViewModalProps> = {}) => {
        props = { ...props, ...patch };
        await act(async () => {
            currentRoot.render(<MemoryRouter><PageViewModal {...props} /></MemoryRouter>);
            await Promise.resolve();
        });
        await settle();
        await settle();
    };
    await rerender();

    return { api, onClose, rerender };
};

export const requireContainer = (): HTMLDivElement => {
    if (!container) throw new Error('PageViewModal container is not mounted');
    return container;
};

export const requireElement = <T extends Element>(
    parent: ParentNode,
    selector: string,
    constructor: { new (): T },
): T => {
    const element = parent.querySelector(selector);
    if (!(element instanceof constructor)) {
        throw new Error(`Element not found: ${selector}`);
    }
    return element;
};

export const requireButton = (parent: ParentNode, label: string): HTMLButtonElement => {
    const button = Array.from(parent.querySelectorAll('button'))
        .find((candidate) => candidate.textContent.trim() === label);
    if (!(button instanceof HTMLButtonElement)) {
        throw new Error(`Button not found: ${label}`);
    }
    return button;
};

export const updateInput = (input: HTMLInputElement, value: string): void => {
    const didSetValue = Reflect.set(
        HTMLInputElement.prototype,
        'value',
        value,
        input,
    );
    if (!didSetValue) throw new Error('Native input value setter is unavailable');
    input.dispatchEvent(new Event('input', { bubbles: true }));
};

export const actAndFlush = async (action: () => void): Promise<void> => {
    await act(async () => {
        action();
        await Promise.resolve();
    });
};

