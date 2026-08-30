import { useCallback } from 'react';
import { notifyError } from '../../../lib/notifyError';
import { toast } from '../../../lib/toast';
import { apiErrorDetail } from '../../../shared/api/errors';
import { createVaultTablePage } from '../../../shared/api/vault-table';
import { applyDefaultFormulasToMetadata as applyTableDefaults } from '../defaultFormulaUtils';
import type { TableInputs } from './tableInputs';
import type { useTableData } from './useTableData';
import type { useTableEntry } from './useTableEntry';
import type { useTableIdentity } from './useTableIdentity';
import type { useTableOptimistic } from './useTableOptimistic';
import type { useTableState } from './useTableState';

type Inputs = Pick<ReturnType<typeof useTableState>, 'newSubitemTitle' | 'setAddingSubitemFor' | 'setNewSubitemTitle' | 'setExpandedRows'>
  & Pick<ReturnType<typeof useTableOptimistic>, 'safeNotes'>
  & Pick<TableInputs, 'activeView' | 'schema' | 'onCellSaved' | 'onUpdateView' | 'onNoteSelect'>
  & Pick<ReturnType<typeof useTableIdentity>, 't'>
  & Pick<ReturnType<typeof useTableEntry>, 'newRowTitle' | 'setNewRowTitle'>
  & Pick<ReturnType<typeof useTableData>, 'resolveNoteTableId'>;

export function useTableCreate({
  newSubitemTitle,
  setAddingSubitemFor,
  setNewSubitemTitle,
  safeNotes,
  activeView,
  schema,
  setExpandedRows,
  onCellSaved,
  onUpdateView,
  t,
  newRowTitle,
  resolveNoteTableId,
  setNewRowTitle,
  onNoteSelect,
}: Inputs) {
  const handleCreateSubitem = useCallback(async (parentId: string) => {
    const title = newSubitemTitle.trim();
    if (!title) {
      setAddingSubitemFor(null);
      setNewSubitemTitle('');
      return;
    }
    try {
      const parentNote = safeNotes.find(n => n.id === parentId);
      const tableId = activeView?.table_id || parentNote?.resolved_table_id || parentNote?.metadata?.table_id || parentNote?.metadata?.database_table_id;
      const baseMetadata = {
        title: title,
        parent_id: parentId,
        table_id: tableId,
        database_table_id: tableId,
        ...(parentNote?.metadata?.database_id ? { database_id: parentNote.metadata.database_id } : {})
      };
      const metadataWithDefaults = applyTableDefaults({
        schema,
        metadata: baseMetadata,
        title,
        notes: safeNotes,
        currentTableId: tableId,
      });
      await createVaultTablePage({
        title,
        content: '',
        parent_id: parentId,
        metadata: metadataWithDefaults
      });

      setExpandedRows(prev => new Set([...prev, parentId]));
      if (onCellSaved) onCellSaved();
      else if (onUpdateView) onUpdateView(activeView);
      toast.success(t('table.subitem_created'));
    } catch (error) {
      notifyError('table-create-subitem', error, t('table.subitem_create_error'));
    } finally {
      setAddingSubitemFor(null);
      setNewSubitemTitle('');
    }
  }, [newSubitemTitle, setAddingSubitemFor, setNewSubitemTitle, safeNotes, activeView, schema, setExpandedRows, onCellSaved, onUpdateView, t]);
  const handleCreateRowRecord = useCallback(async () => {
    const title = newRowTitle.trim();
    if (!title) return;

    try {
      const tableId = activeView?.table_id || (safeNotes.length > 0 ? resolveNoteTableId(safeNotes[0]) : null);
      if (!tableId) {
        console.warn("VaultTable: Could not determine tableId");
      }

      const baseMetadata = {
        title,
        table_id: tableId,
        database_table_id: tableId,
      };

      const metadataWithDefaults = applyTableDefaults({
        schema,
        metadata: baseMetadata,
        title,
        notes: safeNotes,
        currentTableId: tableId,
      });

      const res = await createVaultTablePage({
        title,
        content: '',
        metadata: metadataWithDefaults
      });

      setNewRowTitle('');
      if (onCellSaved) onCellSaved();
      toast.success(t('table.record_created'));
      const newId = res.id;
      if (newId) {
        onNoteSelect(newId, { returnFocusId: newId });
      }
    } catch (error) {
      const errorMsg = apiErrorDetail(error, t('table.record_create_error'));
      notifyError('table-create-record', error, errorMsg);
    }
  }, [newRowTitle, activeView, safeNotes, resolveNoteTableId, schema, setNewRowTitle, onCellSaved, t, onNoteSelect]);
  return { handleCreateSubitem, handleCreateRowRecord };
}
