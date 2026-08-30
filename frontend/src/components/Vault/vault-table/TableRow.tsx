import type { VirtualItem } from '@tanstack/react-virtual';
import { Clock } from 'lucide-react';
import { isComputedType } from '../cellGridUtils';
import { getFieldType } from '../schemaUtils';
import { getMetaKey } from './metadata';
import { RowActions } from './RowActions';
import { RowTitleCell } from './RowTitleCell';
import { metadataDate } from './sharedCompatibility';
import type { TableNote } from './types';
import type { TableController } from './useTableController';

export function createRowRenderer(model: TableController, renderCellContent: ReturnType<typeof import('./CellContent').createCellRenderer>) {
  const {
    getCellSelState,
    editingCell,
    activeCell,
    anchorCell,
    setAnchorCell,
    setActiveCell,
    setEditInitial,
    setEditingCell,
    rowVirtualizer,
    isListView,
    isSelected,
    onNoteSelect,
    schema,
    i18n,
    columnWidths,
    rowPadClass,
    dynamicColumns,
    handleCellSave,
    isImageField,
    openMediaPicker,
    getCalculatedFieldValue,
    showModifiedColumn,
  } = model;
  const renderRow = (note: TableNote, isChild: boolean = false, depth: number = 0, rowPath: string = '0', virtualItem: VirtualItem | null = null) => {
    return (
      <tr
        key={`${note.id || 'note'}-${rowPath}`}
        data-index={virtualItem?.index}
        ref={virtualItem ? rowVirtualizer.measureElement : undefined}
        className={`border-b border-[var(--border-primary)] hover:bg-[var(--bg-secondary)] cursor-pointer transition-colors group/row
                    ${isListView ? 'border-b-0 group' : ''}
                    ${isSelected(note.id) ? 'bg-indigo-500/10' : ''}
                    ${isChild ? 'bg-[var(--bg-secondary)]/30' : ''}
                `}
        onClick={() => { /* Row: selection via checkbox */ }}
        onDoubleClick={() => { onNoteSelect(note.id, { returnFocusId: note.id }); }}
        draggable
        onDragStart={(e) => {
          if (editingCell || (e.target instanceof Element && e.target.closest('input, textarea, button, a, label, select, [contenteditable="true"]'))) {
            e.preventDefault();
            return;
          }
          e.dataTransfer.setData('application/gnosi-note', JSON.stringify({ id: note.id, title: note.title }));
          e.dataTransfer.effectAllowed = 'copy';
        }}
      >
        {/* Cell action */}
        <RowActions model={model} note={note} isChild={isChild} />

        <RowTitleCell model={model} note={note} isChild={isChild} depth={depth} />

        {dynamicColumns.map(([key, type]) => {
          const originalMetaKey = getMetaKey(note, key);
          const val = note.metadata?.[originalMetaKey];
          const isCheckbox = type === 'checkbox';
          const checkboxChecked = !!val && val !== 'false';
          const toggleCheckbox = () => handleCellSave(note.id, key, !checkboxChecked, originalMetaKey);
          const sel = getCellSelState(note.id, key);
          const selectCell = () => { setActiveCell({ rowId: note.id, field: key }); setAnchorCell(null); };
          const openEditor = () => { setEditInitial(null); setActiveCell({ rowId: note.id, field: key }); setAnchorCell(null); setEditingCell({ rowId: note.id, field: key, originalMetaKey }); };
          return (
            <td
              key={key}
              style={{ width: columnWidths[key] || 180, maxWidth: columnWidths[key] || 180 }}
              className={`${rowPadClass} px-4 overflow-hidden truncate text-[var(--text-primary)] align-top ${sel.inRange ? 'bg-[var(--gnosi-primary)]/10' : 'hover:bg-[var(--bg-tertiary)]/50'} ${sel.isActive ? 'shadow-[inset_0_0_0_2px_var(--gnosi-primary)]' : ''}`}
              tabIndex={isCheckbox ? 0 : undefined}
              onKeyDown={isCheckbox ? (e) => {
                if (e.key === ' ' || e.key === 'Enter') {
                  e.preventDefault();
                  void toggleCheckbox();
                }
              } : undefined}
              onClick={(e) => {
                e.stopPropagation();
                if (e.shiftKey && activeCell) {
                  if (!anchorCell) setAnchorCell(activeCell);
                  setActiveCell({ rowId: note.id, field: key });
                  return;
                }
                if (isCheckbox) { selectCell(); void toggleCheckbox(); return; }
                const fieldType = getFieldType(schema, key);
                if (isComputedType(fieldType)) { selectCell(); return; }
                if (isImageField(key, fieldType)) { selectCell(); openMediaPicker(note, key, fieldType); return; }
                const alreadyActive = activeCell && activeCell.rowId === note.id && activeCell.field === key;
                if (alreadyActive) openEditor();
                else selectCell();
              }}
              onDoubleClick={(e) => {
                e.stopPropagation();
                if (isCheckbox) { void toggleCheckbox(); return; }
                const fieldType = getFieldType(schema, key);
                if (isComputedType(fieldType)) return;
                if (isImageField(key, fieldType)) { selectCell(); openMediaPicker(note, key, fieldType); return; }
                openEditor();
              }}
            >
              {renderCellContent(
                getCalculatedFieldValue(key, note, val),
                type,
                note.id,
                key,
                originalMetaKey,
              )}
            </td>
          );
        })}

        {showModifiedColumn && (
          <td
            style={{ width: columnWidths['last_modified'] || 150, maxWidth: columnWidths['last_modified'] || 150 }}
            className={`${rowPadClass} px-4 text-[var(--text-tertiary)] flex items-center gap-1.5 overflow-hidden truncate align-top ${isListView ? '' : 'border-l border-[var(--border-primary)]'}`}
          >
            <Clock size={14} className="shrink-0" />
            <span className="truncate">{metadataDate(note.last_modified).toLocaleDateString(i18n.language)}</span>
          </td>
        )}
      </tr>
    );
  };
  return renderRow;
}
