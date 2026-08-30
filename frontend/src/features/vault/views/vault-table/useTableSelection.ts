import { useCallback, useEffect } from 'react';
import { useVaultSelection } from '../../../../shared/records/hooks/useVaultSelection';
import { useVaultSelectionShortcuts } from '../../../../shared/records/hooks/useVaultSelectionShortcuts';
import { subscribeWindowEvent } from '../../../../shared/platform/browser-events';
import type { TableInputs } from './tableInputs';
import { useLatestRef } from './useLatestRef';
import type { useTableData } from './useTableData';
import type { useTableOptimistic } from './useTableOptimistic';
import type { useTableState } from './useTableState';

type Inputs = Pick<ReturnType<typeof useTableData>, 'sortedNotes'>
  & Pick<TableInputs, 'onDeleteSelected' | 'onDeletePage' | 'onApplyTemplate' | 'onNoteSelect'>
  & Pick<ReturnType<typeof useTableOptimistic>, 'safeNotes'>
  & Pick<ReturnType<typeof useTableState>, 'editingCell'>;

export function useTableSelection({
  sortedNotes,
  onDeleteSelected,
  onDeletePage,
  safeNotes,
  onApplyTemplate,
  editingCell,
  onNoteSelect,
}: Inputs) {
  const { selectedIds, isSelected, toggleSelect, selectAll, clearSelection } = useVaultSelection(sortedNotes);
  const lastSelectedId = [...selectedIds].at(-1) ?? null;
  const selectedIdsRef = useLatestRef<Set<string> | null>(selectedIds);
  const handleBulkDelete = useCallback(() => {
    if (selectedIds.size === 0) return;
    if (onDeleteSelected) {
      onDeleteSelected(new Set(selectedIds));
      clearSelection();
    } else if (onDeletePage) {
      selectedIds.forEach(id => {
        const note = safeNotes.find(n => n.id === id);
        if (note) onDeletePage(id, note.title);
      });
      clearSelection();
    }
  }, [selectedIds, onDeleteSelected, onDeletePage, safeNotes, clearSelection]);
  const handleApplyTemplate = useCallback((templateId: string) => {
    if (!templateId || selectedIds.size === 0 || !onApplyTemplate) return;
    onApplyTemplate(new Set(selectedIds), templateId);
    clearSelection();
  }, [selectedIds, onApplyTemplate, clearSelection]);
  // The former JSX passed selectedCount/onClearSelection/onDeleteSelection,
  // which this shared hook never consumed. Preserve that behavior: wiring new
  // global deletion shortcuts requires a separate multi-table ownership change.
  useVaultSelectionShortcuts({
    enabled: !editingCell,
  });
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'o') {
        if (lastSelectedId) {
          e.preventDefault();
          onNoteSelect(lastSelectedId, { returnFocusId: lastSelectedId });
        }
      }
    };
    const unsubscribehandleKeyDown = subscribeWindowEvent('keydown', handleKeyDown);
    return () => { unsubscribehandleKeyDown(); };
  }, [lastSelectedId, onNoteSelect]);
  return { selectedIds, isSelected, toggleSelect, selectAll, clearSelection, selectedIdsRef, handleBulkDelete, handleApplyTemplate };
}
