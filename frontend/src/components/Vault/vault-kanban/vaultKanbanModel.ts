import type { VaultViewPage } from '../../../hooks/useVaultViewData';
import { orderGroupKeys } from '../groupOrderUtils';
import { normalizeOptions, optionColorHex } from '../optionCatalogUtils';
import { getFieldConfig } from '../schemaUtils';


export const EMPTY_KANBAN_BUCKET = '__gnosi_empty__';


export type KanbanMetadataValue = unknown;
export type KanbanSchema = Readonly<Record<string, unknown>>;
export type KanbanNote = VaultViewPage;
export type KanbanView = Readonly<Record<string, unknown>>;


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


function stringifyScalar(value: unknown): string | null {
    if (
        typeof value === 'string'
        || typeof value === 'number'
        || typeof value === 'bigint'
        || typeof value === 'boolean'
    ) return String(value);
    return null;
}


function isFilterValueArray(value: unknown): value is readonly unknown[] {
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
): { readonly metadataKey: string; readonly value: unknown } {
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
    pendingMoves: ReadonlyMap<string, unknown>,
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
    currentValue: unknown,
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
    pendingMoves: ReadonlyMap<string, unknown>,
    idToTitle: Readonly<Record<string, string>>,
): KanbanColumnModel[] {
    const groupBy = readKanbanGroupBy(view);
    const config = getFieldConfig(schema, groupBy);
    const options = Array.isArray(config.options)
        ? normalizeOptions(config.options)
        : [];
    const predefinedStatuses = options.length > 0
        ? options.map(({ name }) => name)
        : (view.groupBy ?? view.group_by ?? 'status') === 'status'
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
    const groupedNotes = Object.fromEntries<KanbanNote[]>(
        statuses.map((status) => [status, []]),
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
        direction: (view.groupSortDir ?? view.group_sort_dir) === 'desc' ? 'desc' : 'asc',
        emptyKey: EMPTY_KANBAN_BUCKET,
        getCount: (status) => groupedNotes[status]?.length ?? 0,
        getLabel: (status) => idToTitle[status] ?? status,
        keys: statuses,
        mode: readKanbanGroupSort(view),
    });
    const colors = Object.fromEntries(options.map(({ color, name }) => [name, color]));
    return orderedStatuses.map((status) => ({
        color: colors[status] ? optionColorHex(colors[status]) : null,
        label: idToTitle[status] ?? status,
        notes: groupedNotes[status] ?? [],
        status,
    }));
}


export function readKanbanGroupBy(view: KanbanView): string {
    const value = view.groupBy ?? view.group_by ?? 'status';
    // Property lookup and decorative-key matching use JavaScript string coercion.
    if (typeof value === 'symbol') throw new TypeError('Cannot convert a Symbol value to a string');
    return Reflect.apply(String, undefined, [value]);
}


function readKanbanGroupSort(view: KanbanView): string {
    const mode = view.groupSort ?? view.group_sort;
    return mode === 'alpha' || mode === 'count' ? mode : 'catalog';
}


export function readKanbanVisibleProperties(value: unknown): readonly string[] | undefined {
    if (value == null) return undefined;
    if (typeof value === 'string') return value.length ? Array.from(value) : undefined;
    if (!isFilterValueArray(value)) {
        if ((typeof value === 'object' || typeof value === 'function') && 'length' in value && value.length) {
            throw new TypeError('Invalid Kanban visible properties: expected field names.');
        }
        return undefined;
    }
    if (value.length === 0) return undefined;
    if (value.every((field): field is string => typeof field === 'string')) return value;
    throw new TypeError('Invalid Kanban visible properties: expected field names.');
}
