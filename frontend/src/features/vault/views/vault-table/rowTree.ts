import { normalizeOptions } from '../../../../shared/records/model/optionCatalogUtils';
import { getFieldConfig, type VaultSchema } from '../../../../shared/records/model/schemaUtils';
import type { TableGroupMetadata, TableRowRecord } from './rowTypes';

export function buildTableRowTree<Note extends TableRowRecord>(
  safeNotes: readonly Note[],
  sortedAndFilteredNotes: readonly Note[],
  enableSubitems: boolean,
) {
  const allIds = new Set(safeNotes.map(note => note.id));
  const children = new Map<string, Note[]>();
  const allChildren = new Map<string, Note[]>();
  const sortedNotes: Note[] = [];
  const parentOf = (note: Note) => note.metadata?.parent_id || note.parent_id || note.metadata?.source_parent_id;
  const add = (map: Map<string, Note[]>, parent: string, note: Note) => {
    const list = map.get(parent) ?? [];
    list.push(note);
    map.set(parent, list);
  };
  if (enableSubitems) {
    for (const note of sortedAndFilteredNotes) {
      const parent = parentOf(note);
      if (typeof parent === 'string' && allIds.has(parent)) add(children, parent, note);
      else sortedNotes.push(note);
    }
    // Propagation must include filtered-out children; visible children alone
    // cannot decide whether all subtasks are completed or compute date bounds.
    for (const note of safeNotes) {
      const parent = parentOf(note);
      if (typeof parent === 'string' && allIds.has(parent)) add(allChildren, parent, note);
    }
  } else sortedNotes.push(...sortedAndFilteredNotes);
  return {
    sortedNotes,
    childrenMap: Object.fromEntries(children),
    allChildrenByParent: Object.fromEntries(allChildren),
  };
}

export function buildTableGroupMetadata(
  field: string,
  schema: VaultSchema,
  allNotes: readonly TableRowRecord[],
  idToTitle: Readonly<Record<string, string>>,
): TableGroupMetadata | null {
  if (!field) return null;
  const config = getFieldConfig(schema, field);
  const options = Array.isArray(config.options) ? normalizeOptions(config.options) : [];
  const relationDatabase = config.relation_database_id;
  const related = allNotes.filter(note => (
    note.resolved_table_id || note.metadata?.table_id || note.metadata?.database_table_id
  ) === relationDatabase);
  return {
    fieldId: config.id || null,
    optionOrder: options.map(option => option.name),
    colorMap: Object.fromEntries(options.map(option => [option.name, option.color])),
    labelMap: relationDatabase
      ? Object.fromEntries(related.map(note => [note.id, note.title || idToTitle[note.id] || note.id]))
      : null,
  };
}
