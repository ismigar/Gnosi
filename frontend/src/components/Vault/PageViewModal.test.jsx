import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { PageViewModal } from './PageViewModal';

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key, fallbackOrOptions) => {
            if (typeof fallbackOrOptions === 'string') return fallbackOrOptions;
            return fallbackOrOptions?.defaultValue || key;
        },
    }),
}));

let container;
let root;

const existingView = {
    id: 'view-1',
    table_id: 'resources',
    name: 'Alphabetical',
    type: 'gallery',
    visibleProperties: ['title'],
    filters: [],
    sorts: [],
};

beforeAll(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
    if (root) await act(async () => root.unmount());
    document.body.replaceChildren();
    container = null;
    root = null;
    vi.clearAllMocks();
});

async function settle() {
    await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 0));
        await Promise.resolve();
    });
}

async function renderModal(onClose = vi.fn()) {
    const api = {
        createVaultView: vi.fn(async view => ({ ...view, id: view.id || 'view-2' })),
        deleteVaultView: vi.fn(async () => ({ status: 'success' })),
        fetchAiModels: vi.fn(async () => ({ models: [] })),
        fetchVaultPages: vi.fn(async () => []),
        fetchVaultPagesByTable: vi.fn(async () => []),
        fetchVaultSummarySettings: vi.fn(async () => ({})),
        fetchVaultView: vi.fn(async viewId => (
            viewId === existingView.id ? existingView : null
        )),
        fetchVaultViews: vi.fn(async () => [existingView]),
        fetchVaultViewUsage: vi.fn(async () => ({ count: 0, pages: [] })),
        updateVaultView: vi.fn(async () => ({ status: 'success' })),
        upsertPageView: vi.fn(async () => ({ status: 'success' })),
    };

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root.render(
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
        />,
    ));
    await settle();
    await settle();

    return { api, onClose };
}

function updateInput(input, value) {
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    valueSetter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('PageViewModal editing', () => {
    it('mirrors a renamed view in the existing-view picker while typing and after blur', async () => {
        await renderModal();
        const picker = container.querySelector('select');
        const nameInput = container.querySelector('input[placeholder="e.g. By area"]');

        expect(picker.value).toBe('view-1');
        expect(picker.selectedOptions[0].textContent).toContain('Alphabetical');

        await act(async () => updateInput(nameInput, 'Research'));
        expect(picker.selectedOptions[0].textContent).toContain('Research');

        await act(async () => nameInput.blur());
        expect(picker.selectedOptions[0].textContent).toContain('Research');
    });

    it('asks before Cancel discards edits and closes without saving after confirmation', async () => {
        const onClose = vi.fn();
        const { api } = await renderModal(onClose);
        const nameInput = container.querySelector('input[placeholder="e.g. By area"]');

        await act(async () => updateInput(nameInput, 'Research'));
        const cancelButton = [...container.querySelectorAll('button')]
            .find(button => button.textContent.trim() === 'Cancel');
        await act(async () => cancelButton.click());

        expect(onClose).not.toHaveBeenCalled();
        expect(document.body.textContent).toContain('Discard changes?');

        const discardButton = [...document.body.querySelectorAll('button')]
            .find(button => button.textContent.trim() === 'Discard changes');
        await act(async () => discardButton.click());

        expect(onClose).toHaveBeenCalledWith(false);
        expect(api.createVaultView).not.toHaveBeenCalled();
        expect(api.updateVaultView).not.toHaveBeenCalled();
    });

    it('lets the close button discard an unchanged form without a warning', async () => {
        const onClose = vi.fn();
        await renderModal(onClose);
        const closeButton = container.querySelector('button[aria-label="Close"]');

        await act(async () => closeButton.click());

        expect(onClose).toHaveBeenCalledWith(false);
        expect(document.body.textContent).not.toContain('Discard changes?');
    });

    it('uses the same guarded discard flow from the close button', async () => {
        const onClose = vi.fn();
        await renderModal(onClose);
        const nameInput = container.querySelector('input[placeholder="e.g. By area"]');
        await act(async () => updateInput(nameInput, 'Research'));

        const closeButton = container.querySelector('button[aria-label="Close"]');
        await act(async () => closeButton.click());

        expect(onClose).not.toHaveBeenCalled();
        expect(document.body.textContent).toContain('Discard changes?');
    });

    it('persists the renamed existing view when Insert is confirmed', async () => {
        const onClose = vi.fn();
        const { api } = await renderModal(onClose);
        const nameInput = container.querySelector('input[placeholder="e.g. By area"]');
        await act(async () => updateInput(nameInput, 'Research'));

        const insertButton = [...container.querySelectorAll('button')]
            .find(button => button.textContent.trim() === 'Insert');
        await act(async () => insertButton.click());
        await settle();

        const createCall = api.createVaultView.mock.calls.find(([view]) => (
            view.name === 'Research'
        ));
        expect(createCall?.[0].name).toBe('Research');
        expect(onClose).toHaveBeenCalledWith(true, expect.any(Object));
    });
});
