import { useRef } from 'react';
import { act } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { mountTestComponent } from '../../../../../tests/mount-react';
import { useColumnHeaderActions } from './useColumnHeaderActions';
import { ColumnSortIndicator } from './ColumnSortIndicator';
import type { TableController } from './useTableController';
afterEach(() => { vi.useRealTimers(); });
it('separates single-click sorting, double-click selection and a passive direction indicator', () => {
    vi.useFakeTimers();
    const sort = vi.fn(), select = vi.fn();
    function Probe() {
        const ref = useRef(false);
        const model = { handleSort: sort, selectColumn: select, columnDragJustEndedRef: ref, activeSort: { field: 'Score', direction: 'asc' }, t: (key: string) => key } as unknown as TableController;
        const action = useColumnHeaderActions(model);
        return <div {...action('Score', 'Score')}>Score<ColumnSortIndicator model={model} field="Score" label="Score" /></div>;
    }
    const view = mountTestComponent(<Probe />);
    const header = view.container.querySelector<HTMLElement>('[data-column-header]');
    if (!header) throw new Error('Missing header');
    const click = (detail: number) => { header.dispatchEvent(new MouseEvent('click', { detail, bubbles: true })); };
    act(() => { click(1); }); expect(sort).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(400); }); expect(sort).toHaveBeenCalledExactlyOnceWith('Score'); sort.mockClear();
    act(() => { click(1); click(2); header.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true })); vi.advanceTimersByTime(500); });
    expect(select).toHaveBeenCalledExactlyOnceWith('Score'); expect(sort).not.toHaveBeenCalled();
    expect(header.querySelector('button')).toBeNull();
    act(() => { header.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); });
    expect(sort).toHaveBeenCalledExactlyOnceWith('Score');
    view.unmount();
});
