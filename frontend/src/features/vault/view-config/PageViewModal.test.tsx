import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

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
    readonly visibleProperties: readonly string[];
}

type CloseHandler = (saved?: boolean, result?: unknown) => void;

interface CreateViewInput {
    readonly [key: string]: unknown;
    readonly id?: string | null;
    readonly name?: string | null;
}

let container: HTMLDivElement | undefined;
let root: Root | undefined;

const existingView: TestView = {
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
    vi.clearAllMocks();
});

const settle = async (): Promise<void> => {
    await act(async () => {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        await Promise.resolve();
    });
};

const renderModal = async (
    onClose: CloseHandler = vi.fn<CloseHandler>(),
    overrides: Partial<PageViewModalProps> = {},
) => {
    const api = {
        createVaultView: vi.fn((view: CreateViewInput) => Promise.resolve(
            { ...view, id: view.id || 'view-2' },
        )),
        deleteVaultView: vi.fn(() => Promise.resolve({ status: 'success' })),
        fetchAiModels: vi.fn(() => Promise.resolve({ models: [], budget: {}, configured_models: [], default: [],
            currency: { code: 'EUR', symbol: '€', source: 'fixture', fetched_at: '', usd_rate: 1 } })),
        fetchVaultPages: vi.fn(() => Promise.resolve([])),
        fetchVaultPagesByTable: vi.fn(() => Promise.resolve([])),
        fetchVaultSummarySettings: vi.fn(() => Promise.resolve({})),
        fetchVaultView: vi.fn((viewId: string) => Promise.resolve(
            viewId === existingView.id ? existingView : null,
        )),
        fetchVaultViews: vi.fn(() => Promise.resolve([existingView])),
        fetchVaultViewUsage: vi.fn(() => Promise.resolve({ count: 0, pages: [], view_id: 'view-1' })),
        updateVaultView: vi.fn((_viewId: string, _view: CreateViewInput) => Promise.resolve({ status: 'success' })),
        upsertPageView: vi.fn(() => Promise.resolve({ status: 'success' })),
    };

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    const currentRoot = root;
    await act(async () => {
        currentRoot.render(
            <PageViewModal
                isOpen
                onClose={onClose}
                pageId="page-1"
                allTables={[{
                    id: 'resources',
                    name: 'Resources',
                    properties: [{ name: 'title', type: 'title' }],
                }]}
                api={api}
                preselectedTableId="resources"
                editingBlock={{ props: { view_id: 'view-1' } }}
                {...overrides}
            />,
        );
        await Promise.resolve();
    });
    await settle();
    await settle();

    return { api, onClose };
};

const requireContainer = (): HTMLDivElement => {
    if (!container) throw new Error('PageViewModal container is not mounted');
    return container;
};

const requireElement = <T extends Element>(
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

const requireButton = (parent: ParentNode, label: string): HTMLButtonElement => {
    const button = Array.from(parent.querySelectorAll('button'))
        .find((candidate) => candidate.textContent.trim() === label);
    if (!(button instanceof HTMLButtonElement)) {
        throw new Error(`Button not found: ${label}`);
    }
    return button;
};

const updateInput = (input: HTMLInputElement, value: string): void => {
    const didSetValue = Reflect.set(
        HTMLInputElement.prototype,
        'value',
        value,
        input,
    );
    if (!didSetValue) throw new Error('Native input value setter is unavailable');
    input.dispatchEvent(new Event('input', { bubbles: true }));
};

const actAndFlush = async (action: () => void): Promise<void> => {
    await act(async () => {
        action();
        await Promise.resolve();
    });
};

describe('PageViewModal editing', () => {
    it('mirrors a renamed view in the existing-view picker while typing and after blur', async () => {
        await renderModal();
        const modal = requireContainer();
        const picker = requireElement(modal, 'select', HTMLSelectElement);
        const nameInput = requireElement(
            modal,
            'input[placeholder="e.g. By area"]',
            HTMLInputElement,
        );

        expect(picker.value).toBe('view-1');
        expect(picker.selectedOptions.item(0)?.textContent).toContain('Alphabetical');

        await actAndFlush(() => {
            updateInput(nameInput, 'Research');
        });
        expect(picker.selectedOptions.item(0)?.textContent).toContain('Research');

        await actAndFlush(() => {
            nameInput.blur();
        });
        expect(picker.selectedOptions.item(0)?.textContent).toContain('Research');
    });

    it('asks before Cancel discards edits and closes without saving after confirmation', async () => {
        const onClose = vi.fn();
        const { api } = await renderModal(onClose);
        const modal = requireContainer();
        const nameInput = requireElement(
            modal,
            'input[placeholder="e.g. By area"]',
            HTMLInputElement,
        );

        await actAndFlush(() => {
            updateInput(nameInput, 'Research');
        });
        const cancelButton = requireButton(modal, 'Cancel');
        await actAndFlush(() => {
            cancelButton.click();
        });

        expect(onClose).not.toHaveBeenCalled();
        expect(document.body.textContent).toContain('Discard changes?');

        const discardButton = requireButton(document.body, 'Discard changes');
        await actAndFlush(() => {
            discardButton.click();
        });

        expect(onClose).toHaveBeenCalledWith(false);
        expect(api.createVaultView).not.toHaveBeenCalled();
        expect(api.updateVaultView).not.toHaveBeenCalled();
    });

    it('lets the close button discard an unchanged form without a warning', async () => {
        const onClose = vi.fn();
        await renderModal(onClose);
        const closeButton = requireElement(
            requireContainer(),
            'button[aria-label="Close"]',
            HTMLButtonElement,
        );

        await actAndFlush(() => {
            closeButton.click();
        });

        expect(onClose).toHaveBeenCalledWith(false);
        expect(document.body.textContent).not.toContain('Discard changes?');
    });

    it('uses the same guarded discard flow from the close button', async () => {
        const onClose = vi.fn();
        await renderModal(onClose);
        const modal = requireContainer();
        const nameInput = requireElement(
            modal,
            'input[placeholder="e.g. By area"]',
            HTMLInputElement,
        );
        await actAndFlush(() => {
            updateInput(nameInput, 'Research');
        });

        const closeButton = requireElement(
            modal,
            'button[aria-label="Close"]',
            HTMLButtonElement,
        );
        await actAndFlush(() => {
            closeButton.click();
        });

        expect(onClose).not.toHaveBeenCalled();
        expect(document.body.textContent).toContain('Discard changes?');
    });

    it('persists the renamed existing view when Insert is confirmed', async () => {
        const onClose = vi.fn();
        const { api } = await renderModal(onClose);
        const modal = requireContainer();
        const nameInput = requireElement(
            modal,
            'input[placeholder="e.g. By area"]',
            HTMLInputElement,
        );
        await actAndFlush(() => {
            updateInput(nameInput, 'Research');
        });

        const insertButton = requireButton(modal, 'Insert');
        await actAndFlush(() => {
            insertButton.click();
        });
        await settle();

        const createCall = api.createVaultView.mock.calls.find(([view]) => (
            view.name === 'Research'
        ));
        expect(createCall?.[0].name).toBe('Research');
        expect(onClose).toHaveBeenCalledWith(true, expect.any(Object));
    });

    it('creates once during table autosave, updates the same id and flushes before closing', async () => {
        const onClose = vi.fn();
        const { api } = await renderModal(onClose, { mode: 'table', editingView: null, editingBlock: null });
        const modal = requireContainer();
        const input = requireElement(modal, 'input[placeholder="e.g. By area"]', HTMLInputElement);
        await actAndFlush(() => { updateInput(input, 'Saved table'); });
        await act(async () => { await new Promise(resolve => setTimeout(resolve, 850)); });
        expect(api.createVaultView).toHaveBeenCalledTimes(1);
        expect(api.upsertPageView).not.toHaveBeenCalled();
        await actAndFlush(() => { updateInput(input, 'Latest table'); });
        await act(async () => { await new Promise(resolve => setTimeout(resolve, 850)); });
        expect(api.createVaultView).toHaveBeenCalledTimes(1);
        expect(api.updateVaultView).toHaveBeenCalledWith('view-2', expect.objectContaining({ name: 'Latest table' }));
        await actAndFlush(() => { requireButton(modal, 'Close').click(); });
        expect(onClose).toHaveBeenCalledWith(true, expect.objectContaining({ id: 'view-2', name: 'Latest table' }));
    });

    it('reports a save error without closing and permits retry', async () => {
        const onClose = vi.fn();
        const { api } = await renderModal(onClose);
        const modal = requireContainer();
        const input = requireElement(modal, 'input[placeholder="e.g. By area"]', HTMLInputElement);
        await actAndFlush(() => { updateInput(input, 'Retry view'); });
        api.createVaultView.mockRejectedValueOnce(new Error('Synthetic write failure'));
        await actAndFlush(() => { requireButton(modal, 'Insert').click(); });
        expect(onClose).not.toHaveBeenCalled();
        expect(modal.textContent).toContain('Synthetic write failure');
        await actAndFlush(() => { requireButton(modal, 'Insert').click(); });
        expect(onClose).toHaveBeenCalledWith(true, expect.objectContaining({ view_id: 'view-1' }));
    });

    it('validates the source before creating an embedded section', async () => {
        const { api, onClose } = await renderModal(undefined, { preselectedTableId: '', editingBlock: null });
        await actAndFlush(() => { requireButton(requireContainer(), 'Create view').click(); });
        expect(requireContainer().textContent).toContain('You must select a source table');
        expect(api.upsertPageView).not.toHaveBeenCalled();
        expect(onClose).not.toHaveBeenCalled();
    });

    it('guards keyboard Escape exactly like the Cancel action', async () => {
        const onClose = vi.fn();
        await renderModal(onClose);
        const input = requireElement(requireContainer(), 'input[placeholder="e.g. By area"]', HTMLInputElement);
        await actAndFlush(() => { updateInput(input, 'Changed by keyboard'); });
        await actAndFlush(() => {
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        });
        expect(document.body.textContent).toContain('Discard changes?');
        expect(onClose).not.toHaveBeenCalled();
    });

    it('persists joined columns in their composite format without duplicating the base title', async () => {
        const { api } = await renderModal(undefined, { editingBlock: null, allTables: [
            { id: 'resources', name: 'Resources', properties: [{ name: 'title', type: 'title' }] },
            { id: 'authors', name: 'Authors', properties: [{ name: 'Country', type: 'text' }] },
        ] });
        const modal = requireContainer();
        await actAndFlush(() => { requireButton(modal, 'Add table (join)').click(); });
        await actAndFlush(() => { requireButton(modal, 'Fields').click(); });
        const country = Array.from(modal.querySelectorAll('label')).find(label => label.textContent.includes('Country'));
        if (!country) throw new Error('Joined Country field is missing');
        const checkbox = requireElement(country, 'input[type="checkbox"]', HTMLInputElement);
        await actAndFlush(() => { checkbox.click(); });
        await actAndFlush(() => { requireButton(modal, 'Create view').click(); });
        expect(api.upsertPageView).toHaveBeenCalledWith('page-1', expect.objectContaining({
            visible_properties: [{ tableId: 'resources', fieldKey: 'title' }, { tableId: 'authors', fieldKey: 'Country' }],
            joins: [{ tableId: 'authors', type: 'inner', leftField: 'title', rightField: 'id' }],
        }));
    });
});
