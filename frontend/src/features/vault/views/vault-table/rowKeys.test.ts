import { expect, it } from 'vitest';
import { tableRowKeys } from './rowKeys';
import type { TableRowDescriptor, TableRowRecord } from './rowTypes';
const row = (id: string, depth = 0): TableRowDescriptor<TableRowRecord> => ({ kind: 'row', note: { id }, isChild: depth > 0, depth });
const header = (groupKey: string): TableRowDescriptor<TableRowRecord> => ({ kind: 'group-header', groupKey, label: groupKey, count: 1, colorHex: null });
it('keeps record occurrence keys stable when another record is inserted or reordered', () => {
  const original = tableRowKeys([row('a'), row('b')]);
  const reordered = tableRowKeys([row('new'), row('b'), row('a')]);
  expect(reordered[1]).toBe(original[1]); expect(reordered[2]).toBe(original[0]);
});
it('distinguishes the same record in separate groups and parent paths', () => {
  const rows = [header('one'), row('parent-a'), row('child', 1), header('two'), row('parent-b'), row('child', 1)];
  const keys = tableRowKeys(rows);
  expect(new Set(keys).size).toBe(keys.length);
  const later = tableRowKeys([header('extra'), row('new'), ...rows]);
  expect(later.slice(2)).toEqual(keys);
});
