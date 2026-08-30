import { Plus } from 'lucide-react';
import { createCellRenderer } from './CellContent';
import { createNewSubitemRenderer } from './NewSubitemRow';
import { createGroupRenderers } from './TableGroups';
import { createRowRenderer } from './TableRow';
import type { TableController } from './useTableController';

export function TableBody({ model }: { model: TableController; }) {
  const {
    t,
    isListView,
    columnWidths,
    dynamicColumns,
    showModifiedColumn,
    virtPaddingTop,
    virtualRows,
    rowDescriptors,
    virtPaddingBottom,
    newRowInputRef,
    newRowTitle,
    setNewRowTitle,
    handleCreateRowRecord,
  } = model;
  const renderCellContent = createCellRenderer(model);
  const renderRow = createRowRenderer(model, renderCellContent);
  const renderNewSubitemRow = createNewSubitemRenderer(model);
  const { renderGroupHeader, renderGroupFooter } = createGroupRenderers(model);
  return (<tbody>
    {/* Top spacer for the virtualizer's padding. */}
    {virtPaddingTop > 0 && (
      <tr aria-hidden="true">
        <td colSpan={dynamicColumns.length + 3} style={{ height: virtPaddingTop, padding: 0, border: 0 }} />
      </tr>
    )}
    {virtualRows.map(vi => {
      const d = rowDescriptors[vi.index];
      if (!d) return null;
      if (d.kind === 'row') {
        return renderRow(d.note, d.isChild, d.depth, String(vi.index), vi);
      }
      if (d.kind === 'group-header') {
        return renderGroupHeader(d, vi);
      }
      if (d.kind === 'group-footer') {
        return renderGroupFooter(d, vi);
      }
      {
        return renderNewSubitemRow(d.parentNote, d.depth, vi);
      }
    })}
    {virtPaddingBottom > 0 && (
      <tr aria-hidden="true">
        <td colSpan={dynamicColumns.length + 3} style={{ height: virtPaddingBottom, padding: 0, border: 0 }} />
      </tr>
    )}

    {!isListView && (
      <tr className="border-b border-[var(--border-primary)]/50 hover:bg-[var(--bg-secondary)]/80 transition-colors group/new-row h-10">
        <td className="w-10 sticky left-0 z-20 bg-[var(--bg-primary)] border-r border-[var(--border-primary)] py-2">
          <div className="flex items-center justify-center">
            <Plus size={14} className="text-[var(--text-tertiary)] group-focus-within/new-row:text-indigo-500" />
          </div>
        </td>
        <td
          style={{ width: columnWidths['title'] || 250, maxWidth: columnWidths['title'] || 250 }}
          className="py-1 px-4 sticky left-10 z-20 bg-[var(--bg-primary)] border-r border-[var(--border-primary)] shadow-[2px_0_5px_-2px_rgba(0,0,0,0.02)]"
        >
          <input
            ref={newRowInputRef}
            type="text"
            placeholder={t('table.new_record_placeholder')}
            value={newRowTitle}
            onChange={(e) => { setNewRowTitle(e.currentTarget.value); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                e.stopPropagation();
                void handleCreateRowRecord();
              }
              if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                setNewRowTitle('');
              }
            }}
            className="w-full bg-transparent border-none outline-none text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:placeholder:text-[var(--text-secondary)] font-medium"
          />
        </td>
        {dynamicColumns.map(([key]) => (
          <td key={key} style={{ width: columnWidths[key] || 180 }} className="py-1 px-4 text-[var(--text-primary)]" />
        ))}
        {showModifiedColumn && (
          <td style={{ width: columnWidths['last_modified'] || 150 }} className="py-1 px-4 border-l border-[var(--border-primary)] text-[var(--text-secondary)]" />
        )}
      </tr>
    )}
  </tbody>);
}
