import { notifyError } from '../../../lib/notifyError';
import { patchVaultTablePage } from '../../../shared/api/vault-table';
import { withPeriodBoundaries } from '../../../utils/projectPlanning';
import { sameCellValue } from '../cellGridUtils';
import { getFieldType } from '../schemaUtils';
import { parsePeriod } from '../VaultDateProperty';
import { displayString } from './fieldConfig';
import { getMetaKey } from './metadata';
import { metadataDate, tablePeriod } from './sharedCompatibility';
import type { TableInputs } from './tableInputs';
import type { CellSave, MetadataPatch } from './types';
import type { useTableData } from './useTableData';
import type { useTableIdentity } from './useTableIdentity';
import type { useTableOptimistic } from './useTableOptimistic';
import type { useTableState } from './useTableState';

type Inputs = Pick<ReturnType<typeof useTableState>, 'setEditingCell' | 'setEditInitial'>
  & Pick<ReturnType<typeof useTableOptimistic>, 'safeNotes' | 'setOptimisticPatches'>
  & Pick<TableInputs, 'onCellSaved' | 'onUpdateView' | 'activeView' | 'schema'>
  & Pick<ReturnType<typeof useTableIdentity>, 't'>
  & Pick<ReturnType<typeof useTableData>, 'allChildrenByParent'>;

export function useTableSave({
  setEditingCell,
  setEditInitial,
  safeNotes,
  setOptimisticPatches,
  onCellSaved,
  onUpdateView,
  activeView,
  t,
  allChildrenByParent,
  schema,
}: Inputs) {
  const handleCellSave: CellSave = async (noteId: string, field: string, newValue: unknown, originalMetaKey: string, skipPropagation: boolean = false, additionalMetaUpdates: MetadataPatch = {}) => {
    setEditingCell(null);
    setEditInitial(null);
    const note = safeNotes.find(n => n.id === noteId);
    if (!note) return false;

    const currentValue = note.metadata?.[originalMetaKey];
    if (sameCellValue(currentValue, newValue) && Object.keys(additionalMetaUpdates).length === 0) return true;

    setOptimisticPatches(prev => {
      const next = new Map(prev);
      const existing = next.get(noteId) || {};
      next.set(noteId, { ...existing, [originalMetaKey]: newValue, ...additionalMetaUpdates });
      return next;
    });

    try {
      await patchVaultTablePage(noteId, {
        metadata: { [originalMetaKey]: newValue, ...additionalMetaUpdates }
      });
      if (!skipPropagation) {
        const parentId = note.metadata?.parent_id || note.parent_id;
        if (parentId) {
          await propagateToParent(parentId, field, noteId, newValue);
        }
      }
      if (onCellSaved) onCellSaved();
      else if (onUpdateView) onUpdateView(activeView);
      return true;
    } catch (error) {
      setOptimisticPatches(prev => {
        const next = new Map(prev);
        const existing = next.get(noteId);
        if (existing) {
          const { [originalMetaKey]: _removed, ...rest } = existing;
          if (Object.keys(rest).length === 0) {
            next.delete(noteId);
          } else {
            next.set(noteId, rest);
          }
        }
        return next;
      });
      notifyError('table-save-cell', error, t('table.save_cell_error', "Error saving the cell"));
      return false;
    }
  };
  const propagateToParent = async (parentId: string, changedField: string, changedChildId: string, newValue: unknown, overrides: ReadonlyMap<string, unknown> | null = null): Promise<void> => {
    const parent = safeNotes.find(n => n.id === parentId);
    if (!parent) return;

    const children = allChildrenByParent[parentId] || [];
    if (children.length === 0) return;

    const statusLike = ['status', 'checkbox', 'estat'];
    const declaredFieldType = schema[changedField];
    const isDeclaredInSchema = declaredFieldType !== undefined && declaredFieldType !== null && declaredFieldType !== '';
    const isStatusField = statusLike.includes(getFieldType(schema, changedField))
      || (!isDeclaredInSchema && statusLike.includes(changedField.toLowerCase()));
    const completedValues = new Set(['completat', 'arxivat', 'done', 'finished', 'completed', 'archivat', 'true', true]);

    if (isStatusField) {
      const allChildrenDone = children.every(child => {
        const childId = child.id;
        const val = overrides?.has(childId)
          ? overrides.get(childId)
          : (childId === changedChildId ? newValue : child.metadata?.[getMetaKey(child, changedField)]);
        return completedValues.has(displayString(val || '').toLowerCase());
      });

      if (allChildrenDone) {
        const parentMetaKey = getMetaKey(parent, changedField);
        const parentCurrentVal = parent.metadata?.[parentMetaKey];
        const completedWrite = (typeof newValue === 'string' && completedValues.has(newValue.toLowerCase()))
          ? newValue
          : (children
            .map(c => c.metadata?.[getMetaKey(c, changedField)])
            .find(v => completedValues.has(displayString(v || '').toLowerCase())) || newValue);
        const parentStatus = getFieldType(schema, changedField) === 'checkbox' ? true : completedWrite;
        if (displayString(parentCurrentVal || '').toLowerCase() !== displayString(parentStatus).toLowerCase()) {
          await handleCellSave(parentId, changedField, parentStatus, parentMetaKey, true);
        }
      }
    }

    const dateLike = ['date', 'period', 'datetime'];
    const isDateField = dateLike.includes(getFieldType(schema, changedField));

    if (isDateField) {
      const allDates = children.map(child => {
        const val = overrides?.has(child.id)
          ? overrides.get(child.id)
          : (child.id === changedChildId ? newValue : child.metadata?.[getMetaKey(child, changedField)]);
        return val || null;
      }).filter(Boolean);

      if (allDates.length > 0) {
        if (getFieldType(schema, changedField) === 'period') {
          const starts = allDates.map(v => parsePeriod(v).start).filter(Boolean).map(d => new Date(d)).filter(d => !Number.isNaN(d.getTime()));
          const ends = allDates.map(v => parsePeriod(v).end).filter(Boolean).map(d => new Date(d)).filter(d => !Number.isNaN(d.getTime()));
          if (starts.length > 0 && ends.length > 0) {
            const minStart = new Date(Math.min(...starts.map(d => d.getTime())));
            const maxEnd = new Date(Math.max(...ends.map(d => d.getTime())));
            const parentMetaKey = getMetaKey(parent, changedField);
            const parentValue = parent.metadata?.[parentMetaKey];
            const hasTime = allDates.some((item) => (
              parsePeriod(item).start.includes('T') || parsePeriod(item).end.includes('T')
            ));
            const padDatePart = (number: number) => displayString(number).padStart(2, '0');
            const localDate = (date: Date) => {
              const day = `${String(date.getFullYear())}-${padDatePart(date.getMonth() + 1)}-${padDatePart(date.getDate())}`;
              return hasTime
                ? `${day}T${padDatePart(date.getHours())}:${padDatePart(date.getMinutes())}`
                : day;
            };
            const newPeriod = withPeriodBoundaries(
              tablePeriod(parentValue),
              localDate(minStart),
              localDate(maxEnd),
              { startMode: 'auto', endMode: 'auto' },
            );
            if (JSON.stringify(parentValue) !== JSON.stringify(newPeriod)) {
              await handleCellSave(parentId, changedField, newPeriod, parentMetaKey, true);
            }
          }
        } else {
          const fieldLower = changedField.toLowerCase();
          const isEndField = /(^|[\s_-])(end|fi|fin|final)([\s_-]|$)/i.test(fieldLower);
          const dates = allDates.map(d => metadataDate(d)).filter(d => !Number.isNaN(d.getTime()));
          if (dates.length > 0) {
            const targetDate = isEndField
              ? new Date(Math.max(...dates.map(d => d.getTime()))).toISOString().split('T')[0]
              : new Date(Math.min(...dates.map(d => d.getTime()))).toISOString().split('T')[0];
            const parentMetaKey = getMetaKey(parent, changedField);
            if (parent.metadata?.[parentMetaKey] !== targetDate) {
              await handleCellSave(parentId, changedField, targetDate, parentMetaKey, true);
            }
          }
        }
      }
    }
  };
  return { handleCellSave, propagateToParent };
}
