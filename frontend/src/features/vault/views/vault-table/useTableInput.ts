import type React from 'react';
import { isComputedType } from '../../properties/cellGridUtils';
import { getFieldType } from '../../../../shared/records/model/schemaUtils';
import { displayString } from './fieldConfig';
import { getMetaKey } from './metadata';
import type { TableInputs } from './tableInputs';
import type { useTableColumns } from './useTableColumns';
import type { useTableData } from './useTableData';
import type { useTableOptimistic } from './useTableOptimistic';
import type { useTableSave } from './useTableSave';
import type { useTableState } from './useTableState';

type Inputs = Pick<TableInputs, 'schema'>
  & Pick<ReturnType<typeof useTableSave>, 'handleCellSave'>
  & Pick<ReturnType<typeof useTableColumns>, 'dynamicColumns'>
  & Pick<ReturnType<typeof useTableData>, 'sortedNotes'>
  & Pick<ReturnType<typeof useTableOptimistic>, 'safeNotes'>
  & Pick<ReturnType<typeof useTableState>, 'setEditingCell'>;

export function useTableInput({ schema, handleCellSave, dynamicColumns, sortedNotes, safeNotes, setEditingCell }: Inputs) {
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, noteId: string, field: string, originalMetaKey: string) => {
    const fieldType = getFieldType(schema, field);
    const isComputed = fieldType === 'formula' || fieldType === 'rollup';
    if (isComputed) return;

    if (e.key === 'Tab') {
      e.preventDefault();
      const tabRaw = e.currentTarget.value;
      const tabVal = fieldType === 'number'
        ? (displayString(tabRaw).trim() === '' ? '' : (Number.isFinite(Number(tabRaw)) ? Number(tabRaw) : tabRaw))
        : tabRaw;
      void handleCellSave(noteId, field, tabVal, originalMetaKey);
      const columns = ['title', ...dynamicColumns.map(([k]) => k)].filter(c => {
        if (c === 'title') return true;
        const tCol = getFieldType(schema, c);
        return !isComputedType(tCol) && tCol !== 'files';
      });
      const currentIndex = columns.indexOf(field);
      if (currentIndex === -1) return;
      let nextIndex = e.shiftKey ? currentIndex - 1 : currentIndex + 1;
      let nextNoteId = noteId;
      if (nextIndex >= columns.length) {
        nextIndex = 0;
        const noteIndex = sortedNotes.findIndex(n => n.id === noteId);
        if (noteIndex < sortedNotes.length - 1) nextNoteId = (sortedNotes[noteIndex + 1]?.id ?? nextNoteId);
      } else if (nextIndex < 0) {
        nextIndex = columns.length - 1;
        const noteIndex = sortedNotes.findIndex(n => n.id === noteId);
        if (noteIndex > 0) nextNoteId = (sortedNotes[noteIndex - 1]?.id ?? nextNoteId);
      }
      const nextField = columns[nextIndex];
      if (!nextField) return;
      const nextNote = safeNotes.find(n => n.id === nextNoteId);
      const nextOriginalMetaKey = nextNote ? getMetaKey(nextNote, nextField) : nextField;
      setEditingCell({ rowId: nextNoteId, field: nextField, originalMetaKey: nextOriginalMetaKey });
    }
  };
  return { handleKeyDown };
}
