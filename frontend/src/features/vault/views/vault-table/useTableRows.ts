import { tableRowKeys } from './rowKeys';
import { getFieldType } from '../../../../shared/records/model/schemaUtils';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { buildTableRowDescriptors } from './rowDescriptors';
import { buildTableGroupMetadata } from './rowTree';
import type { TableInputs } from './tableInputs';
import type { useTableData } from './useTableData';
import type { useTableIdentity } from './useTableIdentity';
import type { useTableState } from './useTableState';
import { useTableVirtualizer } from './useTableVirtualizer';

type Inputs = Pick<ReturnType<typeof useTableData>, 'sortedNotes' | 'childrenMap'>
  & Pick<ReturnType<typeof useTableState>,
    'activeCell'
    | 'visibleRowsCount'
    | 'setVisibleRowsCount'
    | 'ROWS_BATCH_SIZE'
    | 'searchTerm'
    | 'groupByField'
    | 'setExpandedGroups'
    | 'aggregations'
    | 'expandedRows'
    | 'addingSubitemFor'
    | 'expandedGroups'
    | 'rowHeight'
  >
  & Pick<TableInputs, 'activeView' | 'schema' | 'allNotes' | 'idToTitle'>
  & Pick<ReturnType<typeof useTableIdentity>, 't'>;

export function useTableRows({
  sortedNotes,
  activeCell,
  visibleRowsCount,
  setVisibleRowsCount,
  ROWS_BATCH_SIZE,
  activeView,
  searchTerm,
  groupByField,
  schema,
  allNotes,
  idToTitle,
  setExpandedGroups,
  aggregations,
  expandedRows,
  childrenMap,
  addingSubitemFor,
  expandedGroups,
  t,
  rowHeight,
}: Inputs) {
  const requiredVisibleCount = useMemo(() => {
    if (!activeCell) return visibleRowsCount;
    const parents = new Map<string, string>();
    for (const [parent, children] of Object.entries(childrenMap)) for (const child of children) parents.set(child.id, parent);
    let rootId = activeCell.rowId;
    const visited = new Set<string>();
    while (parents.has(rootId) && !visited.has(rootId)) {
      visited.add(rootId);
      rootId = parents.get(rootId) ?? rootId;
    }
    const index = sortedNotes.findIndex(note => note.id === rootId);
    return Math.max(visibleRowsCount, Math.ceil((index + 1) / ROWS_BATCH_SIZE) * ROWS_BATCH_SIZE);
  }, [ROWS_BATCH_SIZE, activeCell, childrenMap, sortedNotes, visibleRowsCount]);
  const visibleRootNotes = useMemo(() => sortedNotes.slice(0, requiredVisibleCount), [sortedNotes, requiredVisibleCount]);
  useEffect(() => {
    setVisibleRowsCount(ROWS_BATCH_SIZE);
  }, [ROWS_BATCH_SIZE, activeView?.id, searchTerm, setVisibleRowsCount]);
  useEffect(() => {
    if (requiredVisibleCount > visibleRowsCount) setVisibleRowsCount(requiredVisibleCount);
  }, [requiredVisibleCount, setVisibleRowsCount, visibleRowsCount]);
  const tableContainerRef = useRef<HTMLDivElement | null>(null);
  const groupMeta = useMemo(
    () => {
      const result = buildTableGroupMetadata(groupByField, schema, allNotes, idToTitle);
      return result && getFieldType(schema, groupByField) === 'checkbox'
        ? { ...result, labelMap: { true: t('common.yes', 'Yes'), false: t('common.no', 'No') } }
        : result;
    },
    [groupByField, schema, allNotes, idToTitle, t],
  );
  const toggleGroup = useCallback((groupKey: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(groupKey)) next.delete(groupKey); else next.add(groupKey);
      return next;
    });
  }, [setExpandedGroups]);
  useEffect(() => { setExpandedGroups(new Set()); }, [activeView?.id, groupByField, setExpandedGroups]);
  const hasGroupAggregations = useMemo(
    () => Object.values(aggregations).some(f => f && f !== 'none'),
    [aggregations]
  );
  const rowDescriptors = useMemo(() => buildTableRowDescriptors({
    groupByField, groupMeta, visibleRootNotes, sortedNotes, expandedRows,
    childrenMap, addingSubitemFor, expandedGroups, hasGroupAggregations,
    activeView,
    emptyGroupLabel: t('table.no_group_value', 'No value'),
  }), [groupByField, groupMeta, visibleRootNotes, sortedNotes, expandedRows, childrenMap, addingSubitemFor, expandedGroups, hasGroupAggregations, activeView, t]);
  const formulaRows = useMemo(() => buildTableRowDescriptors({
    groupByField, groupMeta, visibleRootNotes: sortedNotes, sortedNotes, expandedRows,
    childrenMap, addingSubitemFor, expandedGroups, hasGroupAggregations, activeView,
    emptyGroupLabel: t('table.no_group_value', 'No value'),
  }).flatMap(descriptor => descriptor.kind === 'row' ? [descriptor.note] : []),
  [groupByField, groupMeta, sortedNotes, expandedRows, childrenMap, addingSubitemFor, expandedGroups, hasGroupAggregations, activeView, t]);
  const rowKeys = useMemo(() => tableRowKeys(rowDescriptors), [rowDescriptors]);
  const getItemKey = useCallback((index: number) => rowKeys[index] ?? index, [rowKeys]);
  const { rowVirtualizer, virtualRows, virtTotalSize } = useTableVirtualizer({
    getItemKey,
    count: rowDescriptors.length,
    getScrollElement: () => tableContainerRef.current,
    estimateSize: () => (rowHeight === 'compact' ? 40 : rowHeight === 'tall' ? 76 : 56),
  });
  const virtPaddingTop = virtualRows.length > 0 ? (virtualRows[0]?.start ?? 0) : 0;
  const virtPaddingBottom = virtualRows.length > 0
    ? virtTotalSize - (virtualRows.at(-1)?.end ?? 0)
    : virtTotalSize;
  return { formulaRows, tableContainerRef, groupMeta, toggleGroup, rowDescriptors, rowVirtualizer, virtualRows, virtPaddingTop, virtPaddingBottom };
}
