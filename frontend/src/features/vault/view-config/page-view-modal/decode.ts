import type { FilterNode, FilterRule, FilterValue, RegistryView, ViewConfig, ViewJoin, ViewSort, VisibleProperty } from './types';
import { isFilterGroup } from './filter-tree';

export const isRecord = (value: unknown): value is Record<string, unknown> =>
    !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown) => typeof value === 'string' ? value : undefined;
const nullableText = (value: unknown) => value === null ? null : text(value);
function isFilterValue(value: unknown): value is FilterValue {
    return value === null || ['string', 'number', 'boolean'].includes(typeof value)
        || isRecord(value) || (Array.isArray(value) && value.every(item => typeof item === 'string'));
}
function rule(value: unknown): FilterRule {
    const source = isRecord(value) ? value : {};
    return {
        ...source, field: text(source.field) || '', operator: text(source.operator) || '',
        value: isFilterValue(source.value) ? source.value : undefined,
        ...(typeof source.periodPart === 'string' ? { periodPart: source.periodPart } : {})
    };
}
function node(value: unknown): FilterNode {
    if (isRecord(value) && Array.isArray(value.rules)) {
        return { conjunction: text(value.conjunction) || '', rules: value.rules.map(node) };
    }
    return rule(value);
}
function isColumn(value: unknown): value is VisibleProperty {
    return typeof value === 'string' || (isRecord(value) && typeof value.fieldKey === 'string'
        && (value.tableId == null || typeof value.tableId === 'string'));
}
function isJoin(value: unknown): value is ViewJoin {
    return isRecord(value) && typeof value.tableId === 'string' && typeof value.type === 'string'
        && typeof value.leftField === 'string' && typeof value.rightField === 'string'
        && (value.leftTableId === undefined || typeof value.leftTableId === 'string');
}
function isSort(value: unknown): value is ViewSort {
    return isRecord(value) && typeof value.field === 'string'
        && (value.direction === undefined || typeof value.direction === 'string');
}

/** Decode free-form registry extensions without dropping unconsumed plugin keys. */
export function decodeView(value: unknown): ViewConfig {
    const src = isRecord(value) ? value : {};
    const tree = node(src.filterTree);
    return {
        ...src,
        id: nullableText(src.id), name: nullableText(src.name), table_id: nullableText(src.table_id),
        source_table_id: text(src.source_table_id), type: nullableText(src.type),
        is_main: src.is_main === null || typeof src.is_main === 'boolean' ? src.is_main : undefined,
        is_default: typeof src.is_default === 'boolean' ? src.is_default : undefined,
        visibleProperties: Array.isArray(src.visibleProperties) ? src.visibleProperties.filter(isColumn) : undefined,
        joins: Array.isArray(src.joins) ? src.joins.filter(isJoin) : undefined,
        filters: Array.isArray(src.filters) ? src.filters.map(rule) : undefined,
        filterTree: isFilterGroup(tree) ? tree : undefined,
        sorts: Array.isArray(src.sorts) ? src.sorts.filter(isSort) : undefined,
        sort: isSort(src.sort) ? src.sort : undefined,
        cardSize: nullableText(src.cardSize), galleryPreview: nullableText(src.galleryPreview),
        coverField: text(src.coverField), cover_field: text(src.cover_field),
        imageFit: text(src.imageFit), image_fit: text(src.image_fit),
        groupBy: text(src.groupBy), group_by: text(src.group_by),
        groupSort: text(src.groupSort), group_sort: text(src.group_sort),
        groupSortDir: text(src.groupSortDir), group_sort_dir: text(src.group_sort_dir),
        dateField: text(src.dateField), date_field: text(src.date_field),
        endDateField: text(src.endDateField), end_date_field: text(src.end_date_field),
        calendarView: text(src.calendarView), calendar_view: text(src.calendar_view),
        colorField: text(src.colorField), color_field: text(src.color_field),
        rowHeight: text(src.rowHeight), row_height: text(src.row_height),
        summaryModel: text(src.summaryModel), summary_model: text(src.summary_model),
        chartType: text(src.chartType), chart_type: text(src.chart_type),
        xField: text(src.xField), x_field: text(src.x_field),
        yField: text(src.yField), y_field: text(src.y_field), aggregation: text(src.aggregation),
    };
}

export function decodeViews(value: unknown): RegistryView[] {
    const list: unknown = Array.isArray(value) ? value : isRecord(value) ? value.views : undefined;
    if (!Array.isArray(list)) return [];
    return list.filter(isRecord).map(value => ({ ...decodeView(value), id: text(value.id) || '' }));
}

export function decodePages(value: unknown): Record<string, unknown>[] {
    const list: unknown = Array.isArray(value) ? value : isRecord(value) ? (value.pages || value.items || []) : [];
    return Array.isArray(list) ? list.filter(isRecord) : [];
}
