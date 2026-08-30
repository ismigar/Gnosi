import type { UniqueIdentifier } from '@dnd-kit/core';

import type { MailView, MailViewCreate } from '../../../shared/api/mail';


export type MailViewField = NonNullable<MailViewCreate['fields']>[number];
export type MailViewFilter = NonNullable<MailViewCreate['filters']>[number];


export interface MailFieldOption {
    readonly key: string;
    readonly label: string;
    readonly labelKey: string;
}


export interface MailFilterFieldOption extends MailFieldOption {
    readonly type: 'bool' | 'date' | 'text';
}


export interface MailOperatorOption {
    readonly label: string;
    readonly labelKey: string;
    readonly value: string;
}


export interface MailActionOption {
    readonly label: string;
    readonly labelKey: string;
    readonly value: string;
}


export type MailViewEditorForm = {
    actions: string[];
    fields: MailViewField[];
    filter_logic: string;
    filters: MailViewFilter[];
    group_by: string;
    name: string;
    sort_by: string;
    sort_dir: string;
} & Partial<Pick<MailView, 'created_at' | 'id' | 'updated_at'>>;


export const ALL_FIELDS: readonly MailFieldOption[] = [
    { key: 'sender', label: 'From', labelKey: 'mail.from_label' },
    { key: 'recipient', label: 'To', labelKey: 'mail.to_label' },
    { key: 'cc', label: 'CC', labelKey: 'mail.cc_label' },
    { key: 'bcc', label: 'BCC', labelKey: 'mail.bcc_label' },
    { key: 'subject', label: 'Subject', labelKey: 'mail.subject_label' },
    { key: 'labels', label: 'Labels', labelKey: 'mail.labels' },
    {
        key: 'has_attachments',
        label: 'Files',
        labelKey: 'mail_view_editor.field_attachments',
    },
    { key: 'date', label: 'Date', labelKey: 'mail.date_label' },
    {
        key: 'snippet',
        label: 'Snippet',
        labelKey: 'mail_view_editor.field_snippet',
    },
    {
        key: 'category',
        label: 'Category',
        labelKey: 'mail_view_editor.field_category',
    },
];


export const FILTER_FIELDS: readonly MailFilterFieldOption[] = [
    { key: 'sender', label: 'From', labelKey: 'mail.from_label', type: 'text' },
    { key: 'recipient', label: 'To', labelKey: 'mail.to_label', type: 'text' },
    { key: 'cc', label: 'CC', labelKey: 'mail.cc_label', type: 'text' },
    { key: 'bcc', label: 'BCC', labelKey: 'mail.bcc_label', type: 'text' },
    { key: 'subject', label: 'Subject', labelKey: 'mail.subject_label', type: 'text' },
    {
        key: 'category',
        label: 'Category',
        labelKey: 'mail_view_editor.field_category',
        type: 'text',
    },
    { key: 'labels', label: 'Labels', labelKey: 'mail.labels', type: 'text' },
    {
        key: 'is_read',
        label: 'Read',
        labelKey: 'mail_view_editor.field_read',
        type: 'bool',
    },
    {
        key: 'has_attachments',
        label: 'Has attachments',
        labelKey: 'mail_view_editor.field_has_attachments',
        type: 'bool',
    },
    {
        key: 'archived',
        label: 'Archived',
        labelKey: 'mail.undo_label_archived',
        type: 'bool',
    },
    {
        key: 'is_starred',
        label: 'Starred',
        labelKey: 'mail_view_editor.field_starred',
        type: 'bool',
    },
    { key: 'timestamp', label: 'Date', labelKey: 'mail.date_label', type: 'date' },
];


const TEXT_OPERATORS: readonly MailOperatorOption[] = [
    {
        value: 'contains',
        label: 'contains',
        labelKey: 'view_config.operators.contains',
    },
    {
        value: 'starts_with',
        label: 'starts with',
        labelKey: 'mail_view_editor.operator_starts_with',
    },
    {
        value: 'equals',
        label: 'equals',
        labelKey: 'view_config.operators.equals',
    },
    {
        value: 'is_not',
        label: 'is not',
        labelKey: 'mail_view_editor.operator_is_not',
    },
];


const BOOL_OPERATORS: readonly MailOperatorOption[] = [
    { value: 'is', label: 'is', labelKey: 'mail_view_editor.operator_is' },
    {
        value: 'is_not',
        label: 'is not',
        labelKey: 'mail_view_editor.operator_is_not',
    },
];


const DATE_OPERATORS: readonly MailOperatorOption[] = [
    {
        value: 'before',
        label: 'before',
        labelKey: 'mail_view_editor.operator_before',
    },
    {
        value: 'after',
        label: 'after',
        labelKey: 'mail_view_editor.operator_after',
    },
];


export const ALL_ACTIONS: readonly MailActionOption[] = [
    { value: 'archive', label: 'Archive', labelKey: 'mail.archive_action' },
    { value: 'trash', label: 'Delete', labelKey: 'mail.delete_action' },
    {
        value: 'mark_read',
        label: 'Mark as read',
        labelKey: 'mail_view_editor.action_mark_read',
    },
    { value: 'star', label: 'Star', labelKey: 'mail_view_editor.action_star' },
    {
        value: 'snooze',
        label: 'Snooze',
        labelKey: 'mail_view_editor.action_snooze',
    },
    { value: 'reply', label: 'Reply', labelKey: 'mail_view_editor.action_reply' },
];


const DEFAULT_FIELDS: MailViewField[] = ALL_FIELDS.map((field, order) => ({
    key: field.key,
    order,
    visible: true,
}));


const DEFAULT_VIEW: MailViewEditorForm = {
    actions: ['archive', 'trash', 'mark_read'],
    fields: DEFAULT_FIELDS,
    filter_logic: 'AND',
    filters: [],
    group_by: 'none',
    name: '',
    sort_by: 'date',
    sort_dir: 'desc',
};


export function createMailViewEditorForm(
    initialView: MailView | null,
): MailViewEditorForm {
    if (initialView !== null) return { ...DEFAULT_VIEW, ...initialView };
    return { ...DEFAULT_VIEW, fields: DEFAULT_FIELDS };
}


export function getOperatorsForField(
    fieldKey: string,
): readonly MailOperatorOption[] {
    const field = FILTER_FIELDS.find((candidate) => candidate.key === fieldKey);
    if (field?.type === 'bool') return BOOL_OPERATORS;
    if (field?.type === 'date') return DATE_OPERATORS;
    return TEXT_OPERATORS;
}


export function defaultOperatorForField(fieldKey: string): string {
    return getOperatorsForField(fieldKey).at(0)?.value ?? 'contains';
}


export function defaultValueForField(
    fieldKey: string,
    now: Date = new Date(),
): boolean | string {
    const field = FILTER_FIELDS.find((candidate) => candidate.key === fieldKey);
    if (field?.type === 'bool') return true;
    if (field?.type === 'date') return now.toISOString().slice(0, 10);
    return '';
}


export function addDefaultFilter(form: MailViewEditorForm): MailViewEditorForm {
    const field = 'sender';
    return {
        ...form,
        filters: [
            ...form.filters,
            {
                field,
                operator: defaultOperatorForField(field),
                value: defaultValueForField(field),
            },
        ],
    };
}


export function updateFilterAt(
    form: MailViewEditorForm,
    index: number,
    updated: MailViewFilter,
): MailViewEditorForm {
    return {
        ...form,
        filters: form.filters.map((filter, candidateIndex) => (
            candidateIndex === index ? updated : filter
        )),
    };
}


export function removeFilterAt(
    form: MailViewEditorForm,
    index: number,
): MailViewEditorForm {
    return {
        ...form,
        filters: form.filters.filter((_, candidateIndex) => candidateIndex !== index),
    };
}


export function toggleFieldVisibility(
    form: MailViewEditorForm,
    key: string,
): MailViewEditorForm {
    return {
        ...form,
        fields: form.fields.map((field) => (
            field.key === key ? { ...field, visible: !field.visible } : field
        )),
    };
}


export function reorderFields(
    form: MailViewEditorForm,
    activeId: UniqueIdentifier,
    overId: UniqueIdentifier,
): MailViewEditorForm {
    const oldIndex = form.fields.findIndex((field) => field.key === activeId);
    const newIndex = form.fields.findIndex((field) => field.key === overId);
    if (oldIndex === -1 || newIndex === -1) return form;

    const fields = [...form.fields];
    const moved = fields.splice(oldIndex, 1).at(0);
    if (moved === undefined) return form;
    fields.splice(newIndex, 0, moved);
    return {
        ...form,
        fields: fields.map((field, order) => ({ ...field, order })),
    };
}


export function toggleAction(
    form: MailViewEditorForm,
    value: string,
): MailViewEditorForm {
    return {
        ...form,
        actions: form.actions.includes(value)
            ? form.actions.filter((action) => action !== value)
            : [...form.actions, value],
    };
}


export function legacyFilterValue(value: unknown): string {
    return Reflect.apply(String, undefined, [value]);
}


export function legacyTruthyFilterValue(value: unknown): string {
    return value ? legacyFilterValue(value) : '';
}


export function errorMessage(error: unknown): string | undefined {
    if (typeof error !== 'object' || error === null || !('message' in error)) {
        return undefined;
    }
    return typeof error.message === 'string' ? error.message : undefined;
}
