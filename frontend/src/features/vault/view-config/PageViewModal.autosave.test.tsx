import { act } from 'react';
import { GnosiApiError } from '../../../shared/api/errors';
import { describe, expect, it, vi } from 'vitest';
import { actAndFlush, existingView, renderModal, requireButton, requireElement, updateInput } from './PageViewModal.test-harness';

const dialog = () => requireElement(document.body, '[role="dialog"][aria-labelledby="page-view-modal-title"]', HTMLDivElement);
const advance = async () => { await act(async () => { await vi.advanceTimersByTimeAsync(800); }); };
const changeDirection = async () => {
    await actAndFlush(() => { requireButton(dialog(), 'Sort').click(); });
    const direction = requireElement(dialog(), 'select:has(option[value="desc"])', HTMLSelectElement);
    await actAndFlush(() => { direction.value = 'desc'; direction.dispatchEvent(new Event('change', { bubbles: true })); });
};

describe('embedded view autosave', () => {
    it('offers only Close and saves a changed sort without closing', async () => {
        const onSave = vi.fn();
        const view = { ...existingView, sorts: [{ field: 'title', direction: 'asc' }] };
        const { api, onClose } = await renderModal(undefined, { editingBlock: { props: { view_id: view.id }, view }, onSave });
        expect(dialog().textContent).not.toContain('Insert');
        expect(dialog().textContent).not.toContain('Cancel');
        await changeDirection();
        await advance();
        expect(api.updateVaultView).toHaveBeenLastCalledWith(view.id, expect.objectContaining({ sorts: [{ field: 'title', direction: 'desc' }] }));
        expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ view_id: view.id, sorts: [{ field: 'title', direction: 'desc' }] }));
        expect(onClose).not.toHaveBeenCalled();
        const direction = requireElement(dialog(), 'select:has(option[value="asc"])', HTMLSelectElement);
        await actAndFlush(() => { direction.value = 'asc'; direction.dispatchEvent(new Event('change', { bubbles: true })); });
        await advance();
        expect(api.updateVaultView).toHaveBeenLastCalledWith(view.id, expect.objectContaining({ sorts: [{ field: 'title', direction: 'asc' }] }));
    });

    it('saves a main-view customization in a separate view that survives reopening', async () => {
        const main = { ...existingView, type: 'table', is_main: true, locked: true, columnWidths: { title: 240 }, name: 'Resources', sorts: [{ field: 'title', direction: 'asc' }] };
        const { api, onClose, rerender } = await renderModal(undefined, { editingBlock: { props: { view_id: main.id }, view: main } }, prepared => {
            prepared.fetchVaultViews.mockResolvedValue([main]);
        });
        await changeDirection();
        await actAndFlush(() => { requireButton(dialog(), 'Close').click(); });
        const created = api.createVaultView.mock.calls[0]?.[0];
        expect(created).toMatchObject({ embedded: true, hidden: true, columnWidths: { title: 240 }, sorts: [{ field: 'title', direction: 'desc' }] });
        expect(created?.is_main).not.toBe(true);
        expect(created?.locked).not.toBe(true);
        expect(created?.id).not.toBe(main.id);
        const id = String(created?.id);
        expect(api.updateVaultView).not.toHaveBeenCalledWith(main.id, expect.anything());
        expect(onClose).toHaveBeenCalledWith(true, expect.objectContaining({ view_id: id }));
        await rerender({ isOpen: false });
        await rerender({ isOpen: true, editingBlock: { props: { view_id: id }, view: { ...created, id: id } } });
        await actAndFlush(() => { requireButton(dialog(), 'Sort').click(); });
        expect(requireElement(dialog(), 'select:has(option[value="desc"])', HTMLSelectElement).value).toBe('desc');
    });

    it.each([false, true])('protects an unmarked displayed section (catalog delayed: %s)', async delayed => {
        const displayed = { ...existingView, name: 'Articles', sorts: [{ field: 'title', direction: 'asc' }] };
        const main = { ...displayed, is_main: true };
        const { api, onClose } = await renderModal(undefined, { editingBlock: { props: { view_id: main.id }, view: displayed } }, prepared => {
            prepared.fetchVaultViews.mockImplementation(() => delayed ? new Promise(() => {}) : Promise.resolve([main]));
            prepared.fetchVaultView.mockResolvedValue(main);
        });
        await changeDirection();
        await actAndFlush(() => { requireButton(dialog(), 'Close').click(); });
        expect(api.updateVaultView).not.toHaveBeenCalled();
        expect(api.createVaultView).toHaveBeenCalledWith(expect.objectContaining({ hidden: true, sorts: [{ field: 'title', direction: 'desc' }] }));
        expect(onClose).toHaveBeenCalledWith(true, expect.objectContaining({ view_id: api.createVaultView.mock.calls[0]?.[0].id }));
    });

    it('keeps the catalog name and settings when opening from a partial page section', async () => {
        const view = { ...existingView, name: 'Named reports', type: 'table', sorts: [{ field: 'title', direction: 'asc' }], rowHeight: 'tall' };
        const section = { id: view.id, view_id: view.id, source_table_id: view.table_id, heading: 'Local heading', view_type: 'table' };
        const { api } = await renderModal(undefined, { editingBlock: { props: { view_id: view.id }, view: section } }, prepared => {
            prepared.fetchVaultView.mockResolvedValue(view);
            prepared.fetchVaultViews.mockResolvedValue([view]);
        });
        expect(requireElement(dialog(), 'input[aria-label="View name"]', HTMLInputElement).value).toBe(view.name);
        await changeDirection();
        await advance();
        expect(api.updateVaultView).toHaveBeenLastCalledWith(view.id, expect.objectContaining({ name: view.name, rowHeight: 'tall' }));
    });

    it('keeps a legacy shared view editable when renamed to a translated main-view label', async () => {
        const view = { ...existingView, type: 'table', sorts: [{ field: 'title', direction: 'asc' }] };
        const { api, onClose } = await renderModal(undefined, { editingBlock: { props: { view_id: view.id }, view } });
        await actAndFlush(() => { updateInput(requireElement(dialog(), 'input[aria-label="View name"]', HTMLInputElement), 'Taula principal'); });
        await changeDirection();
        await actAndFlush(() => { requireButton(dialog(), 'Close').click(); });
        const expected = { name: 'Taula principal', sorts: [{ field: 'title', direction: 'desc' }] };
        expect(api.updateVaultView).toHaveBeenCalledWith(view.id, expect.objectContaining({ ...expected, is_main: false, embedded: false }));
        expect(onClose).toHaveBeenCalledWith(true, expect.objectContaining({ ...expected, view_id: view.id }));
        expect(api.createVaultView).not.toHaveBeenCalled();
    });

    it.each([404, 503])('opens a working page section when its registry lookup returns %s', async status => {
        const view = { ...existingView, type: 'table', sorts: [{ field: 'title', direction: 'asc' }] };
        const section = { view_id: view.id, source_table_id: view.table_id, name: 'Page reports', view_type: 'table', sorts: view.sorts,
            columnWidths: { title: 412, Date: 180 }, enableSubitems: true, extensionOptions: { compact: true } };
        const { api, onClose } = await renderModal(undefined, { editingBlock: { props: { view_id: view.id }, view: section } }, prepared => {
            prepared.fetchVaultView.mockRejectedValue(new GnosiApiError(new Response(null, { status }), {}));
            prepared.fetchVaultViews.mockResolvedValue(status === 404 ? [] : [view]);
        });
        expect(requireElement(dialog(), 'input[aria-label="View name"]', HTMLInputElement).value).toBe(status === 404 ? section.name : view.name);
        await advance();
        expect(api.upsertPageView).not.toHaveBeenCalled();
        await changeDirection();
        await actAndFlush(() => { requireButton(dialog(), 'Close').click(); });
        expect(onClose).toHaveBeenCalledWith(true, expect.objectContaining({ view_id: status === 404 ? null : view.id,
            sorts: [{ field: 'title', direction: 'desc' }] }));
        expect(api.createVaultView).not.toHaveBeenCalled();
        if (status === 404) {
            const expected = { columnWidths: section.columnWidths, enableSubitems: true, extensionOptions: section.extensionOptions };
            expect(onClose).toHaveBeenCalledWith(true, expect.objectContaining(expected));
            expect(api.upsertPageView).toHaveBeenCalledWith('page-1', expect.objectContaining(expected));
        }
    });

    it('preserves layout settings when saving an inline view to its table', async () => {
        const layout = { columnWidths: { title: 412, Date: 180 }, enableSubitems: true, extensionOptions: { compact: true } };
        const section = { ...layout, source_table_id: 'resources', view_type: 'table', heading: 'Taula principal',
            visible_properties: ['title', 'Date'], sorts: [{ field: 'title', direction: 'asc' }] };
        const { api, onClose } = await renderModal(undefined, { editingBlock: { props: { section: JSON.stringify(section) } } });
        const checkbox = [...dialog().querySelectorAll('label')].find(label => label.textContent.includes("Also save to the table's views"))?.querySelector('input');
        expect(checkbox?.checked).toBe(false);
        await actAndFlush(() => { checkbox?.click(); });
        await changeDirection();
        await actAndFlush(() => { requireButton(dialog(), 'Close').click(); });
        const expected = { ...layout, sorts: [{ field: 'title', direction: 'desc' }] };
        expect(api.createVaultView).toHaveBeenCalledOnce();
        const created = api.createVaultView.mock.calls[0]?.[0];
        expect(created).toMatchObject({ ...expected, name: 'Taula principal', is_main: false, embedded: false, hidden: false });
        for (const field of ['view_id', 'section_id', 'source_table_id', 'heading']) expect(created).not.toHaveProperty(field);
        expect(api.upsertPageView).toHaveBeenCalledWith('page-1', expect.objectContaining({ ...expected, view_id: created?.id }));
        expect(onClose).toHaveBeenCalledWith(true, expect.objectContaining(expected));
    });

    it('creates a new embed once, autosaves subsequent edits to the same view, and flushes Close', async () => {
        const onSave = vi.fn();
        const { api, onClose } = await renderModal(undefined, { editingBlock: null, onSave });
        await advance();
        expect(api.createVaultView).not.toHaveBeenCalled();
        const initialName = requireElement(dialog(), 'input[aria-label="View name"]', HTMLInputElement);
        await actAndFlush(() => { updateInput(initialName, 'First draft'); });
        await advance();
        expect(api.createVaultView).toHaveBeenCalledTimes(1);
        expect(onSave).toHaveBeenCalledTimes(1);
        const name = requireElement(dialog(), 'input[aria-label="View name"]', HTMLInputElement);
        await actAndFlush(() => { updateInput(name, 'Newest'); });
        await actAndFlush(() => { requireButton(dialog(), 'Close').click(); });
        expect(api.createVaultView).toHaveBeenCalledTimes(1);
        const id = api.createVaultView.mock.calls[0]?.[0].id;
        expect(api.updateVaultView).toHaveBeenLastCalledWith(id, expect.objectContaining({ name: 'Newest' }));
        expect(onClose).toHaveBeenCalledWith(true, expect.objectContaining({ view_id: api.createVaultView.mock.calls[0]?.[0].id }));
        await advance();
        expect(api.updateVaultView).toHaveBeenCalledTimes(1);
    });

    it('accepts a preselected table on Close and retries a failed page write without creating twice', async () => {
        const { api, onClose } = await renderModal(undefined, { editingBlock: null }, prepared => {
            prepared.upsertPageView.mockRejectedValueOnce(new Error('Page write failed'));
        });
        await actAndFlush(() => { requireButton(dialog(), 'Close').click(); });
        expect(dialog().textContent).toContain('Page write failed');
        expect(onClose).not.toHaveBeenCalled();
        await actAndFlush(() => { requireButton(dialog(), 'Close').click(); });
        expect(api.createVaultView).toHaveBeenCalledOnce();
        expect(onClose).toHaveBeenCalledWith(true, expect.objectContaining({ view_id: api.createVaultView.mock.calls[0]?.[0].id }));
    });

    it('keeps one catalog identity when table visibility is toggled off and on', async () => {
        const { api } = await renderModal(undefined, { editingBlock: null });
        await actAndFlush(() => { updateInput(requireElement(dialog(), 'input[aria-label="View name"]', HTMLInputElement), 'Reports'); });
        await advance();
        const checkbox = [...dialog().querySelectorAll('label')].find(label => label.textContent.includes("Also save to the table's views"))?.querySelector('input');
        expect(checkbox).toBeTruthy();
        await actAndFlush(() => { checkbox?.click(); });
        await advance();
        const id = api.createVaultView.mock.calls[0]?.[0].id;
        expect(api.updateVaultView).toHaveBeenLastCalledWith(id, expect.objectContaining({ embedded: true, hidden: true }));
        await actAndFlush(() => { checkbox?.click(); });
        await advance();
        expect(api.createVaultView).toHaveBeenCalledOnce();
        expect(api.updateVaultView).toHaveBeenLastCalledWith(id, expect.objectContaining({ embedded: false, hidden: false }));
    });

    it('preserves saved fields while loading a sample of a table without a schema', async () => {
        const view = { ...existingView, visibleProperties: ['title', 'Date', 'Author'] };
        const { api, onClose } = await renderModal(undefined, { editingBlock: { props: { view_id: view.id }, view },
            allTables: [{ id: 'resources', name: 'Resources', properties: [] }] }, prepared => {
            prepared.fetchVaultPages.mockImplementation(() => Promise.resolve([{ metadata: { Date: '2026-01-01' } }]));
        });
        await advance();
        await actAndFlush(() => { requireButton(dialog(), 'Close').click(); });
        expect(api.updateVaultView).not.toHaveBeenCalled();
        expect(api.upsertPageView).not.toHaveBeenCalled();
        expect(onClose).toHaveBeenCalledWith(false);
    });

    it.each(['registry response', 'page write'])('restores the original sort after a failed %s', async failure => {
        const view = { ...existingView, sorts: [{ field: 'title', direction: 'asc' }] };
        const { api, onClose } = await renderModal(undefined, { editingBlock: { props: { view_id: view.id }, view } }, prepared => {
            if (failure === 'registry response') prepared.updateVaultView.mockRejectedValueOnce(new Error('Connection lost'));
            else prepared.upsertPageView.mockRejectedValueOnce(new Error('Page write failed'));
        });
        await changeDirection();
        await advance();
        const direction = requireElement(dialog(), 'select:has(option[value="asc"])', HTMLSelectElement);
        await actAndFlush(() => { direction.value = 'asc'; direction.dispatchEvent(new Event('change', { bubbles: true })); });
        await actAndFlush(() => { requireButton(dialog(), 'Close').click(); });
        expect(api.updateVaultView).toHaveBeenCalledTimes(2);
        expect(api.updateVaultView).toHaveBeenLastCalledWith(view.id, expect.objectContaining({ sorts: view.sorts }));
        expect(onClose).toHaveBeenCalledWith(true, expect.objectContaining({ sorts: view.sorts }));
    });

    it('does not report a failed save as saved and retries on Close', async () => {
        const onSave = vi.fn();
        const { onClose } = await renderModal(undefined, { onSave }, prepared => {
            prepared.updateVaultView.mockRejectedValueOnce(new Error('Write failed'));
        });
        const name = requireElement(dialog(), 'input[aria-label="View name"]', HTMLInputElement);
        await actAndFlush(() => { updateInput(name, 'Retry me'); });
        await advance();
        expect(onSave).not.toHaveBeenCalled();
        expect(dialog().textContent).not.toContain('All changes saved');
        expect(dialog().textContent).toContain('Write failed');
        expect(onClose).not.toHaveBeenCalled();
        await actAndFlush(() => { requireButton(dialog(), 'Close').click(); });
        expect(onSave).toHaveBeenCalledOnce();
        expect(onClose).toHaveBeenCalledWith(true, expect.anything());
    });

    it('serializes a slow creation and a newer closing draft without duplicate views', async () => {
        let complete: ((view: { id: string }) => void) | undefined;
        const { api, onClose } = await renderModal(undefined, { editingBlock: null }, prepared => {
            prepared.createVaultView.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
        });
        await actAndFlush(() => { updateInput(requireElement(dialog(), 'input[aria-label="View name"]', HTMLInputElement), 'Draft'); });
        await advance();
        expect(api.createVaultView).toHaveBeenCalledTimes(1);
        const name = requireElement(dialog(), 'input[aria-label="View name"]', HTMLInputElement);
        await actAndFlush(() => { updateInput(name, 'Latest draft'); });
        await actAndFlush(() => { requireButton(dialog(), 'Close').click(); });
        expect(api.updateVaultView).not.toHaveBeenCalled();
        expect(onClose).not.toHaveBeenCalled();
        await actAndFlush(() => { complete?.({ id: 'slow-view' }); });
        expect(api.createVaultView).toHaveBeenCalledTimes(1);
        expect(api.updateVaultView).toHaveBeenCalledTimes(1);
        expect(api.updateVaultView).toHaveBeenLastCalledWith('slow-view', expect.objectContaining({ name: 'Latest draft' }));
        expect(onClose).toHaveBeenCalledWith(true, expect.objectContaining({ view_id: 'slow-view' }));
        await advance();
        expect(api.updateVaultView).toHaveBeenCalledTimes(1);
    });

    it('does not write an existing view just by opening its settings', async () => {
        const { api } = await renderModal();
        await advance();
        expect(api.createVaultView).not.toHaveBeenCalled();
        expect(api.updateVaultView).not.toHaveBeenCalled();
        expect(api.upsertPageView).not.toHaveBeenCalled();
    });

    it('preserves the shared view when choosing changes only for this page', async () => {
        const onSave = vi.fn();
        const { api } = await renderModal(undefined, { onSave }, prepared => {
            prepared.fetchVaultViewUsage.mockResolvedValue({ count: 2, pages: [], view_id: existingView.id });
        });
        await actAndFlush(() => { requireElement(dialog(), 'input[value="fork"]', HTMLInputElement).click(); });
        await actAndFlush(() => { updateInput(requireElement(dialog(), 'input[aria-label="View name"]', HTMLInputElement), 'Local view'); });
        await advance();
        expect(api.updateVaultView).not.toHaveBeenCalled();
        expect(api.createVaultView).not.toHaveBeenCalled();
        expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ view_id: null, name: 'Local view' }));
    });
});
