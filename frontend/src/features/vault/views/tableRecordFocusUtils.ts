const EMPTY_GROUP_KEY = ' empty';

type TableKey =
  | string
  | number
  | bigint
  | boolean
  | null
  | undefined;

interface TableCell {
  field?: TableKey;
  rowId?: TableKey;
}

interface TableNavigationRow {
  id?: TableKey;
}

interface TableGridColumn {
  key?: TableKey;
}

interface TableFocusTargetInput {
  activeCell?: TableCell | null;
  gridColumns?: readonly TableGridColumn[] | null;
  navRows?: readonly TableNavigationRow[] | null;
}

interface TableRecordMetadata extends Readonly<Record<string, unknown>> {
  parent_id?: TableKey;
  source_parent_id?: TableKey;
}

interface TableRecord {
  id?: TableKey;
  metadata?: TableRecordMetadata | null;
  parent_id?: TableKey;
}

interface TableRecordFocusPreparationInput {
  batchSize: number;
  childrenMap?: Readonly<Record<string, readonly TableRecord[]>> | null;
  enableSubitems?: boolean;
  expandedGroups?: ReadonlySet<string> | null;
  expandedRows?: ReadonlySet<TableKey> | null;
  groupByField?: string | null;
  groupFieldId?: string | null;
  notes?: readonly TableRecord[] | null;
  recordId?: TableKey;
  sortedNotes?: readonly TableRecord[] | null;
  visibleRowsCount: number;
}

type TableRecordFocusPreparation =
  | { status: 'missing' }
  | { status: 'expand-parent'; parentId: TableKey }
  | { status: 'load-batch'; requiredCount: number }
  | { status: 'expand-group'; groupKey: string }
  | { status: 'ready' };

function isMetadataValueArray(
  value: unknown,
): value is readonly unknown[] {
  return Array.isArray(value);
}

// Group keys use JavaScript text coercion even for opaque imported values.
function groupValueText(value: unknown): string {
  return String(value);
}

export function getTableFocusTarget({
  activeCell,
  navRows,
  gridColumns,
}: TableFocusTargetInput): TableCell | null {
  const hasActiveRow =
    activeCell &&
    (navRows || []).some((row) => row.id === activeCell.rowId);
  const hasActiveColumn =
    activeCell &&
    (gridColumns || []).some(
      (column) => column.key === activeCell.field,
    );
  if (hasActiveRow && hasActiveColumn) return activeCell;

  const firstRow = navRows?.[0];
  const firstColumn = gridColumns?.[0];
  if (!firstRow || !firstColumn) return null;
  return { rowId: hasActiveRow ? activeCell.rowId : firstRow.id, field: hasActiveColumn ? activeCell.field : firstColumn.key };
}

export function getTableRecordFocusPreparation({
  recordId,
  notes,
  childrenMap,
  sortedNotes,
  enableSubitems,
  expandedRows,
  groupByField,
  groupFieldId,
  expandedGroups,
  visibleRowsCount,
  batchSize,
}: TableRecordFocusPreparationInput): TableRecordFocusPreparation {
  const target = (notes || []).find((note) => note.id === recordId);
  if (!target) return { status: 'missing' };

  const records = new Map((notes || []).map(note => [note.id, note]));
  const renderedParents = childrenMap ? new Map<TableKey, string>() : null;
  if (renderedParents && childrenMap) {
    const visibleIds = new Set((sortedNotes || []).map(note => note.id));
    for (const [parentId, children] of Object.entries(childrenMap)) {
      for (const child of children) {
        renderedParents.set(child.id, parentId);
        visibleIds.add(child.id);
      }
    }
    if (!visibleIds.has(recordId)) return { status: 'missing' };
  }
  const visited = new Set<TableKey>([recordId]);
  const parentIds: TableKey[] = [];
  let rootRecord = target;
  let rootRecordId = recordId;
  while (enableSubitems) {
    const parentId = renderedParents ? renderedParents.get(rootRecord.id)
      : (rootRecord.metadata?.parent_id || rootRecord.parent_id || rootRecord.metadata?.source_parent_id || null);
    if (typeof parentId !== 'string' || !parentId || visited.has(parentId)) break;
    visited.add(parentId);
    parentIds.unshift(parentId);
    rootRecordId = parentId;
    const parent = records.get(parentId);
    if (!parent) break;
    rootRecord = parent;
  }
  const collapsedParent = parentIds.find(parentId => !expandedRows?.has(parentId));
  if (collapsedParent !== undefined) return { status: 'expand-parent', parentId: collapsedParent };

  const rootIndex = (sortedNotes || []).findIndex(
    (note) => note.id === rootRecordId,
  );
  if (!groupByField && rootIndex >= visibleRowsCount) {
    return {
      status: 'load-batch',
      requiredCount:
        Math.ceil((rootIndex + 1) / batchSize) * batchSize,
    };
  }

  if (groupByField) {
    const metadata = rootRecord.metadata || {};
    const rawValue = Object.prototype.hasOwnProperty.call(
      metadata,
      groupByField,
    )
      ? metadata[groupByField]
      : groupFieldId
        ? metadata[groupFieldId]
        : undefined;
    const firstValue =
      rawValue !== undefined && isMetadataValueArray(rawValue)
        ? rawValue[0]
        : rawValue;
    const groupKey =
      firstValue === null ||
      firstValue === undefined ||
      groupValueText(firstValue).trim() === ''
        ? EMPTY_GROUP_KEY
        : groupValueText(firstValue).trim();
    if (!expandedGroups?.has(groupKey)) {
      return { status: 'expand-group', groupKey };
    }
  }

  return { status: 'ready' };
}
