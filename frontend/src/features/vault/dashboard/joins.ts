import { record, stringValue } from './readers';
import type { Page, Join } from './types';
function fieldKeys(row: Page, field: string): string[] {
  const metadata = row.metadata || {};
  const value = field === 'id' ? row.id
    : field === 'title' ? row.title || metadata.title || metadata.Nom || metadata['Títol'] || metadata.Name || metadata['Título']
      : metadata[field];
  if (value == null || value === '')
    return [];
  return Array.isArray(value)
    ? value.map((item: unknown) => typeof item === 'object' && item !== null
      ? stringValue(record(item).id || record(item).value || '') : stringValue(item)).filter(Boolean)
    : [stringValue(value)];
}
function indexByField(rows: readonly Page[], field: string): Map<string, Page[]> {
  const index = new Map<string, Page[]>();
  for (const row of rows)
    for (const key of fieldKeys(row, field)) {
      const group = index.get(key) || [];
      group.push(row);
      index.set(key, group);
    }
  return index;
}
function joinedPage(left: Page, right: Page, tableId: string): Page {
  const metadata = { ...(left.metadata || {}) };
  for (const [key, value] of Object.entries(right.metadata || {})) {
    if (!(key in metadata))
      metadata[key] = value;
  }
  metadata[`_join:${tableId}`] = [right.metadata || {}];
  return { ...left, metadata };
}
export function applyDashboardJoins(baseRows: Page[], joins: readonly Join[] | undefined, allPages: readonly Page[], resolveTableId: (page: Page) => string | null): Page[] {
  if (!joins || joins.length === 0)
    return baseRows;
  let rows = baseRows.map(row => ({ ...row, metadata: { ...(row.metadata || {}) } }));
  for (const join of joins) {
    const tableId = join.tableId;
    const leftField = join.leftField || join.field;
    const rightField = join.rightField || join._indexByField;
    const type = (join.type || 'inner').toLowerCase();
    if (!tableId || !leftField || !rightField)
      continue;
    const rightRows = allPages.filter(page => resolveTableId(page) === tableId);
    const index = indexByField(rightRows, rightField);
    const next: Page[] = [];
    const matchedRightIds = new Set<string>();
    for (const left of rows) {
      let matched = false;
      for (const key of fieldKeys(left, leftField))
        for (const right of index.get(key) || []) {
          next.push(joinedPage(left, right, tableId));
          matched = true;
          matchedRightIds.add(right.id);
        }
      if (type === 'left' && !matched)
        next.push({ ...left, metadata: { ...left.metadata, [`_join:${tableId}`]: [] } });
    }
    if (type === 'right')
      for (const right of rightRows) {
        if (!matchedRightIds.has(right.id))
          next.push({ ...right, metadata: { ...(right.metadata || {}), [`_join:${tableId}`]: [right.metadata || {}] } });
      }
    rows = next.map(row => ({ ...row, metadata: row.metadata || {} }));
  }
  return rows;
}
