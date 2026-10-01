import { describe, expect, it, vi } from 'vitest';
import { advance, baseSchema, button, change, click, input, interact, setupModal } from './test-harness';
import * as schemaApi from '../../../../shared/api/vault-schema';
import { toast } from '../../../../shared/notifications/toast';
import type { SchemaConfigModalProps } from './types';

describe('schema option catalog contracts', () => {
    const modal = setupModal();
    const localSchema = {
        Title: 'title', Title_config: { id: 'fld_00000001' },
        Tags: 'select', Tags_config: { id: 'fld_00000002', options: [{ name: 'Open', color: 'blue' }, { name: 'Done', color: 'green' }], default_option: 'Open' },
    };

    it('commits local option renaming on blur, keeping defaults and issuing one bulk rewrite', async () => {
        const save = vi.fn<NonNullable<SchemaConfigModalProps['onSave']>>();
        await modal.render({ currentSchema: localSchema, onSave: save });
        await change(input('Open'), 'Renamed');
        expect(schemaApi.renameTableOption).not.toHaveBeenCalled();
        await interact(() => { input('Renamed').dispatchEvent(new FocusEvent('focusout', { bubbles: true })); });
        expect(schemaApi.renameTableOption).toHaveBeenCalledExactlyOnceWith('table-1', 'fld_00000002', 'Open', 'Renamed');
        await advance();
        expect(save.mock.calls.at(-1)?.[0]).toMatchObject({ Tags_config: { id: 'fld_00000002', default_option: 'Renamed', options: [{ name: 'Renamed', color: 'blue' }, { name: 'Done', color: 'green' }] } });
    });

    it('deletes a local option only after confirmation and passes reassignment without altering its ID', async () => {
        const save = vi.fn<NonNullable<SchemaConfigModalProps['onSave']>>();
        await modal.render({ currentSchema: localSchema, onSave: save });
        const remove = input('Open').parentElement?.querySelector<HTMLButtonElement>('button[title="Delete"]');
        if (!remove) throw new Error('Missing option remove button');
        await click(remove);
        expect(schemaApi.removeTableOption).not.toHaveBeenCalled();
        const dialogSelect = button('Delete').closest('.max-w-md')?.querySelector('select');
        if (!dialogSelect) throw new Error('Missing reassignment selector');
        await change(dialogSelect, 'Done');
        await click(button('Delete'));
        expect(schemaApi.removeTableOption).toHaveBeenCalledExactlyOnceWith('table-1', 'fld_00000002', 'Open', 'Done');
        await advance();
        expect(save.mock.calls.at(-1)?.[0]).toMatchObject({ Tags_config: { id: 'fld_00000002', options: [{ name: 'Done', color: 'green' }] } });
    });

    it('removes a shared status option once after confirmation', async () => {
        await modal.render();
        const remove = input('Open').parentElement?.querySelector<HTMLButtonElement>('button[title="Delete"]');
        if (!remove) throw new Error('Missing global option remove button');
        await click(remove);
        expect(schemaApi.removeTableOption).not.toHaveBeenCalled();
        await click(button('Delete'));
        expect(schemaApi.removeTableOption).toHaveBeenCalledExactlyOnceWith('table-1', 'fld_00000002', 'Open', undefined);
    });

    it('copies a shared catalog when unlinking and blocks unsupported shared renaming', async () => {
        const save = vi.fn<NonNullable<SchemaConfigModalProps['onSave']>>();
        await modal.render({ onSave: save, currentSchema: { ...localSchema, Tags_config: { id: 'fld_00000002', catalog_ref: 'Tags', role: 'tags' } } });
        await change(input('A'), 'Edited');
        await interact(() => { input('Edited').dispatchEvent(new FocusEvent('focusout', { bubbles: true })); });
        expect(toast.error).toHaveBeenCalledWith('Renaming options of a shared catalog is not supported yet.');
        expect(schemaApi.renameTableOption).not.toHaveBeenCalled();
        const catalog = [...document.querySelectorAll('select')].find((select) => select.value === 'Tags');
        if (!catalog) throw new Error('Missing shared catalog selector');
        await change(catalog, '');
        await advance();
        expect(save.mock.calls.at(-1)?.[0]).toMatchObject({ Tags_config: { id: 'fld_00000002', role: 'tags', options: [expect.objectContaining({ name: 'A' }), expect.objectContaining({ name: 'B' })] } });
        expect(schemaApi.updateOptionCatalog).not.toHaveBeenCalled();
    });

    it('unlinks a status catalog before a rapid rename can rewrite other tables', async () => {
        let finishSave: (() => void) | undefined;
        const save = vi.fn<NonNullable<SchemaConfigModalProps['onSave']>>(() => new Promise<void>(resolve => { finishSave = resolve; }));
        await modal.render({ onSave: save });
        const catalog = [...document.querySelectorAll('select')].find(select => select.title.startsWith('Shares the same option list'));
        if (!catalog) throw new Error('Missing status catalog selector');
        await change(catalog, '');
        await change(input('Open'), 'Local review');
        await interact(() => { input('Local review').dispatchEvent(new FocusEvent('focusout', { bubbles: true })); });
        expect(save).toHaveBeenCalledTimes(1);
        expect(save.mock.calls[0]?.[0].Status_config).toEqual({
            id: 'fld_00000002', role: 'status', options: [{ name: 'Open', color: 'blue' }, { name: 'Done', color: 'green' }],
        });
        expect(schemaApi.renameTableOption).not.toHaveBeenCalled();
        await interact(() => { finishSave?.(); });
        expect(schemaApi.renameTableOption).toHaveBeenCalledExactlyOnceWith('table-1', 'fld_00000002', 'Open', 'Local review');
        expect(schemaApi.updateOptionCatalog).not.toHaveBeenCalled();
        await advance();
        expect(save).toHaveBeenCalledTimes(2);
        expect(save.mock.calls.at(-1)?.[0].Status_config).toMatchObject({ options: [expect.objectContaining({ name: 'Local review' }), expect.objectContaining({ name: 'Done' })] });
        await interact(() => { finishSave?.(); });
    });

    const catalogSelector = () => {
        const catalog = [...document.querySelectorAll('select')].find(select => select.title.startsWith('Shares the same option list'));
        if (!catalog) throw new Error('Missing status catalog selector');
        return catalog;
    };
    const removeButton = (name: string) => {
        const remove = input(name).parentElement?.querySelector<HTMLButtonElement>('button[title="Delete"]');
        if (!remove) throw new Error('Missing option remove button');
        return remove;
    };

    it('waits for unlinking to save, then deletes an option unused in this table without a warning', async () => {
        let finishSave: (() => void) | undefined;
        const save = vi.fn<NonNullable<SchemaConfigModalProps['onSave']>>(() => new Promise<void>(resolve => { finishSave = resolve; }));
        vi.mocked(schemaApi.fetchTableOptionUsage)
            .mockResolvedValueOnce({ counts: { Open: 226, Done: 6 } })
            .mockResolvedValue({ counts: { Done: 2 } });
        await modal.render({ onSave: save });
        expect(input('Open').parentElement?.textContent).toContain('226');
        await change(catalogSelector(), '');
        expect(schemaApi.fetchTableOptionUsage).toHaveBeenCalledTimes(1);
        expect(input('Open').parentElement?.textContent).not.toContain('226');
        await interact(() => { finishSave?.(); });
        expect(schemaApi.fetchTableOptionUsage).toHaveBeenCalledTimes(2);
        await click(removeButton('Open'));
        expect(document.querySelector('.max-w-md')).toBeNull();
        expect(schemaApi.removeTableOption).not.toHaveBeenCalled();
        expect(schemaApi.updateOptionCatalog).not.toHaveBeenCalled();
        await advance();
        await interact(() => { finishSave?.(); });
    });

    it('warns with this table count after unlinking rather than the shared count', async () => {
        vi.mocked(schemaApi.fetchTableOptionUsage)
            .mockResolvedValueOnce({ counts: { Open: 226 } })
            .mockResolvedValue({ counts: { Open: 2 } });
        await modal.render({ onSave: vi.fn() });
        await change(catalogSelector(), '');
        await click(removeButton('Open'));
        expect(document.querySelector('.max-w-md')?.textContent).toContain('used by 2 records');
        expect(document.querySelector('.max-w-md')?.textContent).not.toContain('226');
        expect(schemaApi.removeTableOption).not.toHaveBeenCalled();
    });

    it('ignores a late shared count after switching to a local catalog', async () => {
        let finishSharedUsage: ((value: { counts: Record<string, number> }) => void) | undefined;
        vi.mocked(schemaApi.fetchTableOptionUsage)
            .mockImplementationOnce(() => new Promise(resolve => { finishSharedUsage = resolve; }))
            .mockResolvedValue({ counts: {} });
        await modal.render({ onSave: vi.fn() });
        await change(catalogSelector(), '');
        await interact(() => { finishSharedUsage?.({ counts: { Open: 226 } }); });
        await click(removeButton('Open'));
        expect(document.querySelector('.max-w-md')).toBeNull();
        expect(schemaApi.removeTableOption).not.toHaveBeenCalled();
    });

    it('does not show the shared action-rule warning for a local status option in use', async () => {
        vi.mocked(schemaApi.fetchTableOptionUsage).mockResolvedValue({ counts: { 'Traduït': 1 } });
        await modal.render({ currentSchema: { ...baseSchema, Status_config: { id: 'fld_00000002', options: [{ name: 'Traduït', color: 'yellow' }, { name: 'Done', color: 'green' }] } } });
        await click(removeButton('Traduït'));
        expect(document.querySelector('.max-w-md')?.textContent).toContain('used by 1 records');
        expect(document.querySelector('.max-w-md')?.textContent).not.toContain('action rules');
    });

    it('keeps a confirmation if usage cannot be loaded rather than assuming there are no records', async () => {
        vi.mocked(schemaApi.fetchTableOptionUsage).mockRejectedValue(new Error('Offline'));
        await modal.render({ currentSchema: localSchema });
        await click(removeButton('Open'));
        expect(document.querySelector('.max-w-md')?.textContent).toContain('Are you sure');
        expect(document.querySelector('.max-w-md')?.textContent).not.toContain('used by');
        expect(schemaApi.removeTableOption).not.toHaveBeenCalled();
    });

    it('coalesces consecutive unused local removals without scanning record files', async () => {
        const save = vi.fn<NonNullable<SchemaConfigModalProps['onSave']>>();
        vi.mocked(schemaApi.fetchTableOptionUsage).mockResolvedValue({ counts: {} });
        await modal.render({ currentSchema: localSchema, onSave: save });
        await click(removeButton('Open'));
        await click(removeButton('Done'));
        expect(document.querySelector('.max-w-md')).toBeNull();
        expect(schemaApi.removeTableOption).not.toHaveBeenCalled();
        await advance();
        expect(save).toHaveBeenCalledTimes(1);
        expect(save.mock.calls[0]?.[0].Tags_config).not.toHaveProperty('options');
    });

    it('serializes consecutive record rewrites and keeps both options removed', async () => {
        let finishFirst: ((value: { files_changed: number }) => void) | undefined;
        vi.mocked(schemaApi.removeTableOption).mockImplementationOnce(() => new Promise(resolve => { finishFirst = resolve; }));
        const save = vi.fn<NonNullable<SchemaConfigModalProps['onSave']>>();
        await modal.render({ currentSchema: localSchema, onSave: save });
        await click(removeButton('Open'));
        await click(button('Delete'));
        expect(removeButton('Open').disabled).toBe(true);
        await click(removeButton('Done'));
        await click(button('Delete'));
        expect(schemaApi.removeTableOption).toHaveBeenCalledTimes(1);
        await interact(() => { finishFirst?.({ files_changed: 3 }); });
        expect(schemaApi.removeTableOption).toHaveBeenCalledTimes(2);
        expect([...document.querySelectorAll('input')].some(element => ['Open', 'Done'].includes(element.value))).toBe(false);
        await advance();
        expect(save.mock.calls.at(-1)?.[0].Tags_config).not.toHaveProperty('options');
    });

    it('keeps an option available for retry when its record rewrite fails', async () => {
        vi.mocked(schemaApi.removeTableOption).mockRejectedValueOnce(new Error('Offline'));
        await modal.render({ currentSchema: localSchema });
        await click(removeButton('Open'));
        await click(button('Delete'));
        expect(input('Open')).toBeTruthy();
        expect(removeButton('Open').disabled).toBe(false);
        expect(toast.error).toHaveBeenCalledWith('Could not remove the option from the records');
        await click(removeButton('Open'));
        await click(button('Delete'));
        expect(schemaApi.removeTableOption).toHaveBeenCalledTimes(2);
        expect([...document.querySelectorAll('input')].some(element => element.value === 'Open')).toBe(false);
    });

    it('does not rewrite records after a failed schema save', async () => {
        vi.mocked(console.error).mockImplementation(() => undefined);
        const save = vi.fn<NonNullable<SchemaConfigModalProps['onSave']>>().mockRejectedValueOnce(new Error('Schema conflict'));
        await modal.render({ currentSchema: localSchema, onSave: save });
        await advance();
        expect(toast.error).toHaveBeenCalled();
        await click(removeButton('Open'));
        await click(button('Delete'));
        expect(schemaApi.removeTableOption).not.toHaveBeenCalled();
        expect(input('Open')).toBeTruthy();
    });

    it('keeps options local when changing a select field to status', async () => {
        const save = vi.fn<NonNullable<SchemaConfigModalProps['onSave']>>();
        await modal.render({ onSave: save, currentSchema: localSchema });
        const type = [...document.querySelectorAll('select')].find(select => select.value === 'select');
        if (!type) throw new Error('Missing field type selector');
        await change(type, 'status');
        await advance();
        expect(save.mock.calls.at(-1)?.[0]).toMatchObject({ Tags: 'status', Tags_config: localSchema.Tags_config });
        expect(save.mock.calls.at(-1)?.[0].Tags_config).not.toHaveProperty('catalog_ref');
        expect(schemaApi.updateOptionCatalog).not.toHaveBeenCalled();
    });

    it('adds a colored status option to the shared catalog rather than the field schema', async () => {
        const save = vi.fn<NonNullable<SchemaConfigModalProps['onSave']>>();
        await modal.render({ onSave: save });
        const entry = document.querySelector<HTMLInputElement>('input[placeholder="New option…"]');
        if (!entry) throw new Error('Missing option input');
        await change(entry, 'Review');
        await click(button('Add'));
        expect(schemaApi.updateOptionCatalog).toHaveBeenCalledWith('status', [
            { name: 'Open', color: 'blue' }, { name: 'Done', color: 'green' }, expect.objectContaining({ name: 'Review' }),
        ]);
        await advance();
        expect(save.mock.calls.at(-1)?.[0]).toEqual(baseSchema);
    });
});
