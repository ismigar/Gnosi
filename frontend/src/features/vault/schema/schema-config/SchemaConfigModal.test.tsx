import { describe, expect, it, vi } from 'vitest';
import { advance, baseSchema, button, change, click, input, key, setupModal } from './test-harness';
import * as schemaApi from '../../../../shared/api/vault-schema';
import type { SchemaConfigModalProps } from './types';

describe('SchemaConfigModal public behavior', () => {
    const modal = setupModal();

    it('hydrates before autosaving, keeps edits across parent rerenders and flushes the final payload', async () => {
        const save = vi.fn<NonNullable<SchemaConfigModalProps['onSave']>>();
        await modal.render({ onSave: save });
        expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Fixture');
        expect(document.body.classList.contains('gnosi-modal-open')).toBe(true);
        expect(save).not.toHaveBeenCalled();
        await advance();
        expect(save).toHaveBeenCalledTimes(1);
        expect(save.mock.calls[0]?.[0]).toEqual(baseSchema);
        await change(input('Status'), 'Renamed');
        await modal.rerender({ currentSchema: { ...baseSchema } });
        expect(input('Renamed')).toBeTruthy();
        await modal.unmount();
        expect(save).toHaveBeenCalledTimes(2);
        expect(save.mock.calls[1]?.[0]).toEqual({
            Title: 'title', Title_config: { id: 'fld_00000001' },
            Renamed: 'status', Renamed_config: { id: 'fld_00000002', role: 'status', catalog_ref: 'status' },
        });
        expect(document.body.classList.contains('gnosi-modal-open')).toBe(false);
    });

    it('discards pending saves when invalid and resumes only after completing a new property', async () => {
        const save = vi.fn<NonNullable<SchemaConfigModalProps['onSave']>>();
        await modal.render({ onSave: save });
        await click(button('schema.add_property'));
        expect(document.querySelector('[role="alert"]')?.textContent).toContain('schema.error_name_required');
        await advance();
        expect(save).not.toHaveBeenCalled();
        const names = [...document.querySelectorAll<HTMLInputElement>('input[placeholder="schema.property_name_placeholder"]')];
        const added = names.at(-1);
        if (!added) throw new Error('Missing property name input');
        await change(added, 'New field');
        await advance();
        expect(save).toHaveBeenCalledTimes(1);
        expect(save.mock.calls[0]?.[0]).toMatchObject({ 'New field': 'text' });
    });

    it('enables translation with title and subitems and confirms disabling without removing fields', async () => {
        const save = vi.fn<NonNullable<SchemaConfigModalProps['onSave']>>();
        await modal.render({ onSave: save });
        const translation = [...document.querySelectorAll('label')].find((label) => label.textContent.includes('Translatable table'))?.querySelector('input');
        if (!translation) throw new Error('Missing translation toggle');
        await click(translation);
        await advance();
        expect(save.mock.calls.at(-1)?.[1]).toMatchObject({ enableTranslation: true, enableSubitems: true });
        expect(save.mock.calls.at(-1)?.[0]).toMatchObject({ Title_config: { id: 'fld_00000001', translatable: true } });
        const subitems = [...document.querySelectorAll('label')].find((label) => label.textContent.includes('schema.allow_subitems'))?.querySelector('input');
        expect(subitems?.disabled).toBe(true);
        await click(translation);
        expect(document.body.textContent).toContain('Disable translation for this table?');
        await click(button('Disable'));
        await advance();
        expect(save.mock.calls.at(-1)?.[1]).toMatchObject({ enableTranslation: false, enableSubitems: true });
        expect(input('Title')).toBeTruthy();
    });

    it('preserves legacy button action config as a functionality and nests Escape correctly', async () => {
        const save = vi.fn<NonNullable<SchemaConfigModalProps['onSave']>>();
        const onClose = vi.fn();
        const config = { assignments: [{ field: 'Status', value: 'Done' }], extension: { keep: true } };
        await modal.render({ onSave: save, onClose, currentSchema: { ...baseSchema, Run: 'button', Run_config: { id: 'fld_00000003', button_action: 'set_fields', button_label: 'Assign', button_config: config } } });
        await advance();
        expect(save.mock.calls[0]?.[1]).toMatchObject({ functionalities: [{ id: 'legacy_fld_00000003', action: 'set_fields', label: 'Assign', config }] });
        expect(document.querySelector('input[value="Run"]')).toBeNull();
        await click(button('Program with AI'));
        expect(document.body.textContent).toContain('Program button action with AI');
        await key(document.body, 'Escape');
        expect(document.body.textContent).not.toContain('Program button action with AI');
        expect(onClose).not.toHaveBeenCalled();
        await key(document.body, 'Escape');
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('uses the existing folder API when onSave is absent and confirms field removal', async () => {
        await modal.render({ tableId: null });
        await advance();
        expect(schemaApi.saveVaultFolderSchema).toHaveBeenCalledWith('Fixture', baseSchema);
        await click(button('schema.remove_property'));
        expect(input('Status')).toBeTruthy();
        await click(button('Delete'));
        await advance();
        expect(schemaApi.saveVaultFolderSchema).toHaveBeenLastCalledWith('Fixture', { Title: 'title', Title_config: { id: 'fld_00000001' } });
    });
});
