import { formatUnifiedDate } from '../../../shared/dates/unifiedDate';
import { sourceFilterTree } from '../../../shared/filtering/exposedFilters';
import { textValues } from '../../../shared/filtering/filterTextValues';
import type { VaultPageSummary } from '../../../shared/api/vaults';
import { decodeRows, decodeView, isRecord } from './db-view-embed/decode';
import { applyFilterNode, metaValueForField, multiKeySort } from './db-view-embed/filter-model';
import { applyClientJoins, normalizeVisibleColumns } from './db-view-embed/joins';

function displayValue(value: unknown, locale?: string): string {
  if (Array.isArray(value)) return value.map((item: unknown) => displayValue(item, locale)).filter(Boolean).join(', ');
  if (isRecord(value) && (value.kind === 'period' || value.kind === 'point' || 'startMode' in value || 'endMode' in value)) {
    return formatUnifiedDate(value, { dateFormat: 'locale', locale });
  }
  return textValues(value).join(', ');
}

/** A compact projection of the same saved filters, host-relative rules, joins and ordering as a Knowledge embed. */
export async function readOnlyDashboardView(
  pageId: string,
  sectionData: Readonly<Record<string, unknown>>,
  registeredData: Readonly<Record<string, unknown>> | undefined,
  loadTable: (id: string) => Promise<readonly VaultPageSummary[]>,
  locale?: string,
) {
  const section = decodeView(sectionData);
  const view = registeredData ? decodeView(registeredData) : section;
  const tableId = section.source_table_id || view.table_id || section.table_id;
  if (!tableId) return null;
  const readRecords = async (id: string) => decodeRows(await loadTable(id)).filter(row => !row.metadata.is_template);
  const rows = await applyClientJoins(await readRecords(tableId), section.joins ?? view.joins, readRecords);
  const tree = sourceFilterTree(view);
  const sorted = multiKeySort(rows.filter(row => applyFilterNode(row, pageId, tree)),
    view.sorts?.length ? view.sorts : view.sort ? [view.sort] : []);
  const columns = normalizeVisibleColumns(view.visibleProperties ?? view.visible_properties ?? view.columns ?? [], tableId)
    .filter(column => column.fieldKey !== 'title').slice(0, 2);
  return {
    total: sorted.length,
    columns: columns.map(column => typeof column.label === 'string' && column.label ? column.label : column.fieldKey),
    records: sorted.slice(0, 6).map(row => ({
      id: row.id,
      title: row.title,
      cells: columns.map(column => {
        const joined = column.tableId && column.tableId !== tableId ? row.metadata[`_join:${column.tableId}`] : null;
        const value = Array.isArray(joined) ? joined.flatMap((item: unknown) => isRecord(item) ? [item[column.fieldKey]] : []) : metaValueForField(row.metadata, column.fieldKey) ?? row[column.fieldKey];
        return displayValue(value, locale);
      }),
    })),
  };
}
