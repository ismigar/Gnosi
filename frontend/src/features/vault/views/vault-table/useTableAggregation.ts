import { formatDate, formatNumber, resolveFieldFormat } from '../../../../shared/records/model/formatUtils';
import { parsePeriod } from '../../properties/VaultDateProperty';
import { displayString, getTableFieldConfig } from './fieldConfig';
import { getMetaKey } from './metadata';
import { metadataDate } from './cellValues';
import type { TableInputs } from './tableInputs';
import type { TableNote } from './types';
import type { useTableData } from './useTableData';
import type { useTableIdentity } from './useTableIdentity';
import type { useTableState } from './useTableState';
import type { useTableValues } from './useTableValues';

type Inputs = Pick<ReturnType<typeof useTableState>, 'aggregations'>
  & Pick<ReturnType<typeof useTableData>, 'sortedNotes'>
  & Pick<ReturnType<typeof useTableValues>, 'getCalculatedFieldValue'>
  & Pick<TableInputs, 'schema'>
  & Pick<ReturnType<typeof useTableIdentity>, 'localeSettings'>;

export function useTableAggregation({ aggregations, sortedNotes, getCalculatedFieldValue, schema, localeSettings }: Inputs) {
  const calculateAggregation = (field: string, type: string, notesSubset: readonly TableNote[] | null = null) => {
    const func = aggregations[field];
    if (!func || func === 'none') return null;
    const sourceNotes = notesSubset || sortedNotes;
    const values = sourceNotes.map(note => {
      if (field === 'title') return note.title;
      if (field === 'last_modified') return note.last_modified;
      const calculated = getCalculatedFieldValue(field, note, undefined);
      if (calculated !== undefined) {
        return calculated;
      }
      const originalMetaKey = getMetaKey(note, field);
      return note.metadata?.[originalMetaKey];
    }).filter(v => v !== undefined && v !== null && v !== '');
    if (func === 'count') return values.length;
    if (type === 'number' || field === 'size' || type === 'formula' || type === 'rollup') {
      const nums = values.map(v => {
        const t = displayString(v).trim();
        return /^-?\d+,\d+$/.test(t) ? Number(t.replace(',', '.')) : Number(t);
      }).filter(v => !isNaN(v));
      if (nums.length === 0) return 0;
      const aggFmt = resolveFieldFormat(getTableFieldConfig(schema, field), localeSettings);
      const fnum = (n: number) => formatNumber(n, { kind: aggFmt.kind, decimals: aggFmt.decimals, currencyCode: aggFmt.currencyCode, locale: aggFmt.numberLocale });
      if (func === 'sum') return fnum(nums.reduce((a, b) => a + b, 0));
      if (func === 'avg') return fnum(nums.reduce((a, b) => a + b, 0) / nums.length);
      if (func === 'min') return fnum(Math.min(...nums));
      if (func === 'max') return fnum(Math.max(...nums));
    }
    if (type === 'date' || type === 'datetime' || type === 'period' || field === 'last_modified') {
      const aggDateFmt = resolveFieldFormat(getTableFieldConfig(schema, field), localeSettings);
      const formatAggDate = (d: Date) => formatDate(d, { dateFormat: aggDateFmt.dateFormat, type: 'date', locale: aggDateFmt.dateLocale });
      if (type === 'period') {
        if (func === 'earliest') {
          const dates = values.map(v => new Date(parsePeriod(v).start)).filter(d => !Number.isNaN(d.getTime()));
          return dates.length ? formatAggDate(new Date(Math.min(...dates.map(d => d.getTime())))) : '-';
        }
        if (func === 'latest') {
          const dates = values.map(v => {
            const period = parsePeriod(v);
            return new Date(period.end || period.start);
          }).filter(d => !Number.isNaN(d.getTime()));
          return dates.length ? formatAggDate(new Date(Math.max(...dates.map(d => d.getTime())))) : '-';
        }
      } else {
        const dates = values.map(v => metadataDate(v)).filter(d => !Number.isNaN(d.getTime()));
        if (dates.length === 0) return '-';
        if (func === 'earliest') return formatAggDate(new Date(Math.min(...dates.map(d => d.getTime()))));
        if (func === 'latest') return formatAggDate(new Date(Math.max(...dates.map(d => d.getTime()))));
      }
    }
    return values.length;
  };
  return { calculateAggregation };
}
