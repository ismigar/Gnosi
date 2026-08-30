import { optionColorHex } from '../../../../shared/records/model/optionCatalogUtils';
import type { TableRowDescriptor, TableRowDescriptorInput, TableRowRecord } from './rowTypes';

const EMPTY = ' empty';

interface RowGroup<Note> {
  key: string;
  label: string;
  notes: Note[];
}

/** Match legacy String coercion for arbitrary persisted metadata, including arrays. */
function groupName(raw: unknown): string {
  if (Array.isArray(raw)) return raw.length ? String(raw[0]).trim() : '';
  const text = String(raw);
  return raw === null || raw === undefined ? '' : text.trim();
}

export function buildTableRowDescriptors<Note extends TableRowRecord>({
  groupByField,
  groupMeta,
  visibleRootNotes,
  sortedNotes,
  expandedRows,
  childrenMap,
  addingSubitemFor,
  expandedGroups,
  hasGroupAggregations,
  activeView,
  emptyGroupLabel,
}: TableRowDescriptorInput<Note>): TableRowDescriptor<Note>[] {
  const list: TableRowDescriptor<Note>[] = [];
  const pushNoteRows = (note: Note) => {
    list.push({ kind: 'row', note, isChild: false, depth: 0 });
    if (!expandedRows.has(note.id)) return;
    for (const child of childrenMap[note.id] || []) {
      list.push({ kind: 'row', note: child, isChild: true, depth: 1 });
    }
    if (addingSubitemFor === note.id) list.push({ kind: 'new-subitem', parentNote: note, depth: 1 });
  };
  if (!groupByField || !groupMeta) {
    for (const note of visibleRootNotes) pushNoteRows(note);
    return list;
  }
  const groups = new Map<string, RowGroup<Note>>();
  for (const note of sortedNotes) {
    const metadata = note.metadata || {};
    // An own property wins even if its value is empty; stable field id is a fallback only.
    const raw = Object.hasOwn(metadata, groupByField) ? metadata[groupByField]
      : groupMeta.fieldId && Object.hasOwn(metadata, groupMeta.fieldId) ? metadata[groupMeta.fieldId] : undefined;
    const name = groupName(raw);
    const id = name === '' ? EMPTY : name;
    const group = groups.get(id) ?? {
      key: id,
      label: id === EMPTY ? emptyGroupLabel : groupMeta.labelMap?.[name] || name,
      notes: [],
    };
    group.notes.push(note);
    groups.set(id, group);
  }
  const mode = activeView?.groupSort || activeView?.group_sort || 'catalog';
  const direction = (activeView?.groupSortDir || activeView?.group_sort_dir || 'asc') === 'desc' ? -1 : 1;
  const byCatalog = (a: RowGroup<Note>, b: RowGroup<Note>) => {
    const ia = groupMeta.optionOrder.indexOf(a.key);
    const ib = groupMeta.optionOrder.indexOf(b.key);
    if (ia !== -1 && ib !== -1) return ia - ib;
    if (ia !== -1) return -1;
    return ib !== -1 ? 1 : 0;
  };
  const ordered = [...groups.values()].sort((a, b) => {
    if (a.key === EMPTY) return 1;
    if (b.key === EMPTY) return -1;
    if (mode === 'alpha') return a.label.localeCompare(b.label, undefined, { numeric: true }) * direction;
    if (mode === 'count') return (a.notes.length - b.notes.length || byCatalog(a, b)) * direction;
    return byCatalog(a, b);
  });
  if (mode === 'catalog' && direction === -1) {
    const empty = ordered.filter(group => group.key === EMPTY);
    const rest = ordered.filter(group => group.key !== EMPTY).reverse();
    ordered.splice(0, ordered.length, ...rest, ...empty);
  }
  for (const group of ordered) {
    const color = group.key === EMPTY ? null : groupMeta.colorMap[group.label];
    list.push({
      kind: 'group-header', groupKey: group.key, label: group.label,
      count: group.notes.length, colorHex: color ? optionColorHex(color) : null
    });
    if (!expandedGroups.has(group.key)) continue;
    for (const note of group.notes) pushNoteRows(note);
    if (hasGroupAggregations) list.push({ kind: 'group-footer', groupKey: group.key, notes: group.notes });
  }
  return list;
}
