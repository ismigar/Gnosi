import { act } from 'react';
import { expect, it, vi } from 'vitest';
import { mountTestComponent } from '../../../../../tests/mount-react';
import { RowTitleCell } from './RowTitleCell';
import type { TableController } from './useTableController';
vi.mock('../../../../shared/ui/previews/IconRenderer', () => ({ IconRenderer: () => null }));

it.each([false, true])('keeps subitem creation beside the title in list mode=%s', (isListView) => {
    const setAddingSubitemFor = vi.fn(); const setExpandedRows = vi.fn<(update: (previous: Set<string>) => Set<string>) => void>(); const setNewSubitemTitle = vi.fn();
    const model = { isListView, enableSubitems: true, onCreateRecord: vi.fn(),
        childrenMap: {}, expandedRows: new Set(), getCellSelState: () => ({}),
        isSelected: () => false, t: (key: string) => key, columnWidths: {}, rowPadClass: '',
        titlePreview: { getTitleProps: () => ({}) }, setAddingSubitemFor, setExpandedRows, setNewSubitemTitle,
    } as unknown as TableController;
    const note = { id: 'parent', title: 'Parent' };
    const view = mountTestComponent(<table><tbody><tr><RowTitleCell model={model} note={note} isChild={false} depth={0} /></tr></tbody></table>);
    const button = view.container.querySelector<HTMLButtonElement>('button[aria-label="table.add_subitem"]');
    if (!button) throw new Error('Missing subitem action');
    expect(button.closest('[data-title-cell="parent"]')).not.toBeNull();
    act(() => { button.click(); });
    expect(setAddingSubitemFor).toHaveBeenCalledWith('parent');
    expect(setNewSubitemTitle).toHaveBeenCalledWith('');
    const expand = setExpandedRows.mock.calls[0]?.[0];
    if (!expand) throw new Error('Missing expansion');
    expect(expand(new Set(['other']))).toEqual(new Set(['other', 'parent']));
    view.render(<table><tbody><tr><RowTitleCell model={{ ...model, enableSubitems: false }} note={note} isChild={false} depth={0} /></tr></tbody></table>);
    expect(view.container.querySelector('button[aria-label="table.add_subitem"]')).toBeNull();
});
