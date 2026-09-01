import { AlertTriangle, ChevronDown, ChevronRight, Plus } from 'lucide-react';
import type React from 'react';
import { IconRenderer } from '../../../../shared/ui/previews/IconRenderer';
import { displayString } from './fieldConfig';
import type { TableNote } from './types';
import type { TableController } from './useTableController';

export function RowTitleCell({ model, note, isChild, depth }: { model: TableController, note: TableNote; isChild: boolean; depth: number; }) {
  const {
    childrenMap,
    expandedRows,
    getCellSelState,
    editingCell,
    activeCell,
    anchorCell,
    setAnchorCell,
    setActiveCell,
    titlePreviewRef,
    setEditInitial,
    setEditingCell,
    isListView,
    isSelected,
    t,
    columnWidths,
    rowPadClass,
    hasVisibleLanguageColumn,
    enableSubitems,
    setExpandedRows,
    editInitial,
    saveTitle,
    advanceCursorAfterEdit,
    titlePreview,
    onCreateRecord,
    setAddingSubitemFor,
    setNewSubitemTitle,
  } = model;
  const hasChildren = ((childrenMap[note.id]?.length ?? 0) > 0);
  const isExpanded = expandedRows.has(note.id);
  const titleSel = getCellSelState(note.id, 'title');
  const isEditingTitle = editingCell?.rowId === note.id && editingCell.field === 'title';
  const selectTitleCell = (e: React.MouseEvent) => {
    if (e.shiftKey && activeCell) {
      if (!anchorCell) setAnchorCell(activeCell);
      setActiveCell({ rowId: note.id, field: 'title' });
      return;
    }
    setActiveCell({ rowId: note.id, field: 'title' });
    setAnchorCell(null);
  };
  const openTitleEditor = () => {
    titlePreviewRef.current?.close(); // don't cover the input with the pop-up
    setEditInitial(null);
    setActiveCell({ rowId: note.id, field: 'title' });
    setAnchorCell(null);
    setEditingCell({ rowId: note.id, field: 'title', originalMetaKey: 'title' });
  };

  return (<td
    data-title-cell={note.id}
    tabIndex={-1}
    style={{ width: columnWidths['title'] || 250, maxWidth: columnWidths['title'] || 250 }}
    className={`${rowPadClass} px-4 font-medium text-[var(--text-primary)] sticky left-10 z-30 overflow-hidden align-top
                            ${titleSel.inRange && !titleSel.isActive ? 'bg-[var(--gnosi-primary)]/10' : isSelected(note.id) ? 'bg-indigo-50 dark:bg-indigo-950' : isChild ? 'bg-[var(--bg-secondary)]' : 'bg-[var(--bg-primary)]'}
                            ${isListView ? 'group-hover:bg-[var(--bg-secondary)]' : 'border-r border-[var(--border-primary)] shadow-[2px_0_5px_-2px_rgba(0,0,0,0.02)]'}
                            ${titleSel.isActive ? 'shadow-[inset_0_0_0_2px_var(--gnosi-primary)]' : ''}`}
    onClick={(e) => {
      e.stopPropagation();
      const alreadyActive = !e.shiftKey && activeCell && activeCell.rowId === note.id && activeCell.field === 'title';
      if (alreadyActive) { openTitleEditor(); return; }
      selectTitleCell(e);
    }}
    onDoubleClick={(e) => { e.stopPropagation(); openTitleEditor(); }}
  >
    <div className="flex items-center gap-1.5">
      {note.metadata?.translation_lang && (!hasVisibleLanguageColumn || note.metadata.translation_stale) && (
        <span
          className={`shrink-0 inline-flex items-center gap-0.5 px-1 py-px rounded text-[9px] font-bold uppercase ${note.metadata.translation_stale ? 'bg-amber-500/15 text-amber-600' : 'bg-[var(--gnosi-primary)]/10 text-[var(--gnosi-primary)]'}`}
          title={note.metadata.translation_stale
            ? t('table.translation_stale', "The original changed — re-translate to update")
            : t('table.translation_badge', "Translation")}
        >
          {note.metadata.translation_stale && <AlertTriangle size={9} />}
          {!hasVisibleLanguageColumn && displayString(note.metadata.translation_lang).toUpperCase()}
        </span>
      )}
      {isChild && (
        <div className="flex shrink-0" style={{ width: depth * 20 }}>
          <div className="flex-1" />
          <span className="w-5 flex items-center justify-center text-[var(--text-tertiary)]">└</span>
        </div>
      )}

      {enableSubitems && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            setExpandedRows(prev => {
              const next = new Set(prev);
              if (next.has(note.id)) next.delete(note.id);
              else next.add(note.id);
              return next;
            });
          }}
          className={`p-0.5 rounded transition-colors shrink-0 ${hasChildren ? 'text-[var(--text-tertiary)] hover:text-indigo-600 hover:bg-indigo-500/10' : 'text-transparent pointer-events-none'}`}
          title={hasChildren ? (isExpanded ? t('table.collapse_subitems') : t('table.expand_subitems')) : ''}
        >
          {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
      )}

      <IconRenderer icon={note.metadata?.icon} size={16} />
      {isEditingTitle ? (
        <input
          autoFocus
          defaultValue={editInitial != null ? editInitial : (note.title ?? '')}
          onClick={(e) => { e.stopPropagation(); }}
          onDoubleClick={(e) => { e.stopPropagation(); }}
          onBlur={(e) => { void saveTitle(note.id, e.currentTarget.value); }}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') { e.preventDefault(); void saveTitle(note.id, e.currentTarget.value); advanceCursorAfterEdit(note.id, 'title'); return; }
            if (e.key === 'Escape') { e.preventDefault(); setEditingCell(null); setEditInitial(null); return; }
          }}
          className="flex-1 min-w-0 px-1 py-0.5 text-sm border border-[var(--border-primary)] rounded focus:outline-none focus:ring-1 focus:ring-[var(--gnosi-primary)] bg-[var(--bg-primary)] text-[var(--text-primary)] font-medium"
        />
      ) : (
        <span className="truncate flex-1" {...titlePreview.getTitleProps(note.id)}>{note.title}</span>
      )}

      {enableSubitems && hasChildren && !isExpanded && (
        <span className="ml-1 px-1.5 py-0.5 text-[10px] font-semibold bg-[var(--gnosi-primary)]/20 text-[var(--gnosi-primary)] rounded-full shrink-0">
          {childrenMap[note.id]?.length}
        </span>
      )}

      {!isListView && enableSubitems && onCreateRecord && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            setExpandedRows(prev => new Set([...prev, note.id]));
            setAddingSubitemFor(note.id);
            setNewSubitemTitle('');
          }}
          className="opacity-0 group-hover/row:opacity-100 ml-1 p-0.5 rounded text-[var(--text-tertiary)] hover:text-indigo-600 hover:bg-indigo-500/10 transition-all shrink-0"
          title={t('table.add_subitem')}
        >
          <Plus size={12} />
        </button>
      )}
    </div>
  </td>);
}
