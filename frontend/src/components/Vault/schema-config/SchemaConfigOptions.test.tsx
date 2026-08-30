import { describe, expect, it, vi } from 'vitest';
import { advance, baseSchema, button, change, click, input, interact, setupModal } from './test-harness';
import * as schemaApi from '../../../shared/api/vault-schema';
import { toast } from '../../../lib/toast';
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

    it('characterizes the pre-existing duplicate removal for the global status catalog', async () => {
        await modal.render();
        const remove = input('Open').parentElement?.querySelector<HTMLButtonElement>('button[title="Delete"]');
        if (!remove) throw new Error('Missing global option remove button');
        await click(remove);
        expect(schemaApi.removeTableOption).not.toHaveBeenCalled();
        await click(button('Delete'));
        // Migration parity: keep this known behavior visible for a separate defect fix.
        expect(schemaApi.removeTableOption).toHaveBeenCalledTimes(2);
        expect(vi.mocked(schemaApi.removeTableOption).mock.calls).toEqual([
            ['table-1', 'fld_00000002', 'Open', undefined],
            ['table-1', 'fld_00000002', 'Open', undefined],
        ]);
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
