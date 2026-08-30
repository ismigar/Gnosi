import { useMemo, useCallback } from 'react';
import { KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import type { ModalInput } from './useViewController';
import type { useViewFieldsResult } from './useViewFields';
import type { Field } from './types';

export function useViewFieldLabels({
    t, isMultiTable, viewTables, tableFields,
    fieldsForTable
}: Pick<
    ModalInput & useViewFieldsResult,
    't'
    | 'isMultiTable'
    | 'viewTables'
    | 'tableFields'
    | 'fieldsForTable'
>) {
    const dndSensors = useSensors(
        useSensor(PointerSensor),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
    );

    // A field's visible label: the canonical `title` is translated ("Title") and
    // the rest are shown with the first letter capitalized (names with
    // leading emoji/accents are kept intact).
    const capitalizeFirst = (s: string) => {
        const str = s || '';
        return str ? str.charAt(0).toUpperCase() + str.slice(1) : str;
    };
    const fieldLabel = useCallback((name: string) => (
        name === 'title' ? t('view.column_title', { defaultValue: "Title" }) : capitalizeFirst(name)
    ), [t]);

    const allTableFields = useMemo(() => {
        if (!isMultiTable || viewTables.length <= 1) return tableFields;
        const seen = new Set();
        const result: Field[] = [];
        viewTables.forEach(tbl => {
            const fields = fieldsForTable(tbl.id);
            fields.forEach(f => {
                const key = f.name;
                if (!seen.has(key)) {
                    seen.add(key);
                    result.push({
                        ...f,
                        displayName: `${String(tbl.name)} · ${fieldLabel(f.name)}`
                    });
                }
            });
        });
        return result;
    }, [isMultiTable, viewTables, tableFields, fieldsForTable, fieldLabel]);

    // Field pickers (filters, sorting, grouping, per-type controls) list the fields
    // alphabetically by their visible label: with dozens of properties the schema
    // order is unusable to find one. `tableFields` keeps its own order because it
    // also feeds the visible-columns list, where the order IS the user's column order.
    const sortedTableFields = useMemo(
        () => [...allTableFields].sort((a, b) => {
            const labelA = a.displayName || fieldLabel(a.name);
            const labelB = b.displayName || fieldLabel(b.name);
            return labelA.localeCompare(labelB, undefined, { sensitivity: 'base' });
        }),
        [allTableFields, fieldLabel]
    );
    return { dndSensors, capitalizeFirst, fieldLabel, allTableFields, sortedTableFields };
}
export type useViewFieldLabelsResult = ReturnType<typeof useViewFieldLabels>;
