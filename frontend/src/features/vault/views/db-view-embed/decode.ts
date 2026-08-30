import type { FilterGroup, FilterNode, FilterRule, FilterValue } from '../../../../shared/filtering/vaultFilters';
import type { VaultEditorContextValue } from '../../../../shared/editor/VaultEditorContext';
import { decodeView as decodeAppearance } from '../../view-config/page-view-modal/decode';
import type { ViewSort } from '../../view-config/page-view-modal/types';
import type { Column, EmbedContext, EmbedJoin, EmbedRow, EmbedTable, EmbedView, Metadata, NavApi, QuickPreset } from './types';

export const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
export const text = (value: unknown): string | undefined => typeof value === 'string' ? value : undefined;
export const legacyText = (value: unknown): string => Reflect.apply(String, undefined, [value]);
const number = (value: unknown): number | undefined => typeof value === 'number' ? value : undefined;
const bool = (value: unknown): boolean | undefined => typeof value === 'boolean' ? value : undefined;
function isFilterValue(value: unknown): value is FilterValue {
    return value == null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint'
        || (Array.isArray(value) ? value.every(isFilterValue) : isRecord(value) && Object.values(value).every(isFilterValue));
}
function isMetadata(value: unknown): value is Metadata { return isRecord(value) && Object.values(value).every(isFilterValue); }
export const metadata = (value: unknown): Metadata => isMetadata(value) ? value : {};
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
function filter(value: unknown): FilterNode {
    if (!isRecord(value)) return undefined;
    if (Array.isArray(value.rules)) return { ...value, conjunction: text(value.conjunction), rules: value.rules.map(filter) };
    return { ...value, field: text(value.field), operator: text(value.operator), periodPart: text(value.periodPart), value: isFilterValue(value.value) ? value.value : undefined };
}
export function isFilterGroup(value: unknown): value is FilterGroup { return isRecord(value) && Array.isArray(value.rules); }
function sort(value: unknown): ViewSort | undefined {
    return isRecord(value) && typeof value.field === 'string' ? { ...value, field: value.field, direction: text(value.direction) } : undefined;
}
export function columns(value: unknown): Column[] | undefined {
    if (!Array.isArray(value)) return undefined;
    return value.flatMap((item: unknown): Column[] => {
        if (typeof item === 'string') return [item];
        if (!isRecord(item) || typeof item.fieldKey !== 'string') return [];
        return [{ ...item, fieldKey: item.fieldKey, tableId: item.tableId === null ? null : text(item.tableId), label: item.label }];
    });
}
function numericMap(value: unknown): Record<string, number> | undefined {
    if (!isRecord(value)) return undefined;
    return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, number] => typeof entry[1] === 'number'));
}
export function presets(value: unknown): QuickPreset[] {
    return array(value).filter(isRecord).filter(item => typeof item.label === 'string').map(item => ({
        ...item, id: legacyText(item.id ?? ''), label: text(item.label) || '', searchTerm: text(item.searchTerm), density: text(item.density), groupMode: text(item.groupMode), activeViewId: text(item.activeViewId),
    }));
}
export function decodeView(value: unknown): EmbedView {
    const src = isRecord(value) ? value : {};
    const appearance = decodeAppearance(src);
    const tree = filter(src.filterTree);
    const leaf = filter(src.filter);
    return {
        ...appearance, view_id: text(src.view_id), heading: text(src.heading), heading_level: number(src.heading_level), view_type: text(src.view_type),
        groupBy: src.groupBy === null ? null : text(src.groupBy), group_by: src.group_by === null ? null : text(src.group_by),
        visible_properties: columns(src.visible_properties), columns: columns(src.columns), visibleProperties: columns(src.visibleProperties),
        filterTree: isFilterGroup(tree) ? tree : undefined, filter: leaf && !isFilterGroup(leaf) ? leaf : undefined,
        filters: Array.isArray(src.filters) ? src.filters.map(filter) : undefined,
        sorts: Array.isArray(src.sorts) ? src.sorts.map(sort).filter((item): item is ViewSort => !!item) : undefined,
        sort: src.sort === null ? null : sort(src.sort),
        joins: Array.isArray(src.joins) ? src.joins.filter(isRecord).map((join): EmbedJoin => ({ ...join, tableId: text(join.tableId), leftField: text(join.leftField), rightField: text(join.rightField), type: text(join.type) })) : undefined,
        quickPresets: Array.isArray(src.quickPresets) ? presets(src.quickPresets) : undefined,
        tabs: Array.isArray(src.tabs) ? src.tabs.map(legacyText) : undefined,
        enableSubitems: bool(src.enableSubitems), enable_subitems: bool(src.enable_subitems),
        columnWidths: numericMap(src.columnWidths), column_widths: numericMap(src.column_widths),
    };
}
export const decodeViews = (value: unknown): EmbedView[] => array(value).map(decodeView);
export function decodeRow(value: unknown): EmbedRow {
    const src = isRecord(value) ? value : {};
    return { ...metadata(src), id: legacyText(src.id ?? ''), title: text(src.title) || '', content: text(src.content), metadata: metadata(src.metadata) };
}
export const decodeRows = (value: unknown): EmbedRow[] => array(value).map(decodeRow);
function decodeTables(value: unknown): EmbedTable[] {
    return array(value).filter(isRecord).map(src => ({ ...src, id: legacyText(src.id), properties: Array.isArray(src.properties) ? src.properties.filter(isRecord).map(p => ({ ...p, name: text(p.name), type: text(p.type) })) : undefined }));
}
function invoke(value: unknown, ...args: unknown[]): unknown { return typeof value === 'function' ? Reflect.apply(value, undefined, args) : undefined; }
export function decodeContext(value: VaultEditorContextValue): EmbedContext {
    return {
        ...value, registry: { tables: decodeTables(value.registry.tables), views: decodeViews(value.registry.views) }, allTables: decodeTables(value.allTables),
        exitEmbedToEditor: typeof value.exitEmbedToEditor === 'function' ? (id, dir) => invoke(value.exitEmbedToEditor, id, dir) : undefined,
        registerEmbedNav: typeof value.registerEmbedNav === 'function' ? (id, api) => invoke(value.registerEmbedNav, id, api) : undefined,
        viewSectionNonce: number(value.viewSectionNonce), referenceTableId: text(value.referenceTableId),
        onAddSchemaOption: typeof value.onAddSchemaOption === 'function' ? (...args) => invoke(value.onAddSchemaOption, ...args) : undefined,
        onCreateTemplate: typeof value.onCreateTemplate === 'function' ? id => invoke(value.onCreateTemplate, id) : undefined,
        onCreateFromSource: typeof value.onCreateFromSource === 'function' ? id => invoke(value.onCreateFromSource, id) : undefined,
    };
}
export function decodeNavApi(value: unknown): NavApi | null {
    if (!isRecord(value)) return null;
    const first = value.focusFirstCell;
    const last = value.focusLastCell;
    return {
        focusFirstCell: typeof first === 'function' ? (): unknown => Reflect.apply(first, value, []) : undefined,
        focusLastCell: typeof last === 'function' ? (): unknown => Reflect.apply(last, value, []) : undefined
    };
}
