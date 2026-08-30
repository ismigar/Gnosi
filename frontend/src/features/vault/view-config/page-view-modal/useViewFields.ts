import { useMemo, useCallback } from 'react';
import { MAIN_VIEW_NAME } from '../../views/viewConstants';
import type { ModalInput } from './useViewController';
import type { useViewStateResult } from './useViewState';
import type { Field, VisibleProperty } from './types';

export function useViewFields({
    allTables, sourceTableId, discoveredFields, joins,
    discoveredByTable, visibleProperties
}: Pick<
    ModalInput & useViewStateResult,
    'allTables'
    | 'sourceTableId'
    | 'discoveredFields'
    | 'joins'
    | 't'
    | 'discoveredByTable'
    | 'visibleProperties'
>) {
    const selectedTable = useMemo(
        () => allTables.find(tbl => tbl.id === sourceTableId),
        [allTables, sourceTableId]
    );
    const sourceTableName = selectedTable?.name || MAIN_VIEW_NAME;

    const tableFields = useMemo(() => {
        // A title column from the schema (the property of type `title`
        // from a table imported from Notion, e.g. "Nom"/"Título", or a field
        // literally named title/títol/titulo/titre) IS the title of the
        // page. The system already exposes it as the canonical `title` field, which the
        // renderer reads from `r.title`. The previous detection, based only on
        // unaccented names, didn't recognize `Título` (with í) nor the columns
        // of type `title` with a different name (`Nom`), and it ended up showing TWO
        // title columns; moreover, the column with its own name wasn't even
        // rendered (its value isn't in `metadata`, but in `title`).
        // That's why we exclude all title columns from the schema and leave
        // a single canonical `title`.
        const isTitleField = (p: Field) => {
            if ((p.type || '').trim().toLowerCase() === 'title') return true;
            const n = (p.name || '').trim().toLowerCase();
            return n === 'title' || n === 'títol' || n === 'titulo' || n === 'título' || n === 'titre';
        };
        const props: Field[] = (selectedTable?.properties || [])
            .filter(p => !isTitleField(p))
            .map(p => ({
                name: p.name,
                type: p.type,
                relation_database_id: p.relation_database_id,
                options: p.config?.options || p.options || [],
            }));
        props.unshift({ name: 'title', type: 'title' });
        // Merges the fields discovered in records that the registered schema does NOT
        // contain (tables without `properties`, like "Recursos"). They are marked as
        // `text` (unknown type) and go at the end, after the schema.
        const known = new Set(props.map(p => (p.name || '').toLowerCase()));
        for (const name of discoveredFields) {
            if (known.has(name.toLowerCase())) continue;
            props.push({ name, type: 'text' });
            known.add(name.toLowerCase());
        }
        return props;
    }, [selectedTable, discoveredFields]);

    // --- Multi-table helpers ----------------------------------------------
    // Tables involved in this view: the base table followed by each join's
    // target table, in chain order. Used to build the per-table field picker
    // and to drive the joins UI.
    const viewTables = useMemo(() => {
        const ids = [sourceTableId, ...joins.map(j => j.tableId).filter(Boolean)];
        return ids
            .filter((id, i, arr) => id && arr.indexOf(id) === i) // dedupe, keep order
            .map(id => allTables.find(t => t.id === id))
            .filter(item => item !== undefined);
    }, [sourceTableId, joins, allTables]);

    // Is this view multi-table? Drives whether `visibleProperties` is stored
    // in the composite form (`{ tableId, fieldKey }`) vs. plain strings.
    const isMultiTable = joins.length > 0;

    // Computes the field list for an arbitrary table (same merge logic as
    // `tableFields`: schema properties, excluding duplicate title columns, plus
    // discovered fields for tables without a schema). The base table reuses
    // the cached `tableFields`/`discoveredFields`.
    const fieldsForTable = useCallback((tid: string) => {
        if (!tid) return [];
        if (tid === sourceTableId) return tableFields;
        const tbl = allTables.find(t => t.id === tid);
        if (!tbl) return [];
        const isTitleField = (p: Field) => {
            if ((p.type || '').trim().toLowerCase() === 'title') return true;
            const n = (p.name || '').trim().toLowerCase();
            return n === 'title' || n === 'títol' || n === 'titulo' || n === 'título' || n === 'titre';
        };
        const props: Field[] = (tbl.properties || [])
            .filter(p => !isTitleField(p))
            .map(p => ({
                name: p.name,
                type: p.type,
                relation_database_id: p.relation_database_id,
                options: p.config?.options || p.options || [],
            }));
        props.unshift(
            { name: 'id', type: 'text', label: 'ID (Identificador)' },
            { name: 'title', type: 'title' }
        );
        const known = new Set(props.map(p => (p.name || '').toLowerCase()));
        for (const name of (discoveredByTable[tid] || [])) {
            if (known.has(name.toLowerCase())) continue;
            props.push({ name, type: 'text' });
            known.add(name.toLowerCase());
        }
        return props;
    }, [sourceTableId, tableFields, allTables, discoveredByTable]);

    const fieldMeta = useMemo(() => {
        const m: Record<string, Field | undefined> = {};
        if (isMultiTable && viewTables.length > 0) {
            viewTables.forEach(tbl => {
                const fields = fieldsForTable(tbl.id);
                fields.forEach(f => {
                    if (!m[f.name]) m[f.name] = f;
                });
            });
        } else {
            tableFields.forEach(f => { m[f.name] = f; });
        }
        return m;
    }, [isMultiTable, viewTables, fieldsForTable, tableFields]);

    // Normalizes `visibleProperties` (which may be a list of strings or of
    // `{tableId, fieldKey, label}`) into the composite form. Strings are
    // treated as fields of the base table.
    const normalizeColumns = useCallback((cols: readonly VisibleProperty[]) => {
        if (!cols.length) {
            return [{ tableId: sourceTableId, fieldKey: 'title' }];
        }
        return cols.map(c => {
            if (typeof c === 'string') return { tableId: sourceTableId, fieldKey: c };
            if (c.fieldKey) {
                return { tableId: c.tableId || sourceTableId, fieldKey: c.fieldKey, label: c.label };
            }
            return null;
        }).filter(item => item != null);
    }, [sourceTableId]);

    // When the view is multi-table, `visibleProperties` is stored in composite
    // form; when single-table, plain strings (full back-compat). This helper
    // builds the value to persist from the current normalized state.
    const visiblePropertiesToPersist = useMemo(() => {
        if (!isMultiTable) {
            // Single-table: plain strings of the base table (legacy form).
            return normalizeColumns(visibleProperties)
                .filter(c => c.tableId === sourceTableId)
                .map(c => c.fieldKey);
        }
        return normalizeColumns(visibleProperties);
    }, [isMultiTable, visibleProperties, sourceTableId, normalizeColumns]);

    return {
        selectedTable, sourceTableName, tableFields, viewTables,
        isMultiTable, fieldsForTable, fieldMeta, normalizeColumns,
        visiblePropertiesToPersist
    };
}
export type useViewFieldsResult = ReturnType<typeof useViewFields>;
