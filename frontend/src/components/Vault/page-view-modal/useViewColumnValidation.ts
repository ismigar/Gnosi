import { useEffect, useEffectEvent } from 'react';
import type { ModalInput } from './useViewController';
import type { useViewStateResult } from './useViewState';
import type { useViewFieldsResult } from './useViewFields';
import type { VisibleProperty } from './types';

export function useViewColumnValidation({
    selectedTable, discoveredFields, sourceTableId, joins,
    setVisibleProperties, fieldsForTable, allTables, discoveredByTable,
    tableFields
}: Pick<
    useViewFieldsResult & useViewStateResult & ModalInput,
    'selectedTable'
    | 'discoveredFields'
    | 'sourceTableId'
    | 'joins'
    | 'setVisibleProperties'
    | 'fieldsForTable'
    | 'allTables'
    | 't'
    | 'discoveredByTable'
    | 'tableFields'
>) {
    const hydrate1 = useEffectEvent(() => {
        if (!selectedTable) return;
        // Table without a registered schema and field discovery still pending:
        // we do NOT sanitize, or we would delete valid view columns before knowing
        // which fields exist (fields arrive async via discoveredFields).
        const hasSchema = Array.isArray(selectedTable.properties) && selectedTable.properties.length > 0;
        if (!hasSchema && discoveredFields.length === 0) return;
        const involvedIds = new Set([sourceTableId, ...joins.map(j => j.tableId).filter(Boolean)]);
        setVisibleProperties(prev => {
            const next: VisibleProperty[] = [];
            for (const entry of prev) {
                // Composite form: validate (tableId, fieldKey) against the
                // involved tables' fields.
                if (entry && typeof entry === 'object' && entry.fieldKey) {
                    const tid = entry.tableId || sourceTableId;
                    if (!involvedIds.has(tid)) continue; // table removed
                    const fields = fieldsForTable(tid);
                    if (!fields.some(f => f.name === entry.fieldKey)) {
                        // Field may still be pending discovery → keep it to avoid
                        // wiping valid columns before discovery completes.
                        const tbl = allTables.find(t => t.id === tid);
                        const tHasSchema = Array.isArray(tbl?.properties) && tbl.properties.length > 0;
                        const tDiscovered = tid === sourceTableId ? discoveredFields : (discoveredByTable[tid] || []);
                        if (tHasSchema && tDiscovered.length === 0) continue; // really invalid
                    }
                    next.push(entry);
                } else if (typeof entry === 'string') {
                    // Legacy string form: validate against the base table.
                    const valid = new Set(tableFields.map(f => f.name));
                    if (valid.has(entry)) next.push(entry);
                }
            }
            // Ensure the canonical title is present (base table).
            const hasTitle = next.some(e =>
                (typeof e === 'string' && e === 'title') ||
                (e && typeof e === 'object' && e.fieldKey === 'title' && (e.tableId || sourceTableId) === sourceTableId)
            );
            if (!hasTitle) next.unshift('title');
            return next;
        });
    });
    useEffect(() => {
        let active = true;
        queueMicrotask(() => { if (active) hydrate1(); });
        return () => { active = false; };
    }, [sourceTableId, selectedTable, tableFields, discoveredFields, joins, fieldsForTable, discoveredByTable, allTables]);
    return {};
}
export type useViewColumnValidationResult = ReturnType<typeof useViewColumnValidation>;
