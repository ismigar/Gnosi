import { useMemo } from 'react';
import { buildSchemaFromTableProperties } from '../../../../shared/records/model/schemaUtils';
import { normalizeVisibleColumns } from './joins';
import { isFilterGroup } from './decode';
import { applyFilterNode, multiKeySort, searchRows, countRules } from './filter-model';
import type { EmbedInputs } from './inputs';
export function useEmbedDerived({ view, tableViews, activeViewId, headingProp, headingLevelProp, rawRecords, pageId, searchTerm, ctx, t }: EmbedInputs) {
    const tableId = view?.source_table_id || view?.table_id;

    // The EFFECTIVE view = the active tab (of the table) or, by default, the
    // the block's section. Columns, type, filters, and sorting all come from it.
    const effectiveView = useMemo(() => {
        const fromTab = tableViews.find(v => v.id === activeViewId);
        return fromTab || view || null;
    }, [tableViews, activeViewId, view]);

    const columns = useMemo(
        () => effectiveView?.visibleProperties || effectiveView?.visible_properties || effectiveView?.columns || ['title'],
        [effectiveView],
    );
    // Normalize to composite form so we know which table each column belongs to
    // (for joined columns and header disambiguation). `columnSpec` parallels the
    // raw `columns` array (1:1, same order). Renderers still receive `columns`
    // as plain field keys for backward compatibility; joined values are already
    // merged into each row's metadata by `applyClientJoins`, so `metadata[key]`
    // resolves transparently for non-colliding field names.
    const columnSpec = useMemo(
        () => normalizeVisibleColumns(columns, tableId),
        [columns, tableId],
    );
    const columnsAsKeys = useMemo(
        () => columnSpec.map(c => c.fieldKey),
        [columnSpec],
    );
    const rawType = (effectiveView?.view_type || effectiveView?.type || 'table').toLowerCase();
    const viewType = rawType === 'db_view' ? 'table' : rawType;
    const activeFilterCount = useMemo(() => {
        if (isFilterGroup(effectiveView?.filterTree)) {
            return countRules(effectiveView.filterTree);
        }
        return effectiveView?.filters?.length || (effectiveView?.filter ? 1 : 0);
    }, [effectiveView]);
    // The title/heading is carried by the block's section (it doesn't change with the tab).
    const displayHeading = headingProp || view?.heading;
    const displayLevel = headingLevelProp || view?.heading_level || 1;

    // Derived rows: raw records filtered by the effective view (with the
    // `this` value → pageId) and sorted. Reacts when switching tabs
    // without a refetch (same table).
    const allRows = useMemo(() => {
        // Prefer the nested `filterTree` (complex AND/OR groups); fall back to the
        // legacy flat `filters`/`filter` (AND). Parity with the main view
        // (viewMatchesFilters) and the backend snapshot (resolve_rows).
        const tree = isFilterGroup(effectiveView?.filterTree)
            ? effectiveView.filterTree
            : {
                conjunction: 'and',
                rules: (effectiveView?.filters && effectiveView.filters.length > 0)
                    ? effectiveView.filters
                    : (effectiveView?.filter ? [effectiveView.filter] : []),
            };
        const filtered = rawRecords.filter(r => applyFilterNode(r, pageId, tree));
        const sorts = (effectiveView?.sorts && effectiveView.sorts.length > 0)
            ? effectiveView.sorts
            : (effectiveView?.sort ? [effectiveView.sort] : []);
        return multiKeySort(filtered, sorts);
    }, [rawRecords, effectiveView, pageId]);
    const rows = useMemo(() => searchRows(allRows, searchTerm), [allRows, searchTerm]);
    const table = ctx.registry.tables.find(t => t.id === String(tableId)) || null;
    const embeddedSchema = useMemo(() => {
        const props = [...(table?.properties || [])];
        if (effectiveView?.joins && Array.isArray(effectiveView.joins)) {
            const allTbls = ctx.registry.tables;
            effectiveView.joins.forEach(j => {
                const jt = allTbls.find(t => t.id === String(j.tableId));
                if (jt && jt.properties) {
                    jt.properties.forEach(p => {
                        if (!props.some(x => x.name === p.name)) {
                            props.push(p);
                        }
                    });
                }
            });
        }
        return buildSchemaFromTableProperties(props);
    }, [table, effectiveView, ctx.registry.tables]);
    // The embedded section → the "view" model that VaultTable expects. The filters
    // (including `this` → pageId) and sorting are ALREADY applied to `rows`, so
    // we don't pass them again as filters (VaultTable doesn't know how to resolve `this`);
    // editing filters/sorting is delegated to the configuration modal of
    // the embed (onEditSchema('filters'|'sorts') → handleOpenConfig).
    const embeddedView = useMemo(() => ({
        id: effectiveView?.id || effectiveView?.view_id || 'embedded',
        name: effectiveView?.name || effectiveView?.heading || t('views_header.default_view_name', "View"),
        type: viewType === 'list' ? 'list' : 'table',
        filters: [],
        sort: (effectiveView?.sorts && effectiveView.sorts.length) ? effectiveView.sorts : (effectiveView?.sort ? [effectiveView.sort] : []),
        visibleProperties: columnsAsKeys,
        // Reflects the real signal: if the active tab is the MAIN view,
        // the table shows the entire live schema; otherwise, it respects visibleProperties.
        is_main: !!(effectiveView?.is_main || effectiveView?.is_default),
        // Type-specific options (gallery/kanban/calendar/timeline). In the
        // embed props were lost; we propagate them from the effective view (registry
        // or section) so the render honors them the same as on the table page.
        cardSize: effectiveView?.cardSize,
        galleryPreview: effectiveView?.galleryPreview,
        coverField: effectiveView?.coverField || effectiveView?.cover_field,
        imageFit: effectiveView?.imageFit || effectiveView?.image_fit,
        groupBy: effectiveView?.groupBy || effectiveView?.group_by,
        groupSort: effectiveView?.groupSort || effectiveView?.group_sort,
        groupSortDir: effectiveView?.groupSortDir || effectiveView?.group_sort_dir,
        dateField: effectiveView?.dateField || effectiveView?.date_field,
        endDateField: effectiveView?.endDateField || effectiveView?.end_date_field,
        calendarView: effectiveView?.calendarView || effectiveView?.calendar_view,
        colorField: effectiveView?.colorField || effectiveView?.color_field,
        rowHeight: effectiveView?.rowHeight || effectiveView?.row_height,
        enableSubitems: effectiveView?.enableSubitems ?? effectiveView?.enable_subitems,
        columnWidths: effectiveView?.columnWidths || effectiveView?.column_widths,
        // Chart options (embedded 'chart' view).
        chartType: effectiveView?.chartType || effectiveView?.chart_type,
        xField: effectiveView?.xField || effectiveView?.x_field,
        yField: effectiveView?.yField || effectiveView?.y_field,
        aggregation: effectiveView?.aggregation,
    }), [effectiveView, viewType, columnsAsKeys, t]);
    return { tableId, effectiveView, columns, columnSpec, columnsAsKeys, viewType, activeFilterCount, displayHeading, displayLevel, allRows, rows, table, embeddedSchema, embeddedView };
}
export type EmbedDerived = ReturnType<typeof useEmbedDerived>;
