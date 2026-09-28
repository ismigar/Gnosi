import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import {
    actAndFlush, existingView, renderModal, requireButton, requireContainer,
    requireElement, settle, updateInput,
} from './PageViewModal.test-harness';

// Rendering the full modal can exceed five seconds on the shared CI machine.
describe('PageViewModal editing', { timeout: 15_000 }, () => {
    it('selects a source table for a new registry view opened without active table context', async () => {
        const { api, onClose } = await renderModal(undefined, {
            mode: 'table', preselectedTableId: '', editingBlock: null, editingView: { type: 'gallery' },
            allTables: [{ id: 'resources', name: 'Resources', properties: [
                { name: 'title', type: 'title' }, { name: 'Area', type: 'select', options: ['Research'] },
            ] }],
        });
        const modal = requireContainer();
        const source = requireElement(modal, 'select[aria-label="Source table"]', HTMLSelectElement);
        expect(source.disabled).toBe(false);
        expect(source.value).toBe('');
        await actAndFlush(() => { updateInput(requireElement(modal, 'input[placeholder="e.g. By area"]', HTMLInputElement), 'By area'); });
        await act(async () => { await vi.advanceTimersByTimeAsync(800); });
        expect(api.createVaultView).not.toHaveBeenCalled();
        await actAndFlush(() => { source.value = 'resources'; source.dispatchEvent(new Event('change', { bubbles: true })); });
        await settle();
        await actAndFlush(() => { requireButton(modal, 'Fields').click(); });
        expect(modal.textContent).toContain('Area');
        expect(modal.textContent).not.toContain('Select a table first in the General tab.');
        await actAndFlush(() => { requireButton(modal, 'Sort').click(); });
        expect(requireButton(modal, 'Add criterion').disabled).toBe(false);
        await actAndFlush(() => { requireButton(modal, 'Add criterion').click(); });
        expect(Array.from(modal.querySelectorAll('select option')).some(option => option.textContent === 'Area')).toBe(true);
        await actAndFlush(() => { requireButton(modal, 'Grouping').click(); });
        const group = requireElement(modal, 'select', HTMLSelectElement);
        expect(Array.from(group.options).some(option => option.value === 'Area')).toBe(true);
        await actAndFlush(() => { group.value = 'Area'; group.dispatchEvent(new Event('change', { bubbles: true })); });
        await actAndFlush(() => { requireButton(modal, 'Close').click(); });
        expect(api.createVaultView).toHaveBeenCalledWith(expect.objectContaining({ name: 'By area', table_id: 'resources', type: 'gallery', groupBy: 'Area' }));
        expect(onClose).toHaveBeenCalledWith(true, expect.objectContaining({ table_id: 'resources' }));
    });

    it('shows the fixed source table when configuring an existing registry view', async () => {
        await renderModal(undefined, { mode: 'table', editingView: { ...existingView }, editingBlock: null });
        const source = requireElement(requireContainer(), 'select[aria-label="Source table"]', HTMLSelectElement);
        expect(source.value).toBe('resources');
        expect(source.disabled).toBe(true);
    });

    it('can recover an unavailable preselected table by choosing a current source', async () => {
        await renderModal(undefined, { mode: 'table', editingView: null, editingBlock: null, preselectedTableId: 'removed-table' });
        expect(requireElement(requireContainer(), 'select[aria-label="Source table"]', HTMLSelectElement).disabled).toBe(false);
    });

    it.each(['gallery', 'table', 'feed'])('restores and saves the common height setting for a %s view', async type => {
        const view = { ...existingView, type, heightMode: 'limited', heightPercent: 45 };
        const { api } = await renderModal(undefined,
            { editingBlock: { props: { view_id: view.id }, view } }, prepared => {
                prepared.fetchVaultViews.mockResolvedValue([view]);
                prepared.fetchVaultView.mockResolvedValue(view);
            });
        const modal = requireContainer();
        expect(requireButton(modal, 'Limited').getAttribute('aria-pressed')).toBe('true');
        const height = requireElement(modal, 'input[type="number"][max="100"]', HTMLInputElement);
        expect(height.value).toBe('45');
        await actAndFlush(() => { updateInput(height, '85'); });
        await actAndFlush(() => { requireButton(modal, 'Fit content').click(); });
        expect(modal.querySelector('input[type="number"][max="100"]')).toBeNull();
        await actAndFlush(() => { requireButton(modal, 'Limited').click(); });
        expect(requireElement(modal, 'input[type="number"][max="100"]', HTMLInputElement).value).toBe('85');
        await actAndFlush(() => { requireButton(modal, 'Insert').click(); });
        expect(api.createVaultView).toHaveBeenCalledWith(expect.objectContaining({
            id: view.id, type, heightMode: 'limited', heightPercent: 85,
        }));
    });

    it('autosaves the chosen height percentage and restores it on reopening', async () => {
        const view = { ...existingView, heightMode: 'limited' };
        const { api, rerender } = await renderModal(undefined, { mode: 'table', editingView: view, editingBlock: null });
        const height = requireElement(requireContainer(), 'input[type="number"][max="100"]', HTMLInputElement);
        expect(height.value).toBe('70');
        await actAndFlush(() => { updateInput(height, '55'); });
        await act(async () => { await vi.advanceTimersByTimeAsync(800); });
        expect(api.updateVaultView).toHaveBeenLastCalledWith(view.id, expect.objectContaining({ heightPercent: 55 }));
        await rerender({ isOpen: false });
        await rerender({ isOpen: true, editingView: { ...view, heightPercent: 55 } });
        expect(requireElement(requireContainer(), 'input[type="number"][max="100"]', HTMLInputElement).value).toBe('55');
    });

    it('opens with the displayed view configuration and persists full-width reading without losing filters', async () => {
        const view = { ...existingView, name: 'Notes by source', cardSize: 'large', galleryPreview: 'content',
            groupBy: 'Note type', filters: [{ field: 'Source', operator: 'equals', value: 'this' }],
            sorts: [{ field: 'Position', direction: 'asc' }] };
        const { api, rerender } = await renderModal(undefined,
            { isOpen: false, preselectedTableId: '', editingBlock: null });
        api.fetchVaultView.mockRejectedValue(new Error('Network unavailable'));
        await rerender({ isOpen: true, preselectedTableId: 'resources',
            editingBlock: { props: { view_id: view.id }, view } });
        const modal = requireContainer();
        expect(requireElement(modal, 'input[placeholder="e.g. By area"]', HTMLInputElement).value).toBe(view.name);
        expect(requireButton(modal, 'Large').getAttribute('aria-pressed')).toBe('true');
        expect(api.fetchVaultView).not.toHaveBeenCalled();
        await actAndFlush(() => { requireButton(modal, 'Sort').click(); });
        const position = requireElement(modal, 'select option[value="Position"]', HTMLOptionElement);
        expect(position.selected).toBe(true);
        await actAndFlush(() => { requireButton(modal, 'General').click(); });
        await actAndFlush(() => { requireButton(modal, 'Full width').click(); });
        await actAndFlush(() => { requireButton(modal, 'Insert').click(); });
        expect(api.createVaultView).toHaveBeenCalledWith(expect.objectContaining({
            id: view.id, name: view.name, type: 'gallery', cardSize: 'full', galleryPreview: 'content',
            groupBy: 'Note type', filters: view.filters, sorts: view.sorts,
        }));
    });

    it('keeps the edited view and user changes when the catalog arrives later', async () => {
        let resolveCatalog: ((views: unknown) => void) | undefined;
        const pendingCatalog = new Promise<unknown>((resolve) => { resolveCatalog = resolve; });
        await renderModal(undefined, { editingBlock: { props: { view_id: existingView.id }, view: existingView } },
            (api) => { api.fetchVaultViews.mockReturnValue(pendingCatalog); });
        const modal = requireContainer();
        const name = requireElement(modal, 'input[placeholder="e.g. By area"]', HTMLInputElement);
        await actAndFlush(() => { updateInput(name, 'My updated view'); });
        await actAndFlush(() => { resolveCatalog?.([{ ...existingView, name: 'Old catalog name' }]); });
        expect(name.value).toBe('My updated view');
        expect(requireElement(modal, 'select', HTMLSelectElement).value).toBe(existingView.id);
    });

    it('reports a failed lookup, prevents saving defaults, and reloads the same view on retry', async () => {
        const { api } = await renderModal(undefined, {}, (prepared) => {
            prepared.fetchVaultView.mockRejectedValueOnce(new Error('Network unavailable'));
        });
        const modal = requireContainer();
        expect(modal.textContent).toContain("Couldn't load this view's settings. Try again.");
        expect(modal.querySelector('input[placeholder="e.g. By area"]')).toBeNull();
        expect(requireButton(modal, 'Insert').disabled).toBe(true);
        expect(api.updateVaultView).not.toHaveBeenCalled();
        expect(api.createVaultView).not.toHaveBeenCalled();
        await actAndFlush(() => { requireButton(modal, 'Retry').click(); });
        await settle();
        expect(api.fetchVaultView).toHaveBeenLastCalledWith(existingView.id);
        expect(requireElement(modal, 'input[placeholder="e.g. By area"]', HTMLInputElement).value).toBe(existingView.name);
        expect(requireButton(modal, 'Insert').disabled).toBe(false);
    });

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
        await act(async () => { await vi.advanceTimersByTimeAsync(800); });
        expect(api.createVaultView).toHaveBeenCalledTimes(1);
        expect(api.upsertPageView).not.toHaveBeenCalled();
        await actAndFlush(() => { updateInput(input, 'Latest table'); });
        await act(async () => { await vi.advanceTimersByTimeAsync(800); });
        expect(api.createVaultView).toHaveBeenCalledTimes(1);
        expect(api.updateVaultView).toHaveBeenCalledWith('view-2', expect.objectContaining({ name: 'Latest table' }));
        await actAndFlush(() => { updateInput(input, 'Final table'); });
        // Closing before the next debounce must still flush the final edit.
        await actAndFlush(() => { requireButton(modal, 'Close').click(); });
        expect(api.updateVaultView).toHaveBeenLastCalledWith('view-2', expect.objectContaining({ name: 'Final table' }));
        expect(onClose).toHaveBeenCalledWith(true, expect.objectContaining({ id: 'view-2', name: 'Final table' }));
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
