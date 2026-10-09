import { useRef, type ClipboardEvent, type MouseEvent, type PointerEvent, type DragEvent } from 'react';
import type { TableCell } from './types';
import type { TableController } from './useTableController';

const interactive = 'input, textarea, select, button, a, [contenteditable="true"], [role="dialog"]';
const same = (a: TableCell, b: TableCell) => a.rowId === b.rowId && a.field === b.field;

/** Mouse selection belongs to cells; controls and the row gutter retain their actions. */
export function useTablePointerSelection(model: TableController) {
  const start = useRef<TableCell | null>(null);
  const suppressClick = useRef(false);
  const cellAt = (target: EventTarget | null): TableCell | null => {
    if (!(target instanceof Element) || target.closest(interactive)) return null;
    const element = target.closest<HTMLElement>('[data-grid-row][data-grid-field]');
    if (!element || element.closest('[data-vault-table-scroll]') !== model.tableContainerRef.current) return null;
    return { rowId: element.dataset.gridRow!, field: element.dataset.gridField! };
  };
  const selected = () => {
    if (model.selectedCells.length) return model.selectedCells;
    const rect = model.selectionRect;
    if (!rect) return [];
    return model.navRows.slice(rect.r0, rect.r1 + 1).flatMap(row =>
      model.gridColumns.slice(rect.c0, rect.c1 + 1).map(column => ({ rowId: row.id, field: column.key })));
  };
  return {
    onPointerDownCapture(event: PointerEvent<HTMLDivElement>) {
      start.current = null;
      suppressClick.current = false;
      model.claimKeyboard();
      if (event.target instanceof Element && !event.target.closest(interactive)) event.currentTarget.focus({ preventScroll: true });
      if (event.button !== 0 || event.pointerType === 'touch' || model.editingCell) return;
      const cell = cellAt(event.target);
      if (!cell) return;
      event.preventDefault(); // Prevent text selection while dragging across cells.
      if (event.ctrlKey || event.metaKey) {
        const cells = selected();
        const next = cells.some(item => same(item, cell)) ? cells.filter(item => !same(item, cell)) : [...cells, cell];
        model.setActiveCell(next.at(-1) ?? null);
        model.setAnchorCell(null);
        model.setSelectedCells(next);
        model.clearSelection();
        suppressClick.current = true;
      } else {
        start.current = event.shiftKey ? model.anchorCell ?? model.activeCell ?? cell : cell;
        if (event.shiftKey) {
          model.clearSelection();
          model.setActiveCell(cell);
          model.setAnchorCell(start.current);
          suppressClick.current = true;
        }
      }
    },
    onPointerMove(event: PointerEvent<HTMLDivElement>) {
      if (!(event.buttons & 1)) { start.current = null; return; }
      const cell = cellAt(event.target);
      if (!start.current || !cell || (same(cell, start.current) && !suppressClick.current)) return;
      event.preventDefault();
      model.clearSelection();
      model.setActiveCell(cell);
      model.setAnchorCell(start.current);
      suppressClick.current = true;
    },
    onPointerUp() { start.current = null; },
    onPointerCancel() { start.current = null; suppressClick.current = false; },
    onDragStartCapture(event: DragEvent<HTMLDivElement>) {
      if (start.current || cellAt(event.target)) event.preventDefault();
    },
    onClickCapture(event: MouseEvent<HTMLDivElement>) {
      if (!suppressClick.current) return;
      suppressClick.current = false;
      event.preventDefault();
      event.stopPropagation();
    },
    onPaste(event: ClipboardEvent<HTMLDivElement>) {
      if (model.editingCell || (event.target instanceof Element && event.target.closest(interactive))) return;
      if (!model.selectionRect) return;
      event.preventDefault();
      event.stopPropagation();
      void model.handlePasteCells(event.clipboardData.getData('text/plain'));
    },
  };
}
