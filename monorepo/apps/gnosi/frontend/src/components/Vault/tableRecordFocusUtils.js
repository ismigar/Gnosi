const EMPTY_GROUP_KEY = ' empty';

export function getTableFocusTarget({ activeCell, navRows, gridColumns }) {
    const hasActiveRow = activeCell && (navRows || []).some(row => row.id === activeCell.rowId);
    const hasActiveColumn = activeCell && (gridColumns || []).some(column => column.key === activeCell.field);
    if (hasActiveRow && hasActiveColumn) return activeCell;

    const firstRow = navRows?.[0];
    const firstColumn = gridColumns?.[0];
    if (!firstRow || !firstColumn) return null;
    return { rowId: firstRow.id, field: firstColumn.key };
}

export function getTableRecordFocusPreparation({
    recordId,
    notes,
    sortedNotes,
    enableSubitems,
    expandedRows,
    groupByField,
    groupFieldId,
    expandedGroups,
    visibleRowsCount,
    batchSize,
}) {
    const target = (notes || []).find(note => note.id === recordId);
    if (!target) return { status: 'missing' };

    const parentId = enableSubitems
        ? (target.metadata?.parent_id || target.parent_id || target.metadata?.source_parent_id || null)
        : null;
    if (parentId && !expandedRows?.has(parentId)) {
        return { status: 'expand-parent', parentId };
    }

    const rootRecordId = parentId || recordId;
    const rootIndex = (sortedNotes || []).findIndex(note => note.id === rootRecordId);
    if (!groupByField && rootIndex >= visibleRowsCount) {
        return {
            status: 'load-batch',
            requiredCount: Math.ceil((rootIndex + 1) / batchSize) * batchSize,
        };
    }

    if (groupByField) {
        const metadata = target.metadata || {};
        const rawValue = Object.prototype.hasOwnProperty.call(metadata, groupByField)
            ? metadata[groupByField]
            : groupFieldId ? metadata[groupFieldId] : undefined;
        const firstValue = Array.isArray(rawValue) ? rawValue[0] : rawValue;
        const groupKey = firstValue === null || firstValue === undefined || String(firstValue).trim() === ''
            ? EMPTY_GROUP_KEY
            : String(firstValue).trim();
        if (!expandedGroups?.has(groupKey)) {
            return { status: 'expand-group', groupKey };
        }
    }

    return { status: 'ready' };
}
