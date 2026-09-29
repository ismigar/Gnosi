import { isComputedType } from '../../../properties/cellGridUtils';
import { evaluateFormula } from '../../../properties/formulaUtils';
import { evaluateRollup } from '../../../properties/rollupUtils';
import { normalizeRelationValues } from '../../../properties/relationItemUtils';
import type { PageMetadata, PageNote, PageProperty, PagePropertyConfig, PageTable } from './types';
import { isRecord, legacyText } from './valueBoundaries';

/** Modal saves use top-level settings; inline option edits use config.options. */
export function pagePropertyConfig(prop: PageProperty | null): PagePropertyConfig {
  if (!prop) return {};
  const { config, name: _name, type: _type, ...settings } = prop;
  return { ...config, ...settings, ...(Array.isArray(config?.options) ? { options: config.options } : {}) };
}

export function isPagePropertyReadOnly(prop: PageProperty): boolean {
  return isComputedType(prop.type) || prop.type === 'created_by' || prop.type === 'last_edited_by'
    || pagePropertyConfig(prop).read_only === true;
}

/** Match the table's stable-ID precedence, retaining false and zero. */
export function storedPropertyValue(metadata: PageMetadata, prop: PageProperty): unknown {
  const id = pagePropertyConfig(prop).id;
  return id && metadata[id] !== undefined ? metadata[id] : metadata[prop.name];
}

export function namedPropertyMetadata(metadata: PageMetadata, properties: readonly PageProperty[]): PageMetadata {
  const result = { ...metadata };
  for (const prop of properties) {
    const id = pagePropertyConfig(prop).id;
    if (id && id !== prop.name && result[id] !== undefined) {
      result[prop.name] = result[id];
      Reflect.deleteProperty(result, id);
    }
  }
  return result;
}

export function pagePropertyValue(prop: PageProperty, metadata: PageMetadata, notes: readonly PageNote[], tables: readonly PageTable[]): unknown {
  const stored = storedPropertyValue(metadata, prop);
  const config = pagePropertyConfig(prop);
  if (prop.type === 'formula' && typeof config.formula === 'string' && config.formula) {
    return evaluateFormula(config.formula, metadata, metadata.title);
  }
  if (prop.type === 'rollup' && typeof config.relationField === 'string') {
    const aggregation = typeof config.aggregation === 'string' ? config.aggregation : 'count_values';
    let ids = normalizeRelationValues(metadata[config.relationField]);
    const limit = Number(config.limit);
    if (limit > 0) ids = ids.slice(0, limit);
    if (aggregation === 'count_all') return evaluateRollup(ids, aggregation);
    const byId = new Map(notes.map(note => [note.id, note]));
    const values = ids.map(id => {
      const note = byId.get(id);
      if (!note || typeof config.targetProperty !== 'string') return undefined;
      if (config.targetProperty === 'title') return note.title;
      const tableId = note.resolved_table_id || note.metadata?.table_id || note.metadata?.database_table_id;
      const target = tables.find(table => table.id === tableId)?.properties?.find(field => field.name === config.targetProperty || field.id === config.targetProperty);
      return target ? storedPropertyValue(note.metadata || {}, target) : note.metadata?.[config.targetProperty];
    });
    return evaluateRollup(values, aggregation);
  }
  if (prop.type === 'created_by' || prop.type === 'last_edited_by') return stored ?? metadata[prop.type];
  // Virtual values are computed by the backend, not by the page editor.
  return stored;
}

export function propertyDisplayText(value: unknown): string {
  if (value == null) return '';
  if (Array.isArray(value)) return value.map(propertyDisplayText).filter(Boolean).join(', ');
  if (isRecord(value)) {
    const label = value.display_name ?? value.name ?? value.plain_text ?? value.email;
    if (typeof label === 'string') return label;
    return JSON.stringify(value);
  }
  return legacyText(value);
}
