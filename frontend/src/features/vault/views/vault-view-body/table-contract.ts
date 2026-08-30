import type { VaultViewPage } from '../../../../shared/records/hooks/useVaultViewData';
import type { BulkActionTemplate } from '../../../../shared/record-views/VaultBulkActionsBar';
import type { TableMetadata, TableNote, TableView, VaultTableProps } from '../vault-table/types';

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): value is string | undefined {
    return value === undefined || typeof value === 'string';
}

function stringValue(value: unknown): string | undefined {
    return typeof value === 'string' ? value : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
    return typeof value === 'boolean' ? value : undefined;
}

function isTableMetadata(value: unknown): value is TableMetadata | null | undefined {
    return value == null || (isRecord(value)
        && ['parent_id', 'table_id', 'database_table_id', 'database_id', 'icon', 'translation_lang']
            .every(key => optionalString(value[key]))
        && (value.translation_stale === undefined || typeof value.translation_stale === 'boolean'));
}

function tableMetadata(value: unknown): TableMetadata | null | undefined {
    if (isTableMetadata(value)) return value;
    if (!isRecord(value)) return undefined;
    return {
        ...value,
        parent_id: stringValue(value.parent_id),
        table_id: stringValue(value.table_id),
        database_table_id: stringValue(value.database_table_id),
        database_id: stringValue(value.database_id),
        icon: stringValue(value.icon),
        translation_lang: stringValue(value.translation_lang),
        translation_stale: booleanValue(value.translation_stale),
    };
}

function isTableNote(value: VaultViewPage): value is VaultViewPage & TableNote {
    return typeof value.id === 'string'
        && ['title', 'parent_id', 'resolved_table_id', 'last_modified'].every(key => optionalString(value[key]))
        && isTableMetadata(value.metadata);
}

/**
 * Preserve the original array when every row already satisfies the contract.
 * Only rows requiring normalization are copied; valid siblings and metadata
 * keep their identities so focus/selection consumers see no false data change.
 */
export function tableNotes(pages: readonly VaultViewPage[]): readonly TableNote[] {
    if (pages.every(isTableNote)) return pages;
    return pages.map(page => isTableNote(page) ? page : {
        ...page,
        title: page.title == null ? undefined : String(page.title),
        parent_id: stringValue(page.parent_id),
        resolved_table_id: stringValue(page.resolved_table_id),
        last_modified: stringValue(page.last_modified),
        metadata: tableMetadata(page.metadata),
    });
}

function isColumnWidths(value: unknown): value is Readonly<Record<string, number>> {
    return isRecord(value) && Object.values(value).every(width => typeof width === 'number');
}

function isStringArray(value: unknown): value is readonly string[] {
    return Array.isArray(value) && value.every((item: unknown) => typeof item === 'string');
}

function columnWidths(value: unknown): Readonly<Record<string, number>> | undefined {
    if (isColumnWidths(value)) return value;
    if (!isRecord(value)) return undefined;
    return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, number] => typeof entry[1] === 'number'));
}

function visibleProperties(value: unknown): readonly string[] | undefined {
    if (isStringArray(value)) return value;
    return Array.isArray(value) ? value.filter((item: unknown): item is string => typeof item === 'string') : undefined;
}

function isTableView(value: Readonly<Record<string, unknown>>): value is TableView {
    return ['id', 'table_id', 'rowHeight', 'groupBy', 'groupSort', 'group_sort', 'groupSortDir', 'group_sort_dir']
        .every(key => optionalString(value[key]))
        && (value.enableSubitems === undefined || typeof value.enableSubitems === 'boolean')
        && (value.columnWidths === undefined || isColumnWidths(value.columnWidths))
        && (value.visibleProperties === undefined || isStringArray(value.visibleProperties));
}

/** Filters, legacy sort shapes, plugin config, and future view keys stay opaque. */
export function tableView(view: Readonly<Record<string, unknown>>): TableView {
    if (isTableView(view)) return view;
    return {
        ...view,
        id: stringValue(view.id),
        table_id: stringValue(view.table_id),
        rowHeight: stringValue(view.rowHeight),
        groupBy: stringValue(view.groupBy),
        groupSort: stringValue(view.groupSort),
        group_sort: stringValue(view.group_sort),
        groupSortDir: stringValue(view.groupSortDir),
        group_sort_dir: stringValue(view.group_sort_dir),
        enableSubitems: booleanValue(view.enableSubitems),
        columnWidths: columnWidths(view.columnWidths),
        visibleProperties: visibleProperties(view.visibleProperties),
    };
}

function isTemplate(value: Readonly<Record<string, unknown>>): value is BulkActionTemplate {
    return typeof value.id === 'string' && (value.title == null || typeof value.title === 'string');
}

export function tableTemplates(templates: readonly Readonly<Record<string, unknown>>[]): readonly BulkActionTemplate[] {
    return templates.every(isTemplate) ? templates : templates.filter(isTemplate);
}

function isRecordFocus(value: unknown): value is NonNullable<VaultTableProps['restoreRecordFocus']> {
    return isRecord(value) && typeof value.recordId === 'string'
        && (typeof value.requestId === 'string' || typeof value.requestId === 'number');
}

export function tableRecordFocus(value: unknown): VaultTableProps['restoreRecordFocus'] {
    return value == null || isRecordFocus(value) ? value : undefined;
}
