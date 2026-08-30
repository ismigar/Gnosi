import { useEffect, useState } from 'react';
import { notifyError } from '../../../../shared/notifications/notifyError';
import { fetchOptionCatalogs, removeTableOption } from '../../../../shared/api/vault-schema';
import { dedupeAuthors } from '../../properties/autoriaUtils';
import { normalizeOptions } from '../../../../shared/records/model/optionCatalogUtils';
import { getSchemaFieldNames } from '../../../../shared/records/model/schemaUtils';
import { displayString, getTableFieldConfig, isRecord } from './fieldConfig';
import { getMetaKey } from './metadata';
import type { TableInputs } from './tableInputs';
import type { useTableData } from './useTableData';
import type { useTableIdentity } from './useTableIdentity';
import type { useTableOptimistic } from './useTableOptimistic';

type Inputs = Pick<TableInputs, 'schema' | 'onUpdateFieldOptions' | 'activeView' | 'onCellSaved'>
  & Pick<ReturnType<typeof useTableOptimistic>, 'safeNotes' | 'setOptimisticPatches'>
  & Pick<ReturnType<typeof useTableData>, 'resolveNoteTableId'>
  & Pick<ReturnType<typeof useTableIdentity>, 't'>;

export function useTableOptions({
  schema,
  safeNotes,
  onUpdateFieldOptions,
  activeView,
  resolveNoteTableId,
  setOptimisticPatches,
  onCellSaved,
  t,
}: Inputs) {
  const [sharedOptionCatalogs, setSharedOptionCatalogs] = useState<Record<string, unknown>>({});
  useEffect(() => {
    const needsCatalogs = getSchemaFieldNames(schema)
      .some((name) => getTableFieldConfig(schema, name).catalog_ref);
    if (!needsCatalogs) return undefined;
    let cancelled = false;
    fetchOptionCatalogs()
      .then((response) => { if (!cancelled) setSharedOptionCatalogs(isRecord(response.catalogs) ? response.catalogs : {}); })
      .catch(() => { });
    return () => { cancelled = true; };
  }, [schema]);
  const getCatalogOptions = (field: string) => {
    const config = getTableFieldConfig(schema, field);
    if (config.catalog_ref) {
      return normalizeOptions(sharedOptionCatalogs[config.catalog_ref] || []);
    }
    if (Array.isArray(config.options) && config.options.length > 0) {
      return normalizeOptions(config.options);
    }
    return [];
  };
  const getOptionColorMap = (field: string) => {
    const map: Record<string, string> = {};
    for (const o of getCatalogOptions(field)) map[o.name] = o.color;
    return map;
  };
  const getAvailableOptions = (field: string, type: string) => {
    const catalog = getCatalogOptions(field);
    if (catalog.length > 0) return catalog.map((o) => o.name);
    const values = safeNotes
      .map(n => n.metadata?.[getMetaKey(n, field)])
      .filter(v => v !== undefined && v !== null && v !== '');
    if (type === 'multi_select') {
      const flat: string[] = [];
      for (const v of values) {
        if (Array.isArray(v)) {
          flat.push(
            ...v
              .filter(x => typeof x === 'string' || typeof x === 'number' || typeof x === 'boolean')
              .map(x => displayString(x).trim())
              .filter(Boolean)
          );
        } else if (typeof v === 'string') flat.push(...v.split(',').map(x => x.trim()).filter(Boolean));
      }
      return Array.from(new Set(flat));
    }
    return Array.from(new Set(values.map(displayString)));
  };
  const updateFieldOptions = (field: string, nextOptions: readonly unknown[]) => {
    if (!onUpdateFieldOptions || !Array.isArray(nextOptions)) return;
    const tableId = activeView?.table_id || (safeNotes.length > 0 ? resolveNoteTableId(safeNotes[0]) : null);
    const fieldId = getTableFieldConfig(schema, field).id;
    if (!tableId || !fieldId) return;
    onUpdateFieldOptions(tableId, fieldId, nextOptions);
  };
  const removeOptionEverywhere = async (field: string, type: string, optionValue: string) => {
    const tableId = activeView?.table_id || (safeNotes.length > 0 ? resolveNoteTableId(safeNotes[0]) : null);
    const fieldId = getTableFieldConfig(schema, field).id;

    setOptimisticPatches(prev => {
      const next = new Map(prev);
      for (const n of safeNotes) {
        const key = getMetaKey(n, field);
        const v = n.metadata?.[key];
        if (type === 'multi_select') {
          const arr = Array.isArray(v)
            ? v
            : (typeof v === 'string' && v ? v.split(',').map(s => s.trim()).filter(Boolean) : []);
          if (arr.includes(optionValue)) {
            const existing = next.get(n.id) || {};
            next.set(n.id, { ...existing, [key]: arr.filter(x => x !== optionValue) });
          }
        } else if (v === optionValue) {
          const existing = next.get(n.id) || {};
          next.set(n.id, { ...existing, [key]: '' });
        }
      }
      return next;
    });

    try {
      if (tableId && fieldId) {
        await removeTableOption(tableId, fieldId, optionValue);
      } else {
        const cfg = getTableFieldConfig(schema, field);
        if (Array.isArray(cfg.options) && cfg.options.length > 0) {
          updateFieldOptions(field, normalizeOptions(cfg.options).filter(o => o.name !== optionValue));
        }
      }
      if (onCellSaved) onCellSaved();
    } catch (err) {
      notifyError('remove-option-everywhere', err, t('table.remove_option_error', "Error removing the option from the records"));
    }
  };
  const getAutoriaSuggestions = (field: string) =>
    dedupeAuthors(safeNotes.map(n => n.metadata?.[getMetaKey(n, field)]));
  return { getOptionColorMap, getAvailableOptions, updateFieldOptions, removeOptionEverywhere, getAutoriaSuggestions };
}
