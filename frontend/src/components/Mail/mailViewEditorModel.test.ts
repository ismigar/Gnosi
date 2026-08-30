import { describe, expect, it } from 'vitest';

import type { MailView } from '../../shared/api/mail';
import {
    addDefaultFilter,
    createMailViewEditorForm,
    defaultOperatorForField,
    defaultValueForField,
    getOperatorsForField,
    removeFilterAt,
    reorderFields,
    toggleAction,
    toggleFieldVisibility,
    updateFilterAt,
} from './mailViewEditorModel';


const initialView: MailView = {
    actions: ['reply'],
    created_at: '2026-08-01T10:00:00Z',
    fields: [
        { key: 'subject', order: 0, visible: true, width: 320 },
        { key: 'sender', order: 1, visible: false, width: null },
    ],
    filter_logic: 'OR',
    filters: [{ field: 'sender', operator: 'contains', value: 'openai.com' }],
    group_by: 'sender',
    id: 'view-1',
    name: 'Research',
    sort_by: 'subject',
    sort_dir: 'asc',
    updated_at: '2026-08-02T10:00:00Z',
};


describe('mailViewEditorModel', () => {
    it('creates the historical defaults for a new view', () => {
        const form = createMailViewEditorForm(null);

        expect(form).toMatchObject({
            actions: ['archive', 'trash', 'mark_read'],
            filter_logic: 'AND',
            filters: [],
            group_by: 'none',
            name: '',
            sort_by: 'date',
            sort_dir: 'desc',
        });
        expect(form.fields).toHaveLength(10);
        expect(form.fields.at(0)).toEqual({ key: 'sender', order: 0, visible: true });
        expect(form.fields.at(-1)).toEqual({ key: 'category', order: 9, visible: true });
    });

    it('preserves the complete response payload while editing', () => {
        expect(createMailViewEditorForm(initialView)).toEqual(initialView);
    });

    it('selects operators and default values from the field type', () => {
        expect(getOperatorsForField('sender').map(({ value }) => value)).toEqual([
            'contains',
            'starts_with',
            'equals',
            'is_not',
        ]);
        expect(getOperatorsForField('is_read').map(({ value }) => value)).toEqual([
            'is',
            'is_not',
        ]);
        expect(getOperatorsForField('timestamp').map(({ value }) => value)).toEqual([
            'before',
            'after',
        ]);
        expect(defaultOperatorForField('unknown')).toBe('contains');
        expect(defaultValueForField('is_read')).toBe(true);
        expect(defaultValueForField('sender')).toBe('');
        expect(defaultValueForField(
            'timestamp',
            new Date('2026-08-30T18:00:00Z'),
        )).toBe('2026-08-30');
    });

    it('applies filter transitions without mutating the previous form', () => {
        const form = createMailViewEditorForm(null);
        const added = addDefaultFilter(form);
        const updated = updateFilterAt(added, 0, {
            field: 'is_read',
            operator: 'is',
            value: false,
        });
        const removed = removeFilterAt(updated, 0);

        expect(form.filters).toEqual([]);
        expect(added.filters).toEqual([
            { field: 'sender', operator: 'contains', value: '' },
        ]);
        expect(updated.filters).toEqual([
            { field: 'is_read', operator: 'is', value: false },
        ]);
        expect(removed.filters).toEqual([]);
    });

    it('toggles fields and actions and keeps field order synchronized', () => {
        const form = createMailViewEditorForm(initialView);
        const hidden = toggleFieldVisibility(form, 'subject');
        const enabled = toggleAction(hidden, 'archive');
        const disabled = toggleAction(enabled, 'reply');
        const reordered = reorderFields(disabled, 'sender', 'subject');

        expect(hidden.fields.at(0)?.visible).toBe(false);
        expect(enabled.actions).toEqual(['reply', 'archive']);
        expect(disabled.actions).toEqual(['archive']);
        expect(reordered.fields).toEqual([
            { key: 'sender', order: 0, visible: false, width: null },
            { key: 'subject', order: 1, visible: false, width: 320 },
        ]);
        expect(reorderFields(reordered, 'missing', 'subject')).toBe(reordered);
    });
});
