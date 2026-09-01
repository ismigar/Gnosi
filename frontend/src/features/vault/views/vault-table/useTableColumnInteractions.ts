import type { DragEndEvent } from '@dnd-kit/core';
import { KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { arrayMove, sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import type React from 'react';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { subscribeDocumentEvent } from '../../../../shared/platform/browser-events';
import type { TableInputs } from './tableInputs';
import type { useTableColumns } from './useTableColumns';
import type { useTableState } from './useTableState';

type Inputs = Pick<ReturnType<typeof useTableState>, 'columnWidths' | 'setColumnWidths' | 'columnWidthsRef'>
  & Pick<TableInputs, 'activeView' | 'onUpdateView'>
  & Pick<ReturnType<typeof useTableColumns>, 'dynamicColumns'>;

export function useTableColumnInteractions({ columnWidths, setColumnWidths, activeView, onUpdateView, columnWidthsRef, dynamicColumns }: Inputs) {
  const resizingCol = useRef<string | null>(null);
  const startX = useRef(0);
  const startWidth = useRef(0);
  const handleMouseDown = useCallback((e: React.MouseEvent, colKey: string) => {
    e.preventDefault();
    e.stopPropagation();
    resizingCol.current = colKey;
    startX.current = e.pageX;
    startWidth.current = columnWidths[colKey] || 180;
    document.body.style.cursor = 'col-resize';
  }, [columnWidths]);
  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!resizingCol.current) return;
    const diffX = e.pageX - startX.current;
    const newWidth = Math.max(100, startWidth.current + diffX);
    const columnKey = resizingCol.current;
    setColumnWidths(prev => ({ ...prev, [columnKey]: newWidth }));
  }, [setColumnWidths]);
  const handleMouseUp = useCallback(() => {
    if (resizingCol.current) {
      resizingCol.current = null;
      document.body.style.cursor = 'default';
      if (activeView && onUpdateView) {
        onUpdateView({ ...activeView, columnWidths: { ...columnWidthsRef.current } });
      }
    }
  }, [activeView, columnWidthsRef, onUpdateView]);
  useEffect(() => {
    const unsubscribehandleMouseMove = subscribeDocumentEvent('mousemove', handleMouseMove);
    const unsubscribehandleMouseUp = subscribeDocumentEvent('mouseup', handleMouseUp);
    return () => {
      unsubscribehandleMouseMove();
      unsubscribehandleMouseUp();
    };
  }, [handleMouseMove, handleMouseUp]);
  const columnDndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
  const columnSortableIds = useMemo(() => dynamicColumns.map(([k]) => k), [dynamicColumns]);
  const columnDragJustEndedRef = useRef(false);
  const suppressNextHeaderClick = useCallback(() => {
    columnDragJustEndedRef.current = true;
    setTimeout(() => { columnDragJustEndedRef.current = false; }, 0);
  }, []);
  const handleColumnDragEnd = useCallback((event: DragEndEvent) => {
    suppressNextHeaderClick();
    const { active, over } = event;
    if (!over || active.id === over.id || !activeView || !onUpdateView) return;

    const hasVP = Array.isArray(activeView.visibleProperties) && activeView.visibleProperties.length > 0;
    const base = hasVP ? activeView.visibleProperties : dynamicColumns.map(([k]) => k);
    const oldIndex = base.indexOf(active.id);
    const newIndex = base.indexOf(over.id);
    if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return;

    onUpdateView({ ...activeView, visibleProperties: arrayMove(base, oldIndex, newIndex) });
  }, [dynamicColumns, activeView, onUpdateView, suppressNextHeaderClick]);
  return { handleMouseDown, columnDndSensors, columnSortableIds, columnDragJustEndedRef, suppressNextHeaderClick, handleColumnDragEnd };
}
