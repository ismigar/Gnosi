import type React from 'react';
import { useCallback } from 'react';
import { toast } from '../../../../shared/notifications/toast';
import { apiErrorDetail } from '../../../../shared/api/errors';
import { executeVaultTableButtonAction } from '../../../../shared/api/vault-table';
import { announceRelationUnlinked, withoutRelationValue } from '../../properties/relationItemUtils';
import type { TableFunctionality } from './fieldConfig';
import { evaluateFormula as evaluateTableFormula } from '../../properties/formulaUtils';
import { normalizeRelationValues as normalizeTableRelations } from '../../properties/relationItemUtils';
import type { TableInputs } from './tableInputs';
import type { TableNote } from './types';
import type { useTableEntry } from './useTableEntry';
import type { useTableIdentity } from './useTableIdentity';
import type { useTableOptimistic } from './useTableOptimistic';
import type { useTableSave } from './useTableSave';

type Inputs = Pick<ReturnType<typeof useTableOptimistic>, 'safeNotes'>
  & Pick<ReturnType<typeof useTableSave>, 'handleCellSave'>
  & Pick<ReturnType<typeof useTableEntry>, 'executingButtonKey' | 'setPendingAction' | 'setExecutingButtonKey'>
  & Pick<ReturnType<typeof useTableIdentity>, 't'>
  & Pick<TableInputs, 'onTranslated'>;

export function useTableActions({
  safeNotes,
  handleCellSave,
  executingButtonKey,
  setPendingAction,
  t,
  setExecutingButtonKey,
  onTranslated,
}: Inputs) {
  const handleRelationUnlink = useCallback(async (noteId: string, field: string, originalMetaKey: string, relationId: string, displayMap: Readonly<Record<string, string>>) => {
    const note = safeNotes.find(item => item.id === noteId);
    if (!note) return false;
    const previousValue = normalizeTableRelations(note.metadata?.[originalMetaKey]);
    const nextValue = withoutRelationValue(previousValue, relationId);
    if (nextValue.length === previousValue.length) return false;

    const saved = await handleCellSave(noteId, field, nextValue, originalMetaKey);
    if (!saved) return false;

    announceRelationUnlinked({
      pageId: noteId,
      field,
      metadataKey: originalMetaKey,
      relationId,
      relationTitle: displayMap[relationId] || relationId,
      previousValue,
      nextValue,
    });
    return true;
  }, [handleCellSave, safeNotes]);
  const executeTableFunctionality = async (event: React.MouseEvent | null, note: TableNote, functionality: TableFunctionality) => {
    event?.stopPropagation();
    if (!functionality.enabled) return;
    const action = functionality.action || 'translate_row';
    const config = functionality.config;
    const buttonKey = `${note.id}_${functionality.id}`;
    if (executingButtonKey === buttonKey) return;

    if (action === 'translate_row' || action === 'sync_drupal' || action === 'publish_social' || action === 'process_resource') {
      setPendingAction({
        noteId: note.id,
        fieldConfig: { button_action: action, button_config: config },
        action,
      });
      return;
    }

    if (action === 'set_fields') {
      const assignments = config.assignments || [];
      if (assignments.length === 0) {
        toast.error(t('schema.no_assignments_error', 'No field assignments configured for this functionality'));
        return;
      }
      for (const assignment of assignments) {
        if (!assignment.field) continue;
        let value = assignment.value ?? '';
        if (typeof value === 'string' && (value.includes('(') || value.includes('{') || value.includes('+'))) {
          const evaluated = evaluateTableFormula(value, note.metadata || {}, note.title || '');
          if (evaluated !== null) value = evaluated;
        }
        await handleCellSave(note.id, assignment.field, value, assignment.field);
      }
      toast.success(t('schema.functionality_executed_success', 'Functionality executed successfully'));
      return;
    }

    if (action === 'ai_prompt' || action === 'run_skill') {
      setExecutingButtonKey(buttonKey);
      try {
        const response = await executeVaultTableButtonAction({
          note_id: note.id,
          button_action: action,
          button_config: config,
        });
        if (response.status === 'ok') {
          toast.success(t('schema.functionality_executed_success', 'Functionality executed successfully'));
          onTranslated?.({});
        }
      } catch (error) {
        toast.error(apiErrorDetail(error, t('schema.functionality_execute_error', 'Could not execute functionality')));
      } finally {
        setExecutingButtonKey(null);
      }
    }
  };
  return { handleRelationUnlink, executeTableFunctionality };
}
