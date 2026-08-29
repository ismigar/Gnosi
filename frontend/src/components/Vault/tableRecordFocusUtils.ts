const EMPTY_GROUP_KEY = ' empty';

type TableKey =
  | string
  | number
  | bigint
  | boolean
  | null
  | undefined;

type MetadataValue = TableKey | readonly TableKey[];

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

interface TableRecordMetadata extends Record<string, MetadataValue> {
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
  value: MetadataValue,
): value is readonly TableKey[] {
  return Array.isArray(value);
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
  return { rowId: firstRow.id, field: firstColumn.key };
}

export function getTableRecordFocusPreparation({
  recordId,
  notes,
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

  const parentId = enableSubitems
    ? target.metadata?.parent_id ||
      target.parent_id ||
      target.metadata?.source_parent_id ||
      null
    : null;
  if (parentId && !expandedRows?.has(parentId)) {
    return { status: 'expand-parent', parentId };
  }

  const rootRecordId = parentId || recordId;
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
    const metadata = target.metadata || {};
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
      String(firstValue).trim() === ''
        ? EMPTY_GROUP_KEY
        : String(firstValue).trim();
    if (!expandedGroups?.has(groupKey)) {
      return { status: 'expand-group', groupKey };
    }
  }

  return { status: 'ready' };
}
