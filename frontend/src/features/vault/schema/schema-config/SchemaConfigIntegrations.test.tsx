import { describe, expect, it, vi } from 'vitest';
import { advance, baseSchema, button, change, click, input, interact, key, setupModal } from './test-harness';
import * as schemaApi from '../../../../shared/api/vault-schema';
import type { SchemaConfigModalProps } from './types';

describe('schema plugins, catalogs and keyboard contracts', () => {
    const modal = setupModal();

    it('sends the same AI action request and applies the generated config only to the selected functionality', async () => {
        const save = vi.fn<NonNullable<SchemaConfigModalProps['onSave']>>();
        vi.mocked(schemaApi.generateButtonAction).mockResolvedValue({ status: 'success', result: {
            button_action: 'ai_prompt', button_label: 'Summarize', button_config: { prompt: 'Summarize Title', target_field: 'Title', plugin: { keep: true } },
        } });
        await modal.render({ onSave: save, initialFunctionalities: [{ id: 'fn_saved', enabled: false, label: 'Action', action: 'set_fields', config: { assignments: [] } }] });
        await click(button('Program with AI'));
        const prompt = document.querySelector<HTMLTextAreaElement>('textarea[placeholder="Type your request here..."]');
        if (!prompt) throw new Error('Missing AI prompt');
        await change(prompt, 'Summarize title');
        await click(button('Programar amb IA ✨'));
        expect(schemaApi.generateButtonAction).toHaveBeenCalledExactlyOnceWith({ prompt: 'Summarize title', fields: [{ name: 'Title', type: 'title' }, { name: 'Status', type: 'status' }] });
        await advance();
        expect(save.mock.calls.at(-1)?.[1].functionalities).toEqual([{ id: 'fn_saved', enabled: false, label: 'Summarize', action: 'ai_prompt', config: { prompt: 'Summarize Title', target_field: 'Title', plugin: { keep: true } } }]);
    });

    it('keeps saved Drupal bundle and mappings visible when discovery is unavailable', async () => {
        const save = vi.fn<NonNullable<SchemaConfigModalProps['onSave']>>();
        vi.mocked(schemaApi.fetchDrupalContentTypes).mockRejectedValueOnce({ payload: { detail: 'Offline fixture' } });
        vi.mocked(schemaApi.fetchDrupalFields).mockRejectedValueOnce({ response: { data: { detail: 'Fields offline' } } });
        await modal.render({ onSave: save, initialEnableDrupalSync: true, initialDrupalBundle: 'historic', initialDrupalFieldMapping: { __body__: 'body_old', fld_00000001: 'title_old' } });
        const selected = [...document.querySelectorAll('select')].map((select) => select.value);
        expect(selected).toContain('historic');
        expect(selected).toContain('body_old');
        expect(selected).toContain('title_old');
        await advance();
        expect(save.mock.calls.at(-1)?.[1]).toMatchObject({ enableDrupalSync: true, drupalBundle: 'historic', drupalFieldMapping: { __body__: 'body_old', fld_00000001: 'title_old' } });
        await click(button('Link existing records by title'));
        expect(schemaApi.matchDrupalRows).toHaveBeenCalledExactlyOnceWith('table-1');
    });

    it('shows the project-planning period controls and persists their existing contract', async () => {
        const save = vi.fn<NonNullable<SchemaConfigModalProps['onSave']>>();
        await modal.render({ onSave: save, currentSchema: { ...baseSchema, Timeline: 'period', Timeline_config: { id: 'fld_00000003', duration_enabled: false, period_unit: 'years' } } });
        expect(document.body.textContent).toContain('Project planning');
        const unit = [...document.querySelectorAll('select')].find((select) => select.value === 'years');
        if (!unit) throw new Error('Missing planning unit');
        await change(unit, 'hours');
        await advance();
        expect(save.mock.calls.at(-1)?.[0]).toMatchObject({ Timeline_config: { id: 'fld_00000003', period_unit: 'hours', duration_enabled: false, predecessors_enabled: true, skip_non_working_days: true } });
    });

    it('keeps rollup choices sorted and supports count_all without a target property', async () => {
        const save = vi.fn<NonNullable<SchemaConfigModalProps['onSave']>>();
        await modal.render({ onSave: save, availableTables: [{ id: 'other', name: 'Other' }], currentSchema: {
            Title: 'title', Zeta: 'relation', Alpha: 'relation', Count: 'rollup',
            Count_config: { id: 'fld_00000003', relationField: 'Zeta', aggregation: 'count_all' },
        } });
        const relation = [...document.querySelectorAll('select')].find((select) => select.value === 'Zeta');
        if (!relation) throw new Error('Missing rollup relation');
        expect([...relation.options].map((option) => option.value)).toEqual(['', 'Alpha', 'Zeta']);
        await change(relation, 'Alpha');
        await advance();
        expect(save.mock.calls.at(-1)?.[0]).toMatchObject({ Count_config: { id: 'fld_00000003', relationField: 'Alpha', aggregation: 'count_all' } });
        const aggregation = [...document.querySelectorAll('select')].find((select) => select.value === 'count_all');
        if (!aggregation) throw new Error('Missing aggregation');
        expect(aggregation.options.length).toBe(11);
        await change(aggregation, 'sum');
        expect(document.querySelector('[role="alert"]')?.textContent).toContain('schema.error_target_property_required');
    });

    it('redirects arrows and wheel to the modal body while respecting input and nested-control semantics', async () => {
        const onClose = vi.fn();
        await modal.render({ onClose });
        const scroll = document.querySelector<HTMLDivElement>('.gnosi-modal-scroll');
        if (!scroll) throw new Error('Missing modal scroll container');
        const scrollBy = vi.fn();
        const scrollTo = vi.fn();
        scroll.scrollBy = scrollBy;
        scroll.scrollTo = scrollTo;
        Object.defineProperty(scroll, 'clientHeight', { value: 200 });
        Object.defineProperty(scroll, 'scrollHeight', { value: 800 });
        await key(input('Title'), 'ArrowDown');
        expect(scrollBy).toHaveBeenCalledExactlyOnceWith({ top: 48 });
        await key(input('Title'), 'Home');
        expect(scrollTo).not.toHaveBeenCalled();
        const select = document.querySelector('select');
        if (!select) throw new Error('Missing select');
        await key(select, 'ArrowDown');
        expect(scrollBy).toHaveBeenCalledTimes(1);
        await interact(() => { select.dispatchEvent(new WheelEvent('wheel', { deltaY: 90, bubbles: true, cancelable: true })); });
        expect(scroll.scrollTop).toBe(90);
        await key(document.body, 'End');
        expect(scrollTo).toHaveBeenCalledExactlyOnceWith({ top: 800 });
        await key(input('Title'), 'Escape');
        expect(onClose).toHaveBeenCalledExactlyOnceWith();
    });
});
