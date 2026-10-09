import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import type { TableController } from './useTableController';

export function ColumnSortButton({ model, field, label }: { model: TableController; field: string; label: string }) {
    const current = model.activeSort.field === field;
    const ascending = current && model.activeSort.direction === 'asc';
    const title = model.t(ascending ? 'table.sort_column_desc' : 'table.sort_column_asc', { column: label });
    const Icon = current ? ascending ? ArrowUp : ArrowDown : ArrowUpDown;
    return <button type="button" aria-label={title} title={title} data-column-sort={field}
        disabled={!model.onUpdateView}
        className={`ml-2 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded transition-colors hover:bg-[var(--bg-tertiary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--gnosi-primary)] disabled:opacity-40 ${current ? 'text-[var(--gnosi-primary)]' : 'text-[var(--text-tertiary)]'}`}
        onPointerDown={event => { event.stopPropagation(); }}
        onKeyDown={event => { event.stopPropagation(); }}
        onClick={event => { event.stopPropagation(); model.handleSort(field); }}>
        <Icon size={14} />
    </button>;
}
