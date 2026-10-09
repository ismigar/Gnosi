import { useEffect, useRef, type MouseEvent, type KeyboardEvent } from 'react';
import { useLatestRef } from './useLatestRef';
import type { TableController } from './useTableController';

/** Delay pointer sorting briefly so a double click selects without changing the order. */
export function useColumnHeaderActions(model: TableController) {
    const latest = useLatestRef(model);
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const cancel = () => { if (timer.current !== null) clearTimeout(timer.current); timer.current = null; };
    useEffect(() => () => { if (timer.current !== null) clearTimeout(timer.current); }, []);
    const ignored = (event: MouseEvent) => event.target instanceof Element && !!event.target.closest('button, a, input, select, [data-column-help]');
    return (field: string, label: string) => ({
        role: 'button', tabIndex: 0, 'data-column-header': field,
        title: model.t('table.column_header_hint', { column: label }),
        'aria-label': model.t('table.column_header_hint', { column: label }),
        onClick(event: MouseEvent<HTMLDivElement>) {
            if (ignored(event) || latest.current.columnDragJustEndedRef.current) return;
            cancel();
            if (event.detail > 1) return;
            timer.current = setTimeout(() => { timer.current = null; latest.current.handleSort(field); }, 400);
        },
        onDoubleClick(event: MouseEvent<HTMLDivElement>) {
            if (ignored(event) || latest.current.columnDragJustEndedRef.current) return;
            cancel(); event.preventDefault(); event.stopPropagation(); latest.current.selectColumn(field);
        },
        onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
            if (event.target !== event.currentTarget || !['Enter', ' '].includes(event.key)) return;
            cancel(); event.preventDefault(); event.stopPropagation();
            if (event.shiftKey) latest.current.selectColumn(field); else latest.current.handleSort(field);
        },
    });
}
