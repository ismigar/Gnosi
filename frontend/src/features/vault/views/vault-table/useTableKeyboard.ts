import { useEffect } from 'react';
import { subscribeWindowEvent } from '../../../../shared/platform/browser-events';
import { getFieldType } from '../../../../shared/records/model/schemaUtils';
import { keyboardOwnership } from './keyboardOwnership';
import type { TableInputs } from './tableInputs';
import { useLatestRef } from './useLatestRef';
import type { useTableClipboard } from './useTableClipboard';
import type { useTableCursor } from './useTableCursor';
import type { useTableData } from './useTableData';
import type { useTableIdentity } from './useTableIdentity';
import type { useTableNavigation } from './useTableNavigation';
import type { useTableResources } from './useTableResources';
import type { useTableRows } from './useTableRows';
import type { useTableSelection } from './useTableSelection';
import type { useTableState } from './useTableState';

type Inputs = Pick<ReturnType<typeof useTableClipboard>, 'handleCopyCells' | 'handlePasteCells' | 'clearActiveCells'>
  & Pick<ReturnType<typeof useTableCursor>, 'moveCursor' | 'beginEditActive'>
  & Pick<TableInputs,
    'schema'
    | 'onNoteSelect'
    | 'onOpenParallel'
    | 'onDeletePage'
    | 'onExitTop'
    | 'onExitBottom'
    | 'onEscape'
    | 'registerNavApi'
  >
  & Pick<ReturnType<typeof useTableNavigation>, 'noteById' | 'navRows' | 'navRowsRef' | 'gridColumnsRef'>
  & Pick<ReturnType<typeof useTableResources>, 'hasOpenableResource' | 'handleOpenExternalResource'>
  & Pick<ReturnType<typeof useTableData>, 'sortedNotes'>
  & Pick<ReturnType<typeof useTableState>,
    'visibleRowsCount'
    | 'setAnchorCell'
    | 'setActiveCell'
    | 'activeCellRef'
    | 'editingCellRef'
    | 'titlePreviewRef'
  >
  & Pick<ReturnType<typeof useTableIdentity>, 'claimKeyboard' | 'gridInstanceIdRef'>
  & Pick<ReturnType<typeof useTableRows>, 'rowVirtualizer' | 'tableContainerRef'>
  & Pick<ReturnType<typeof useTableSelection>, 'selectedIdsRef'>;

export function useTableKeyboard({
  handleCopyCells,
  handlePasteCells,
  moveCursor,
  beginEditActive,
  clearActiveCells,
  schema,
  noteById,
  onNoteSelect,
  onOpenParallel,
  onDeletePage,
  hasOpenableResource,
  handleOpenExternalResource,
  onExitTop,
  onExitBottom,
  onEscape,
  navRows,
  sortedNotes,
  visibleRowsCount,
  registerNavApi,
  navRowsRef,
  gridColumnsRef,
  claimKeyboard,
  setAnchorCell,
  setActiveCell,
  rowVirtualizer,
  gridInstanceIdRef,
  tableContainerRef,
  activeCellRef,
  editingCellRef,
  selectedIdsRef,
  titlePreviewRef,
}: Inputs) {
  const handleCopyCellsRef = useLatestRef(handleCopyCells);
  const handlePasteCellsRef = useLatestRef(handlePasteCells);
  const moveCursorRef = useLatestRef(moveCursor);
  const beginEditActiveRef = useLatestRef(beginEditActive);
  const clearActiveCellsRef = useLatestRef(clearActiveCells);
  const schemaRef = useLatestRef(schema);
  const rowActionsRef = useLatestRef({ noteById, onNoteSelect, onOpenParallel, onDeletePage, hasOpenableResource, handleOpenExternalResource });
  const onExitTopRef = useLatestRef<(() => void) | null | undefined>(onExitTop);
  const onExitBottomRef = useLatestRef<(() => void) | null | undefined>(onExitBottom);
  const onEscapeRef = useLatestRef<(() => void) | null | undefined>(onEscape);
  const tableEdgeRef = useLatestRef<{ firstRowId?: string; lastRowId?: string; allLoaded: boolean; }>({
    firstRowId: navRows[0]?.id,
    lastRowId: navRows[navRows.length - 1]?.id,
    allLoaded: sortedNotes.length <= visibleRowsCount,
  });
  useEffect(() => {
    if (!registerNavApi) return undefined;
    const focusEdge = (which: 'first' | 'last') => {
      const rows = navRowsRef.current;
      const cols = gridColumnsRef.current;
      if (!rows.length || !cols.length) return false;
      claimKeyboard(); // entering it from the editor makes the keyboard property ours
      const row = which === 'last' ? rows[rows.length - 1] : rows[0];
      const col = cols[0];
      if (!row || !col) return false;
      setAnchorCell(null);
      setActiveCell({ rowId: row.id, field: col.key });
      {
        rowVirtualizer.scrollToIndex(row.descriptorIndex, { align: which === 'last' ? 'end' : 'start' });
      }
      try { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); } catch { /* noop */ }
      return true;
    };
    registerNavApi({
      focusFirstCell: () => focusEdge('first'),
      focusLastCell: () => focusEdge('last'),
    });
    return () => { registerNavApi(null); };
  }, [claimKeyboard, gridColumnsRef, navRowsRef, registerNavApi, rowVirtualizer, setActiveCell, setAnchorCell]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return; // already handled upstream (e.g. modal scroll)
      if (document.body.classList.contains('gnosi-modal-open')) return;
      if (keyboardOwnership.owner !== gridInstanceIdRef.current) return;
      const t = e.target;
      if (t instanceof Element && t !== document.body && tableContainerRef.current && !tableContainerRef.current.contains(t)) return;
      const cell = activeCellRef.current;
      if (!cell || editingCellRef.current) return;
      const el = document.activeElement;
      const tag = el?.tagName;
      const inputType = el ? (el.getAttribute('type') || '') : '';
      const isTextInput = (tag === 'INPUT' && !['checkbox', 'radio', 'button', 'submit'].includes(inputType)) || tag === 'TEXTAREA' || (el instanceof HTMLElement && el.isContentEditable);
      if (isTextInput) return;
      if (tag === 'TD' && (e.key === ' ' || e.key === 'Enter')) return;

      const meta = e.metaKey || e.ctrlKey;
      if (meta && (e.key === 'c' || e.key === 'C')) { e.preventDefault(); handleCopyCellsRef.current(); return; }
      if (meta && (e.key === 'v' || e.key === 'V')) { e.preventDefault(); void handlePasteCellsRef.current(); return; }
      if (meta && (e.key === 'Backspace' || e.key === 'Delete')) {
        const { onDeletePage, noteById } = rowActionsRef.current;
        if (onDeletePage && selectedIdsRef.current?.size === 0) {
          const n = noteById.get(cell.rowId);
          if (n) { e.preventDefault(); onDeletePage(n.id, n.title); }
        }
        return;
      }
      if (meta) return; // leaves ⌘A/⌘O to its own listeners

      if (e.altKey && !e.shiftKey) {
        const { noteById, onNoteSelect, onOpenParallel, hasOpenableResource, handleOpenExternalResource } = rowActionsRef.current;
        const n = noteById.get(cell.rowId);
        if (e.code === 'KeyO') { e.preventDefault(); if (n) onNoteSelect(n.id, { returnFocusId: n.id }); return; }
        if (e.code === 'KeyR') { e.preventDefault(); if (n && hasOpenableResource(n)) void handleOpenExternalResource(n); return; }
        if (e.code === 'KeyP') { e.preventDefault(); if (n && onOpenParallel) onOpenParallel(n.id); return; }
      }

      switch (e.key) {
        case 'ArrowUp':
          e.preventDefault();
          if (onExitTopRef.current && !e.shiftKey && cell.rowId === tableEdgeRef.current.firstRowId) {
            setActiveCell(null); setAnchorCell(null); onExitTopRef.current();
          } else {
            moveCursorRef.current(-1, 0, e.shiftKey);
          }
          break;
        case 'ArrowDown':
          e.preventDefault();
          if (onExitBottomRef.current && !e.shiftKey && cell.rowId === tableEdgeRef.current.lastRowId && tableEdgeRef.current.allLoaded) {
            setActiveCell(null); setAnchorCell(null); onExitBottomRef.current();
          } else {
            moveCursorRef.current(1, 0, e.shiftKey);
          }
          break;
        case 'ArrowLeft': e.preventDefault(); moveCursorRef.current(0, -1, e.shiftKey); break;
        case 'ArrowRight': e.preventDefault(); moveCursorRef.current(0, 1, e.shiftKey); break;
        case 'Tab': e.preventDefault(); moveCursorRef.current(0, e.shiftKey ? -1 : 1, false); break;
        case 'Enter': e.preventDefault(); beginEditActiveRef.current(null); break;
        case ' ':
          e.preventDefault(); // prevents page scroll while navigating between cells
          if (getFieldType(schemaRef.current, cell.field) === 'checkbox') { beginEditActiveRef.current(null); break; }
          if (cell.field === 'title') {
            const tp = titlePreviewRef.current;
            if (tp?.active && tp.active.pageId === cell.rowId && tp.active.viaKeyboard) {
              tp.close();
            } else {
              const el = tableContainerRef.current?.querySelector(`[data-title-cell="${CSS.escape(cell.rowId)}"]`);
              if (el) tp?.openForKeyboard(cell.rowId, el.getBoundingClientRect());
            }
          }
          break;
        case 'Escape':
          e.preventDefault();
          setActiveCell(null);
          setAnchorCell(null);
          if (onEscapeRef.current) {
            onEscapeRef.current();
          }
          break;
        case 'Backspace':
        case 'Delete':
          if (selectedIdsRef.current?.size === 0) { e.preventDefault(); clearActiveCellsRef.current(); }
          break;
        default:
          if (e.key.length === 1 && !e.altKey) {
            const type = getFieldType(schemaRef.current, cell.field);
            if (type === 'text' || type === 'number' || type === '') {
              e.preventDefault();
              beginEditActiveRef.current(e.key);
            }
          }
          break;
      }
    };
    const unsubscribeonKey = subscribeWindowEvent('keydown', onKey);
    return () => { unsubscribeonKey(); };
  }, [activeCellRef, beginEditActiveRef, clearActiveCellsRef, editingCellRef, gridInstanceIdRef, handleCopyCellsRef, handlePasteCellsRef, moveCursorRef, onEscapeRef, onExitBottomRef, onExitTopRef, rowActionsRef, schemaRef, selectedIdsRef, setActiveCell, setAnchorCell, tableContainerRef, tableEdgeRef, titlePreviewRef]);
  return { onExitTopRef };
}
