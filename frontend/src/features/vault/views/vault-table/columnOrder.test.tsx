import { act, useLayoutEffect, useRef, useState } from 'react';
import { expect, it, vi } from 'vitest';
import { mountTestComponent } from '../../../../../tests/mount-react';
import type { VaultTableProps } from './types';
import { useTableColumns } from './useTableColumns';
import { useTableColumnInteractions } from './useTableColumnInteractions';

it.each([true, false])('saves dragged column order for main=%s while preserving other view settings', async is_main => {
  const onUpdateView = vi.fn();
  const activeView = { id: 'ordered', is_main, visibleProperties: ['title', 'Status', 'Score', 'Text'], columnWidths: { Score: 220 }, sorts: [{ field: 'Score', direction: 'desc' as const }] };
  const schema = { Status: 'status', Score: 'number', Text: 'text' };
  type Model = ReturnType<typeof useTableColumns> & ReturnType<typeof useTableColumnInteractions>;
  let current: Model | undefined;
  function Probe({ view }: { view: VaultTableProps['activeView'] }) {
    const [columnWidths, setColumnWidths] = useState<Record<string, number>>({ Score: 220 });
    const columnWidthsRef = useRef(columnWidths);
    const columns = useTableColumns({ activeView: view, onUpdateView, schema, setColumnWidths });
    const interactions = useTableColumnInteractions({ activeView: view, onUpdateView, columnWidths, setColumnWidths, columnWidthsRef, dynamicColumns: columns.dynamicColumns });
    useLayoutEffect(() => { current = { ...columns, ...interactions }; });
    return null;
  }
  const table = mountTestComponent(<Probe view={activeView} />);
  const model = () => { if (!current) throw new Error('Missing column model'); return current; };
  try {
    await act(async () => {
      await Promise.resolve();
      model().handleColumnDragEnd({ active: { id: 'Text' }, over: { id: 'Status' } } as Parameters<Model['handleColumnDragEnd']>[0]);
    });
    expect(onUpdateView).toHaveBeenCalledExactlyOnceWith({ ...activeView, visibleProperties: ['title', 'Text', 'Status', 'Score'] });
    table.render(<Probe view={{ ...activeView, visibleProperties: ['title', 'Text', 'Status', 'Score'] }} />);
    expect(model().dynamicColumns.map(([key]) => key)).toEqual(['Text', 'Status', 'Score']);
  } finally { table.unmount(); }
});
