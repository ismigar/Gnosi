import { act } from 'react';
import { expect, it, vi } from 'vitest';
import { actAndFlush, existingView, renderModal, requireButton, requireElement } from './PageViewModal.test-harness';

const ascending = [{ field: 'title', direction: 'asc' }];
const descending = [{ field: 'title', direction: 'desc' }];
const original = { ...existingView, type: 'table', sorts: ascending };
const alternate = { ...original, id: 'alternate', name: 'Alternate' };
const dialog = () => requireElement(document.body, '[role="dialog"]', HTMLDivElement);
const picker = () => requireElement(dialog(), 'select:has(option[value="alternate"])', HTMLSelectElement);
const direction = () => requireElement(dialog(), 'select:has(option[value="desc"])', HTMLSelectElement);
const select = (element: HTMLSelectElement, value: string) => actAndFlush(() => {
    element.value = value;
    element.dispatchEvent(new Event('change', { bubbles: true }));
});
const advance = () => act(async () => { await vi.advanceTimersByTimeAsync(800); });

it('keeps a pending sort on the current view if switching fails, then retries the switch', async () => {
    const { api, onClose } = await renderModal(undefined, {
        editingBlock: { props: { view_id: original.id, section_id: 'section' }, view: original },
    }, prepared => {
        prepared.fetchVaultViews.mockResolvedValue([original, alternate]);
        prepared.updateVaultView.mockRejectedValueOnce(new Error('Could not save'));
    });
    await actAndFlush(() => { requireButton(dialog(), 'Sort').click(); });
    await select(direction(), 'desc');
    await select(picker(), alternate.id);
    expect(picker().value).toBe(original.id);
    expect(direction().value).toBe('desc');
    expect(dialog().textContent).toContain('Could not save');
    expect(onClose).not.toHaveBeenCalled();

    await select(picker(), alternate.id);
    expect(api.updateVaultView).toHaveBeenLastCalledWith(original.id, expect.objectContaining({ sorts: descending }));
    expect(picker().value).toBe(alternate.id);
    expect(direction().value).toBe('asc');
    await select(picker(), original.id);
    expect(direction().value).toBe('desc');
    await actAndFlush(() => { requireButton(dialog(), 'Close').click(); });
    expect(onClose).toHaveBeenCalledWith(true, expect.objectContaining({ view_id: original.id, section_id: 'section', sorts: descending }));
    expect(api.updateVaultView).not.toHaveBeenCalledWith(alternate.id, expect.anything());
});

it('restores the saved page copy when the protected source is selected again', async () => {
    const main = { ...original, name: 'Resources', is_main: true, locked: true };
    const { api, onClose } = await renderModal(undefined, {
        editingBlock: { props: { view_id: main.id, section_id: 'section' }, view: main },
    }, prepared => { prepared.fetchVaultViews.mockResolvedValue([main, alternate]); });
    await actAndFlush(() => { requireButton(dialog(), 'Sort').click(); });
    await select(direction(), 'desc');
    await advance();
    expect(api.createVaultView).toHaveBeenCalledWith(expect.objectContaining({ sorts: descending, hidden: true }));
    const copyId = api.createVaultView.mock.calls[0]?.[0].id;
    expect(copyId).toBeTruthy();
    await select(picker(), alternate.id);
    await advance();
    await select(picker(), main.id);
    expect(direction().value).toBe('desc');
    await actAndFlush(() => { requireButton(dialog(), 'Close').click(); });
    expect(onClose).toHaveBeenCalledWith(true, expect.objectContaining({ view_id: copyId, section_id: 'section', sorts: descending }));
    expect(api.createVaultView).toHaveBeenCalledTimes(1);
    expect(api.updateVaultView).not.toHaveBeenCalledWith(main.id, expect.anything());
});

it('flushes the original view before changing its source table', async () => {
    const { api } = await renderModal(undefined, {
        editingBlock: { props: { view_id: original.id }, view: original },
        allTables: [original.table_id, 'other'].map(id => ({ id, name: id, properties: [{ name: 'title', type: 'title' }] })),
    }, prepared => { prepared.fetchVaultViews.mockResolvedValue([original]); });
    await actAndFlush(() => { requireButton(dialog(), 'Sort').click(); });
    await select(direction(), 'desc');
    await actAndFlush(() => { requireButton(dialog(), 'General').click(); });
    const source = requireElement(dialog(), 'select[aria-label="Source table"]', HTMLSelectElement);
    await select(source, 'other');
    expect(api.updateVaultView).toHaveBeenCalledWith(original.id, expect.objectContaining({ table_id: original.table_id, sorts: descending }));
    expect(source.value).toBe('other');
});
