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
    'visibleRowsCount'
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
  const visibleRootNotes = useMemo(() => sortedNotes.slice(0, visibleRowsCount), [sortedNotes, visibleRowsCount]);
  useEffect(() => {
    setVisibleRowsCount(ROWS_BATCH_SIZE);
  }, [ROWS_BATCH_SIZE, activeView?.id, searchTerm, setVisibleRowsCount, sortedNotes.length]);
  const tableContainerRef = useRef<HTMLDivElement | null>(null);
  const groupMeta = useMemo(
    () => buildTableGroupMetadata(groupByField, schema, allNotes, idToTitle),
    [groupByField, schema, allNotes, idToTitle],
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
  const { rowVirtualizer, virtualRows, virtTotalSize } = useTableVirtualizer({
    count: rowDescriptors.length,
    getScrollElement: () => tableContainerRef.current,
    estimateSize: () => (rowHeight === 'compact' ? 40 : rowHeight === 'tall' ? 76 : 56),
  });
  const virtPaddingTop = virtualRows.length > 0 ? (virtualRows[0]?.start ?? 0) : 0;
  const virtPaddingBottom = virtualRows.length > 0
    ? virtTotalSize - (virtualRows.at(-1)?.end ?? 0)
    : 0;
  return { tableContainerRef, groupMeta, toggleGroup, rowDescriptors, rowVirtualizer, virtualRows, virtPaddingTop, virtPaddingBottom };
}
