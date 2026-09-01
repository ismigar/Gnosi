import { useCallback, useEffect, useMemo, useRef } from 'react';
import { getTableFocusTarget } from '../tableRecordFocusUtils';
import { displayString } from './fieldConfig';
import { keyboardOwnership } from './keyboardOwnership';
import { getTableRecordFocusPreparation as prepareTableRecordFocus } from '../tableRecordFocusUtils';
import { tableCell } from './cellValues';
import type { TableInputs } from './tableInputs';
import type { NavigationRow, RowDescriptor, SelectionRect, TableNote } from './types';
import { useLatestRef } from './useLatestRef';
import type { useTableColumns } from './useTableColumns';
import type { useTableData } from './useTableData';
import type { useTableIdentity } from './useTableIdentity';
import type { useTableOptimistic } from './useTableOptimistic';
import type { useTableRows } from './useTableRows';
import type { useTableState } from './useTableState';

type Inputs = Pick<ReturnType<typeof useTableRows>, 'rowDescriptors' | 'groupMeta' | 'rowVirtualizer' | 'tableContainerRef'>
  & Pick<ReturnType<typeof useTableColumns>, 'gridColumns'>
  & Pick<TableInputs, 'restoreRecordFocus' | 'onRecordFocusRestored' | 'activeView'>
  & Pick<ReturnType<typeof useTableOptimistic>, 'safeNotes'>
  & Pick<ReturnType<typeof useTableData>, 'sortedNotes' | 'enableSubitems' | 'sortSignature'>
  & Pick<ReturnType<typeof useTableState>,
    'expandedRows'
    | 'groupByField'
    | 'expandedGroups'
    | 'visibleRowsCount'
    | 'ROWS_BATCH_SIZE'
    | 'setExpandedRows'
    | 'setVisibleRowsCount'
    | 'setExpandedGroups'
    | 'setAnchorCell'
    | 'setActiveCell'
    | 'activeCell'
    | 'anchorCell'
    | 'searchTerm'
    | 'activeCellRef'
  >
  & Pick<ReturnType<typeof useTableIdentity>, 'claimKeyboard' | 'gridInstanceIdRef'>;

export function useTableNavigation({
  rowDescriptors,
  gridColumns,
  restoreRecordFocus,
  safeNotes,
  sortedNotes,
  enableSubitems,
  expandedRows,
  groupByField,
  groupMeta,
  expandedGroups,
  visibleRowsCount,
  ROWS_BATCH_SIZE,
  onRecordFocusRestored,
  setExpandedRows,
  setVisibleRowsCount,
  setExpandedGroups,
  claimKeyboard,
  setAnchorCell,
  setActiveCell,
  rowVirtualizer,
  tableContainerRef,
  activeCell,
  anchorCell,
  activeView,
  searchTerm,
  sortSignature,
  gridInstanceIdRef,
  activeCellRef,
}: Inputs) {
  const navRows = useMemo(() => {
    const out: NavigationRow[] = [];
    rowDescriptors.forEach((d, i) => {
      if (d.kind === 'row') out.push({ id: d.note.id, descriptorIndex: i });
    });
    return out;
  }, [rowDescriptors]);
  const navRowIndexById = useMemo(() => {
    const m = new Map<string, number>();
    navRows.forEach((r, i) => m.set(r.id, i));
    return m;
  }, [navRows]);
  const colIndexByKey = useMemo(() => {
    const m = new Map<string, number>();
    gridColumns.forEach((c, i) => m.set(c.key, i));
    return m;
  }, [gridColumns]);
  const navRowsRef = useLatestRef<NavigationRow[]>(navRows);
  const rowDescriptorsRef = useLatestRef<RowDescriptor[]>(rowDescriptors);
  const restoredRecordFocusRequestRef = useRef<string | number | null>(null);
  const scheduledRecordFocusRequestRef = useRef<string | number | null>(null);
  useEffect(() => {
    const recordId = restoreRecordFocus?.recordId;
    const requestId = restoreRecordFocus?.requestId;
    if (
      !recordId
      || requestId == null
      || restoredRecordFocusRequestRef.current === requestId
      || scheduledRecordFocusRequestRef.current === requestId
    ) return undefined;

    const preparation = prepareTableRecordFocus({
      recordId,
      notes: safeNotes,
      sortedNotes,
      enableSubitems,
      expandedRows,
      groupByField,
      groupFieldId: groupMeta?.fieldId,
      expandedGroups,
      visibleRowsCount,
      batchSize: ROWS_BATCH_SIZE,
    });
    if (preparation.status === 'missing') {
      if (safeNotes.length > 0) {
        restoredRecordFocusRequestRef.current = requestId;
        onRecordFocusRestored?.(requestId);
      }
      return undefined;
    }
    if (preparation.status === 'expand-parent') {
      setExpandedRows(current => new Set(current).add(displayString(preparation.parentId)));
      return undefined;
    }
    if (preparation.status === 'load-batch') {
      setVisibleRowsCount(preparation.requiredCount);
      return undefined;
    }
    if (preparation.status === 'expand-group') {
      setExpandedGroups(current => new Set(current).add(preparation.groupKey));
      return undefined;
    }

    const targetRow = navRows.find(row => row.id === recordId);
    if (!targetRow) return undefined;

    scheduledRecordFocusRequestRef.current = requestId;
    claimKeyboard();
    setAnchorCell(null);
    setActiveCell({ rowId: recordId, field: 'title' });
    rowVirtualizer.scrollToIndex(targetRow.descriptorIndex, { align: 'center' });

    let attempts = 0;
    let stableChecks = 0;
    const findRenderedCell = () => Array.from(tableContainerRef.current?.querySelectorAll<HTMLElement>('[data-title-cell]') || [])
      .find(element => element.dataset.titleCell === recordId);
    const stabilizeRenderedCellFocus = () => {
      const cell = findRenderedCell();
      const activeElement = document.activeElement;
      if (cell && activeElement && activeElement !== document.body && activeElement !== cell) {
        scheduledRecordFocusRequestRef.current = null;
        return;
      }

      if (cell && activeElement === cell) {
        stableChecks += 1;
      } else if (cell) {
        cell.focus({ preventScroll: true });
        stableChecks = 0;
      }

      if (cell && stableChecks >= 2) {
        restoredRecordFocusRequestRef.current = requestId;
        scheduledRecordFocusRequestRef.current = null;
        onRecordFocusRestored?.(requestId);
        return;
      }

      attempts += 1;
      if (attempts < 12) {
        setTimeout(stabilizeRenderedCellFocus, 50);
      } else {
        scheduledRecordFocusRequestRef.current = null;
      }
    };
    setTimeout(stabilizeRenderedCellFocus, 0);
    return undefined;
  }, [ROWS_BATCH_SIZE, claimKeyboard, enableSubitems, expandedGroups, expandedRows, groupByField, groupMeta, navRows, onRecordFocusRestored, restoreRecordFocus, rowVirtualizer, safeNotes, setActiveCell, setAnchorCell, setExpandedGroups, setExpandedRows, setVisibleRowsCount, sortedNotes, tableContainerRef, visibleRowsCount]);
  const focusGroupHeaderByOffset = (fromDescriptorIndex: number, delta: number) => {
    const list = rowDescriptorsRef.current;
    for (let i = fromDescriptorIndex + delta;i >= 0 && i < list.length;i += delta) {
      if (list[i]?.kind === 'group-header') {
        rowVirtualizer.scrollToIndex(i);
        const el = tableContainerRef.current?.querySelector<HTMLElement>(
          `[data-index="${String(i)}"] button`);
        el?.focus({ preventScroll: true });
        return true;
      }
    }
    return false;
  };
  const gridColumnsRef = useLatestRef(gridColumns);
  const focusFirstRowOfGroup = useCallback((groupDescriptorIndex: number) => {
    const list = rowDescriptorsRef.current;
    for (let i = groupDescriptorIndex + 1;i < list.length;i++) {
      const d = list[i];
      if (!d) continue;
      if (d.kind === 'group-header') return false; // empty group
      if (d.kind === 'row') {
        setActiveCell({ rowId: d.note.id, field: gridColumnsRef.current[0]?.key || 'title' });
        rowVirtualizer.scrollToIndex(i);
        return true;
      }
    }
    return false;
  }, [gridColumnsRef, rowDescriptorsRef, rowVirtualizer, setActiveCell]);
  const pendingEnterGroupDescRef = useRef<number | null>(null);
  useEffect(() => {
    const di = pendingEnterGroupDescRef.current;
    if (di === null) return;
    pendingEnterGroupDescRef.current = null;
    const raf = requestAnimationFrame(() => focusFirstRowOfGroup(di));
    return () => { cancelAnimationFrame(raf); };
  }, [rowDescriptors, expandedGroups, focusFirstRowOfGroup]);

  const navRowIndexByIdRef = useLatestRef<Map<string, number>>(navRowIndexById);
  const colIndexByKeyRef = useLatestRef<Map<string, number>>(colIndexByKey);
  const noteById = useMemo(() => {
    const m = new Map<string, TableNote>();
    for (const n of safeNotes) m.set(n.id, n);
    return m;
  }, [safeNotes]);
  const selectionRect = useMemo(() => {
    if (!activeCell) return null;
    const aRow = navRowIndexById.get(activeCell.rowId);
    const aCol = colIndexByKey.get(activeCell.field);
    if (aRow == null || aCol == null) return null;
    if (!anchorCell) return { r0: aRow, c0: aCol, r1: aRow, c1: aCol };
    const bRow = navRowIndexById.get(anchorCell.rowId);
    const bCol = colIndexByKey.get(anchorCell.field);
    if (bRow == null || bCol == null) return { r0: aRow, c0: aCol, r1: aRow, c1: aCol };
    return {
      r0: Math.min(aRow, bRow), c0: Math.min(aCol, bCol),
      r1: Math.max(aRow, bRow), c1: Math.max(aCol, bCol),
    };
  }, [activeCell, anchorCell, navRowIndexById, colIndexByKey]);
  const selectionRectRef = useLatestRef<SelectionRect | null>(selectionRect);
  const getCellSelState = useCallback((rowId: string, field: string) => {
    if (!selectionRect) return { isActive: false, inRange: false };
    const r = navRowIndexById.get(rowId);
    const c = colIndexByKey.get(field);
    if (r == null || c == null) return { isActive: false, inRange: false };
    const inRange = r >= selectionRect.r0 && r <= selectionRect.r1 && c >= selectionRect.c0 && c <= selectionRect.c1;
    const isActive = !!activeCell && activeCell.rowId === rowId && activeCell.field === field;
    return { isActive, inRange };
  }, [selectionRect, navRowIndexById, colIndexByKey, activeCell]);
  const initializedViewRef = useRef<string | null>(null);
  useEffect(() => {
    const viewKey = `${String(activeView?.id)}|${searchTerm}|${sortSignature}`;
    if (initializedViewRef.current === viewKey) return;
    if (navRows.length === 0 || gridColumns.length === 0) return; // waits for the data
    if (keyboardOwnership.owner && keyboardOwnership.owner !== gridInstanceIdRef.current) return;
    initializedViewRef.current = viewKey;
    keyboardOwnership.owner = gridInstanceIdRef.current;
    setAnchorCell(null);
    const focusTarget = tableCell(getTableFocusTarget({
      activeCell: activeCellRef.current,
      navRows,
      gridColumns,
    }));
    const preservesActiveCell = focusTarget?.rowId === activeCellRef.current?.rowId
      && focusTarget?.field === activeCellRef.current?.field;
    if (groupByField && !preservesActiveCell) {
      const firstGroupIdx = rowDescriptors.findIndex(d => d.kind === 'group-header');
      if (firstGroupIdx >= 0) {
        rowVirtualizer.scrollToIndex(firstGroupIdx);
        requestAnimationFrame(() => {
          tableContainerRef.current?.querySelector<HTMLElement>(`[data-index="${String(firstGroupIdx)}"] button`)?.focus({ preventScroll: true });
        });
        return;
      }
    }
    if (focusTarget) {
      setActiveCell(focusTarget);
      if (preservesActiveCell) {
        const targetRow = navRows.find(row => row.id === focusTarget.rowId);
        if (targetRow?.descriptorIndex != null) {
          rowVirtualizer.scrollToIndex(targetRow.descriptorIndex, { align: 'center' });
          requestAnimationFrame(() => {
            const selector = `[data-title-cell="${CSS.escape(focusTarget.rowId)}"]`;
            tableContainerRef.current?.querySelector<HTMLElement>(selector)?.focus({ preventScroll: true });
          });
        }
      }
    }
  }, [activeView?.id, searchTerm, sortSignature, navRows, gridColumns, groupByField, rowDescriptors, rowVirtualizer, gridInstanceIdRef, setAnchorCell, activeCellRef, tableContainerRef, setActiveCell]);
  return { navRows, navRowIndexById, colIndexByKey, navRowsRef, focusGroupHeaderByOffset, focusFirstRowOfGroup, pendingEnterGroupDescRef, gridColumnsRef, navRowIndexByIdRef, colIndexByKeyRef, noteById, selectionRect, selectionRectRef, getCellSelState };
}
