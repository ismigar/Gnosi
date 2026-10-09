import { ArrowDown, ArrowUp } from 'lucide-react';
import type { TableController } from './useTableController';

export function ColumnSortIndicator({ model, field, label }: { model: TableController; field: string; label: string }) {
    if (model.activeSort.field !== field) return null;
    const ascending = model.activeSort.direction === 'asc';
    const Icon = ascending ? ArrowUp : ArrowDown;
    return <span data-column-sort-indicator={field} className="ml-2 shrink-0 text-[var(--gnosi-primary)]"
        title={model.t(ascending ? 'table.sorted_column_asc' : 'table.sorted_column_desc', { column: label })}>
        <Icon size={14} aria-hidden="true" />
    </span>;
}
