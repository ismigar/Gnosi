import type { VirtualItem } from '@tanstack/react-virtual';
import { X } from 'lucide-react';
import type { TableNote } from './types';
import type { TableController } from './useTableController';

export function createNewSubitemRenderer(model: TableController) {
  const {
    rowVirtualizer,
    columnWidths,
    subitemInputRef,
    t,
    newSubitemTitle,
    setNewSubitemTitle,
    handleCreateSubitem,
    setAddingSubitemFor,
    dynamicColumns,
    showModifiedColumn,
  } = model;
  const renderNewSubitemRow = (parentNote: TableNote, depth: number = 1, virtualItem: VirtualItem | null = null) => (
    <tr
      key={`new-sub-${parentNote.id}`}
      data-index={virtualItem?.index}
      ref={virtualItem ? rowVirtualizer.measureElement : undefined}
      className="border-b border-[var(--border-primary)] bg-indigo-500/5"
    >
      <td className="w-10 sticky left-0 z-20 bg-[var(--bg-primary)]" />
      <td
        style={{ width: columnWidths['title'] || 250, maxWidth: columnWidths['title'] || 250 }}
        className="py-1.5 px-4 sticky left-10 z-20 bg-[var(--bg-primary)] border-r border-[var(--border-primary)]"
      >
        <div className="flex items-center gap-2" style={{ marginLeft: depth * 20 }}>
          <input
            ref={subitemInputRef}
            type="text"
            placeholder={t('table.subitem_name_placeholder')}
            value={newSubitemTitle}
            onChange={(e) => { setNewSubitemTitle(e.currentTarget.value); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleCreateSubitem(parentNote.id);
              if (e.key === 'Escape') {
                setAddingSubitemFor(null);
                setNewSubitemTitle('');
              }
            }}
            className="flex-1 px-2 py-1 text-sm border border-[var(--border-primary)] rounded focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-[var(--bg-primary)] text-[var(--text-primary)] shadow-sm"
          />
          <button
            onClick={() => { void handleCreateSubitem(parentNote.id); }}
            className="px-2 py-1 text-xs bg-indigo-600 text-white rounded hover:bg-indigo-700 transition-colors shrink-0 font-medium"
          >
            {t('common.create')}
          </button>
          <button
            onClick={() => { setAddingSubitemFor(null); setNewSubitemTitle(''); }}
            className="p-1 text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
          >
            <X size={14} />
          </button>
        </div>
      </td>
      {dynamicColumns.map(([key]) => (
        <td key={key} style={{ width: columnWidths[key] || 180 }} className="py-1.5 px-4" />
      ))}
      {showModifiedColumn && (
        <td style={{ width: columnWidths['last_modified'] || 150 }} className="py-1.5 px-4 border-l border-[var(--border-primary)]" />
      )}
    </tr>
  );
  return renderNewSubitemRow;
}
