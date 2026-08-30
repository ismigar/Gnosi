import { useCallback } from 'react';
import { notifyError } from '../../../../shared/notifications/notifyError';
import { transportFetch } from '../../../../shared/api/transports';
import { clampIndex, isComputedType } from '../../properties/cellGridUtils';
import { getFieldType } from '../../../../shared/records/model/schemaUtils';
import { displayString, isRecord } from './fieldConfig';
import { getMetaKey } from './metadata';
import type { TableInputs } from './tableInputs';
import type { useTableData } from './useTableData';
import type { useTableEntry } from './useTableEntry';
import type { useTableIdentity } from './useTableIdentity';
import type { useTableMedia } from './useTableMedia';
import type { useTableNavigation } from './useTableNavigation';
import type { useTableOptimistic } from './useTableOptimistic';
import type { useTableRows } from './useTableRows';
import type { useTableSave } from './useTableSave';
import type { useTableState } from './useTableState';

type Inputs = Pick<ReturnType<typeof useTableState>,
  'activeCellRef'
  | 'anchorCellRef'
  | 'visibleRowsCount'
  | 'columnWidthsRef'
  | 'setAnchorCell'
  | 'setActiveCell'
  | 'titlePreviewRef'
  | 'setEditInitial'
  | 'setEditingCell'
>
  & Pick<ReturnType<typeof useTableNavigation>,
    'navRowsRef'
    | 'gridColumnsRef'
    | 'navRowIndexByIdRef'
    | 'colIndexByKeyRef'
    | 'noteById'
    | 'navRowIndexById'
    | 'colIndexByKey'
    | 'navRows'
  >
  & Pick<ReturnType<typeof useTableData>, 'sortedNotes'>
  & Pick<ReturnType<typeof useTableEntry>, 'handleLoadMoreRows'>
  & Pick<ReturnType<typeof useTableRows>, 'rowVirtualizer' | 'tableContainerRef'>
  & Pick<ReturnType<typeof useTableOptimistic>, 'safeNotes' | 'setOptimisticTitles'>
  & Pick<TableInputs, 'schema' | 'onCellSaved'>
  & Pick<ReturnType<typeof useTableMedia>, 'isImageField' | 'openMediaPicker'>
  & Pick<ReturnType<typeof useTableSave>, 'handleCellSave'>
  & Pick<ReturnType<typeof useTableIdentity>, 't'>;

export function useTableCursor({
  activeCellRef,
  anchorCellRef,
  navRowsRef,
  gridColumnsRef,
  navRowIndexByIdRef,
  colIndexByKeyRef,
  sortedNotes,
  visibleRowsCount,
  handleLoadMoreRows,
  rowVirtualizer,
  tableContainerRef,
  columnWidthsRef,
  setAnchorCell,
  setActiveCell,
  safeNotes,
  titlePreviewRef,
  setEditInitial,
  setEditingCell,
  schema,
  isImageField,
  openMediaPicker,
  handleCellSave,
  noteById,
  setOptimisticTitles,
  onCellSaved,
  t,
  navRowIndexById,
  colIndexByKey,
  navRows,
}: Inputs) {
  const moveCursor = useCallback((dRow: number, dCol: number, extend: boolean) => {
    const prev = activeCellRef.current;
    const currentAnchor = anchorCellRef.current;
    const rows = navRowsRef.current;
    const cols = gridColumnsRef.current;
    const rowIndex = navRowIndexByIdRef.current;
    const colIndex = colIndexByKeyRef.current;
    let rIdx = 0, cIdx = 0;
    if (prev && rowIndex.has(prev.rowId) && colIndex.has(prev.field)) {
      rIdx = rowIndex.get(prev.rowId) ?? 0;
      cIdx = colIndex.get(prev.field) ?? 0;
    }
    let nr = rIdx + dRow;
    if (nr > rows.length - 1 && sortedNotes.length > visibleRowsCount) handleLoadMoreRows();
    nr = clampIndex(nr, rows.length);
    const nc = clampIndex(cIdx + dCol, cols.length);
    const target = rows[nr];
    const col = cols[nc];
    if (!target || !col) return;
    if (nr !== rIdx) {
      rowVirtualizer.scrollToIndex(target.descriptorIndex, { align: 'auto' });
    }
    const container = tableContainerRef.current;
    if (container && nc > 0) {
      const widths = columnWidthsRef.current;
      const stickyW = 40 + (widths['title'] || 250);
      let colLeft = stickyW;
      for (let i = 1;i < nc;i++) colLeft += (widths[cols[i]?.key ?? ''] || 180);
      const colRight = colLeft + (widths[col.key] || 180);
      const visLeft = container.scrollLeft + stickyW;
      const visRight = container.scrollLeft + container.clientWidth;
      if (colLeft < visLeft) {
        container.scrollLeft = colLeft - stickyW;
      } else if (colRight > visRight) {
        container.scrollLeft = colRight - container.clientWidth + 4;
      }
    }
    if (extend) { if (!currentAnchor && prev) setAnchorCell(prev); }
    else setAnchorCell(null);
    setActiveCell({ rowId: target.id, field: col.key });
  }, [activeCellRef, anchorCellRef, navRowsRef, gridColumnsRef, navRowIndexByIdRef, colIndexByKeyRef, sortedNotes.length, visibleRowsCount, handleLoadMoreRows, tableContainerRef, setAnchorCell, setActiveCell, rowVirtualizer, columnWidthsRef]);
  const beginEditActive = useCallback((initialChar: string | null = null) => {
    const cell = activeCellRef.current;
    if (!cell) return;
    const note = safeNotes.find(n => n.id === cell.rowId);
    if (!note) return;
    if (cell.field === 'title') {
      titlePreviewRef.current?.close(); // don't cover the input with the pop-up
      setEditInitial(initialChar);
      setEditingCell({ rowId: note.id, field: 'title', originalMetaKey: 'title' });
      return;
    }
    const type = getFieldType(schema, cell.field);
    if (isComputedType(type)) return;
    const metaKey = getMetaKey(note, cell.field);
    if (isImageField(cell.field, type)) { openMediaPicker(note, cell.field, type); return; }
    if (type === 'checkbox') {
      const cur = note.metadata?.[metaKey];
      const checked = !!cur && cur !== 'false';
      void handleCellSave(note.id, cell.field, !checked, metaKey);
      return;
    }
    setEditInitial(initialChar);
    setEditingCell({ rowId: note.id, field: cell.field, originalMetaKey: metaKey });
  }, [activeCellRef, safeNotes, schema, isImageField, setEditInitial, setEditingCell, titlePreviewRef, openMediaPicker, handleCellSave]);
  const saveTitle = useCallback(async (noteId: string, newTitle: string) => {
    setEditingCell(null);
    setEditInitial(null);
    const note = noteById.get(noteId);
    if (!note) return;
    const trimmed = displayString(newTitle).trim();
    if (trimmed === '' || trimmed === note.title) return; // no-op (empty doesn't clear the title)
    setOptimisticTitles(prev => new Map(prev).set(noteId, trimmed));
    try {
      const response = await transportFetch(`/api/vault/pages/${noteId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: trimmed }),
      });
      if (!response.ok) {
        const payload: unknown = await response.json().catch(() => ({}));
        throw new Error(displayString((isRecord(payload) ? payload.detail : undefined) || `HTTP ${String(response.status)}`));
      }
      if (onCellSaved) onCellSaved();
    } catch (error) {
      setOptimisticTitles(prev => { const n = new Map(prev); n.delete(noteId); return n; });
      notifyError('table-save-title', error, t('table.title_save_error', { defaultValue: "Couldn't save the title" }));
    }
  }, [noteById, onCellSaved, setEditInitial, setEditingCell, setOptimisticTitles, t]);
  const advanceCursorAfterEdit = useCallback((rowId: string, field: string) => {
    const r = navRowIndexById.get(rowId);
    const c = colIndexByKey.get(field);
    if (r == null || c == null) return;
    const nr = clampIndex(r + 1, navRows.length);
    const target = navRows[nr];
    if (!target) return;
    setAnchorCell(null);
    setActiveCell({ rowId: target.id, field });
    {
      rowVirtualizer.scrollToIndex(target.descriptorIndex, { align: 'auto' });
    }
  }, [navRowIndexById, colIndexByKey, navRows, setAnchorCell, setActiveCell, rowVirtualizer]);
  return { moveCursor, beginEditActive, saveTitle, advanceCursorAfterEdit };
}
