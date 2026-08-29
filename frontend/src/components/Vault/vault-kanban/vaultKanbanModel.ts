import type { FilterValue } from '../../../utils/vaultFilters';
import { orderGroupKeys } from '../groupOrderUtils';
import { normalizeOptions, optionColorHex } from '../optionCatalogUtils';
import { getFieldConfig } from '../schemaUtils';


export const EMPTY_KANBAN_BUCKET = '__gnosi_empty__';


export type KanbanMetadataValue = FilterValue;
export type KanbanSchema = Readonly<Record<string, unknown>>;


export interface KanbanNote {
    readonly [key: string]: FilterValue;
    readonly id: string;
    readonly last_modified?: string;
    readonly metadata?: Readonly<Record<string, FilterValue>>;
    readonly title: string;
}


export interface KanbanView {
    readonly [key: string]: unknown;
    readonly filters?: unknown;
    readonly group_by?: string;
    readonly group_sort?: string;
    readonly group_sort_dir?: string;
    readonly groupBy?: string;
    readonly groupSort?: string;
    readonly groupSortDir?: string;
    readonly id?: string;
    readonly sort?: unknown;
    readonly sorts?: unknown;
    readonly visibleProperties?: readonly string[];
}


export interface KanbanCardField {
    readonly field: string;
    readonly type: string;
}


export interface KanbanColumnModel {
    readonly color: string | null;
    readonly label: string;
    readonly notes: readonly KanbanNote[];
    readonly status: string;
}


interface FieldOption {
    readonly color?: unknown;
    readonly name: string;
}


interface FieldConfig {
    readonly options?: readonly unknown[];
}


const readFieldConfig = getFieldConfig as (
    schema: KanbanSchema,
    field: string,
) => unknown;


function isUnknownRecord(value: unknown): value is Readonly<Record<string, unknown>> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}


function asFieldConfig(value: unknown): FieldConfig {
    return isUnknownRecord(value) ? value : {};
}


function stringifyScalar(value: FilterValue): string | null {
    if (
        typeof value === 'string'
        || typeof value === 'number'
        || typeof value === 'bigint'
        || typeof value === 'boolean'
    ) return String(value);
    return null;
}


function isFilterValueArray(value: FilterValue): value is readonly FilterValue[] {
    return Array.isArray(value);
}


export function normalizeKanbanMetadataKey(value: unknown): string {
    return String(value)
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/gu, '')
        .replace(/[^a-z0-9]/giu, '');
}


export function readKanbanCardValue(
    note: KanbanNote,
    field: string,
): { readonly metadataKey: string; readonly value: FilterValue } {
    const exact = note.metadata?.[field];
    if (exact !== undefined && exact !== null && exact !== '') {
        return { metadataKey: field, value: exact };
    }
    const normalizedField = normalizeKanbanMetadataKey(field);
    const metadataKey = Object.keys(note.metadata ?? {}).find((key) => (
        normalizeKanbanMetadataKey(key) === normalizedField
    )) ?? field;
    return { metadataKey, value: note.metadata?.[metadataKey] };
}


export function findKanbanMetadataKey(note: KanbanNote, field: string): string {
    const normalizedField = normalizeKanbanMetadataKey(field);
    return Object.keys(note.metadata ?? {}).find((key) => (
        normalizeKanbanMetadataKey(key) === normalizedField
    )) ?? field;
}


export function kanbanGroupValues(
    note: KanbanNote,
    field: string,
    pendingMoves: ReadonlyMap<string, FilterValue>,
): string[] {
    const raw = pendingMoves.has(note.id)
        ? pendingMoves.get(note.id)
        : readKanbanCardValue(note, field).value;
    if (isFilterValueArray(raw)) return raw.flatMap((value) => {
        const scalar = stringifyScalar(value);
        return scalar?.trim() ? [scalar] : [];
    });
    const scalar = stringifyScalar(raw);
    return scalar?.trim() ? [scalar] : [];
}


export function resolveKanbanDropValue(
    currentValue: FilterValue,
    fromStatus: string,
    targetStatus: string,
): string | string[] {
    if (targetStatus === EMPTY_KANBAN_BUCKET) {
        return isFilterValueArray(currentValue) ? [] : '';
    }
    if (!isFilterValueArray(currentValue)) return targetStatus;
    const withoutSource = currentValue
        .flatMap((value) => {
            const scalar = stringifyScalar(value);
            return scalar?.trim() ? [scalar] : [];
        })
        .filter((value) => value !== fromStatus);
    return withoutSource.includes(targetStatus)
        ? withoutSource
        : [...withoutSource, targetStatus];
}


export function buildKanbanColumns(
    notes: readonly KanbanNote[],
    schema: KanbanSchema,
    view: KanbanView,
    pendingMoves: ReadonlyMap<string, FilterValue>,
    idToTitle: Readonly<Record<string, string>>,
): KanbanColumnModel[] {
    const groupBy = view.groupBy ?? view.group_by ?? 'status';
    const config = asFieldConfig(readFieldConfig(schema, groupBy));
    const options = Array.isArray(config.options)
        ? normalizeOptions(config.options) as readonly FieldOption[]
        : [];
    const predefinedStatuses = options.length > 0
        ? options.map(({ name }) => name)
        : groupBy === 'status'
            ? ['Idea', 'Brollador', 'Zettel', 'Tancat']
            : [];
    const customStatuses = new Set<string>();
    notes.forEach((note) => {
        kanbanGroupValues(note, groupBy, pendingMoves).forEach((status) => {
            if (!predefinedStatuses.includes(status)) customStatuses.add(status);
        });
    });
    const statuses = [
        ...new Set([...predefinedStatuses, ...customStatuses]),
        EMPTY_KANBAN_BUCKET,
    ];
    const groupedNotes = Object.fromEntries(
        statuses.map((status) => [status, [] as KanbanNote[]]),
    );
    notes.forEach((note) => {
        const values = kanbanGroupValues(note, groupBy, pendingMoves);
        if (values.length === 0) {
            groupedNotes[EMPTY_KANBAN_BUCKET]?.push(note);
            return;
        }
        values.forEach((status) => {
            (groupedNotes[status] ?? groupedNotes[EMPTY_KANBAN_BUCKET])?.push(note);
        });
    });
    const orderedStatuses = orderGroupKeys({
        direction: view.groupSortDir ?? view.group_sort_dir ?? 'asc',
        emptyKey: EMPTY_KANBAN_BUCKET,
        getCount: (status) => groupedNotes[status]?.length ?? 0,
        getLabel: (status) => idToTitle[status] ?? status,
        keys: statuses,
        mode: view.groupSort ?? view.group_sort ?? 'catalog',
    });
    const colors = Object.fromEntries(options.map(({ color, name }) => [name, color]));
    return orderedStatuses.map((status) => ({
        color: colors[status] ? optionColorHex(colors[status]) : null,
        label: idToTitle[status] ?? status,
        notes: groupedNotes[status] ?? [],
        status,
    }));
}
