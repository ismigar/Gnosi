import { useCallback } from 'react';
import { getFieldType } from '../schemaUtils';
import type { TableFieldConfig } from './fieldConfig';
import { displayString, getTableFieldConfig } from './fieldConfig';
import { evaluateFormula as evaluateTableFormula } from '../formulaUtils';
import { evaluateRollup as evaluateTableRollup } from '../rollupUtils';
import type { TableInputs } from './tableInputs';
import type { TableNote } from './types';

type Inputs = Pick<TableInputs, 'schema' | 'allNotes'>;

export function useTableValues({ schema, allNotes }: Inputs) {
  const calculateFormula = useCallback((formula: unknown, note: TableNote | undefined) => evaluateTableFormula(
    formula,
    note?.metadata || {},
    note?.title || '',
  ), []);
  const calculateRollup = useCallback((config: TableFieldConfig, note: TableNote | undefined) => {
    const relationField = config.relationField;
    const aggregation = config.aggregation || 'count_values';
    const raw = note?.metadata?.[relationField ?? 'undefined'];
    let relatedIds = Array.isArray(raw)
      ? raw.map(String)
      : (raw != null && raw !== '' ? [displayString(raw)] : []);
    if (config.limit) relatedIds = relatedIds.slice(0, Number(config.limit));
    if (aggregation === 'count_all') return evaluateTableRollup(relatedIds, 'count_all');
    const byId = new Map(allNotes.map(n => [n.id, n]));
    const values = relatedIds.map(id => byId.get(id)?.metadata?.[config.targetProperty ?? 'undefined']);
    return evaluateTableRollup(values, aggregation);
  }, [allNotes]);
  const getCalculatedFieldValue = useCallback((field: string, note: TableNote, fallbackValue: unknown = null) => {
    const fieldType = getFieldType(schema, field);
    const fieldConfig = getTableFieldConfig(schema, field);

    if (fieldType === 'formula' && fieldConfig.formula) {
      return calculateFormula(fieldConfig.formula, note);
    }

    if (fieldType === 'rollup') {
      return calculateRollup(fieldConfig, note);
    }

    return fallbackValue;
  }, [schema, calculateFormula, calculateRollup]);
  return { getCalculatedFieldValue };
}
