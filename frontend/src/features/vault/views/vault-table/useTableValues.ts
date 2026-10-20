import { useCallback } from 'react';
import { evaluateSpreadsheetFormula, isCellFormula, supportsCellFormula } from './spreadsheetFormula';
import { getMetaKey } from './metadata';
import type { useTableRows } from './useTableRows';
import type { useTableColumns } from './useTableColumns';
import { getFieldType } from '../../../../shared/records/model/schemaUtils';
import type { TableFieldConfig } from './fieldConfig';
import { displayString, getTableFieldConfig } from './fieldConfig';
import { evaluateFormula as evaluateTableFormula } from '../../properties/formulaUtils';
import { evaluateRollup as evaluateTableRollup } from '../../properties/rollupUtils';
import type { TableInputs } from './tableInputs';
import type { TableNote } from './types';

type Inputs = Pick<TableInputs, 'schema' | 'allNotes'>
  & Pick<ReturnType<typeof useTableRows>, 'formulaRows'>
  & Pick<ReturnType<typeof useTableColumns>, 'gridColumns'>;

export function useTableValues({ schema, allNotes, formulaRows, gridColumns }: Inputs) {
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
  const getCalculatedFieldValue = useCallback((field: string, note: TableNote, fallbackValue: unknown = note.metadata?.[getMetaKey(note, field)]) => {
    const fieldType = getFieldType(schema, field);
    const fieldConfig = getTableFieldConfig(schema, field);

    if (fieldType === 'formula' && fieldConfig.formula) {
      return calculateFormula(fieldConfig.formula, note);
    }

    if (fieldType === 'rollup') {
      return calculateRollup(fieldConfig, note);
    }

    const stored = note.metadata?.[getMetaKey(note, field)];
    if (supportsCellFormula(fieldType) && isCellFormula(stored)) {
      const visiting = new Set<string>();
      const cache = new Map<string, unknown>();
      let budget = 10000;
      const read = (rowNote: TableNote, key: string): unknown => {
        const identity = `${rowNote.id}::${key}`;
        if (visiting.has(identity)) return '#CYCLE!';
        if (cache.has(identity)) return cache.get(identity);
        if (--budget < 0 || visiting.size > 64) return '#ERROR!';
        if (key === 'title') return rowNote.title ?? '';
        const raw = rowNote.metadata?.[getMetaKey(rowNote, key)];
        const type = getFieldType(schema, key);
        if (type === 'formula') return calculateFormula(getTableFieldConfig(schema, key).formula, rowNote);
        if (type === 'rollup') return calculateRollup(getTableFieldConfig(schema, key), rowNote);
        if (!supportsCellFormula(type) || !isCellFormula(raw)) return raw;
        visiting.add(identity);
        const result = evaluateSpreadsheetFormula(raw, {
          cell: (r, c) => {
            const target = formulaRows[r]; const column = gridColumns[c];
            return target && column ? read(target, column.key) : '#REF!';
          },
          field: name => name === 'title' || Object.hasOwn(schema, name) ? read(rowNote, name) : '#REF!',
        });
        visiting.delete(identity); cache.set(identity, result);
        return result;
      };
      return read(note, field);
    }
    return fallbackValue;
  }, [schema, calculateFormula, calculateRollup, formulaRows, gridColumns]);
  return { getCalculatedFieldValue };
}
