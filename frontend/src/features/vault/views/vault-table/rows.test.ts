import { describe, expect, it } from 'vitest';
import { buildTableRowTree, buildTableGroupMetadata } from './rowTree';
import { buildTableRowDescriptors } from './rowDescriptors';
import type { TableRowDescriptorInput, TableRowRecord } from './rowTypes';

function note(id: string, metadata: Record<string, unknown> = {}): TableRowRecord {
  return { id, title: id, metadata };
}

function input(overrides: Partial<TableRowDescriptorInput<TableRowRecord>> = {}): TableRowDescriptorInput<TableRowRecord> {
  return {
    groupByField: 'status',
    groupMeta: { fieldId: 'fld_status', optionOrder: ['Todo', 'Done'], colorMap: { Done: 'green' }, labelMap: null },
    sortedNotes: [], visibleRootNotes: [], childrenMap: {},
    expandedRows: new Set(), expandedGroups: new Set(),
    addingSubitemFor: null, hasGroupAggregations: false,
    emptyGroupLabel: 'Sense valor', ...overrides,
  };
}

describe('table subitem tree', () => {
  it('retains filtered-out children for parent propagation, not for rendered rows', () => {
    const parent = note('parent'); const shown = note('shown', { parent_id: 'parent' });
    const hidden = note('hidden', { parent_id: 'parent' });
    const all = [parent, shown, hidden];
    const tree = buildTableRowTree(all, [shown, parent], true);
    expect(tree.sortedNotes).toEqual([parent]);
    expect(tree.childrenMap.parent).toEqual([shown]);
    expect(tree.allChildrenByParent.parent).toEqual([shown, hidden]);
    expect(all).toEqual([parent, shown, hidden]);
  });

  it('uses metadata parent, top-level parent then source parent; orphans stay root records', () => {
    const parent = note('parent'); const other = note('other');
    const child = { ...note('child', { parent_id: 'parent', source_parent_id: 'other' }), parent_id: 'other' };
    const sourceChild = note('source', { source_parent_id: 'parent' });
    const topChild = { ...note('top'), parent_id: 'other' };
    const orphan = note('orphan', { parent_id: 'missing' });
    const all = [parent, child, sourceChild, topChild, other, orphan];
    const tree = buildTableRowTree(all, all, true);
    expect(tree.sortedNotes).toEqual([parent, other, orphan]);
    expect(tree.childrenMap.parent).toEqual([child, sourceChild]);
    expect(tree.childrenMap.other).toEqual([topChild]);
  });

  it('keeps all records flat when subitems are disabled', () => {
    const all = [note('p'), note('c', { parent_id: 'p' })];
    expect(buildTableRowTree(all, all, false)).toEqual({ sortedNotes: all, childrenMap: {}, allChildrenByParent: {} });
  });

  it('treats special object-property names as actual ids without touching prototypes', () => {
    const parent = note('__proto__'); const child = note('child', { parent_id: '__proto__' });
    const tree = buildTableRowTree([parent, child], [parent, child], true);
    expect(Object.getOwnPropertyDescriptor(tree.childrenMap, '__proto__')?.value).toEqual([child]);
    expect(tree.sortedNotes).toEqual([parent]);
  });
});

describe('table virtual row descriptors', () => {
  it('limits flat mode to the visible batch and includes expanded children and entry form', () => {
    const parent = note('p'); const child = note('c'); const later = note('later');
    const result = buildTableRowDescriptors(input({
      groupByField: '', visibleRootNotes: [parent],
      sortedNotes: [parent, later], childrenMap: { p: [child] }, expandedRows: new Set(['p']), addingSubitemFor: 'p'
    }));
    expect(result).toEqual([
      { kind: 'row', note: parent, isChild: false, depth: 0 },
      { kind: 'row', note: child, isChild: true, depth: 1 },
      { kind: 'new-subitem', parentNote: parent, depth: 1 },
    ]);
  });

  it('counts every filtered root in grouped mode regardless of the visible batch', () => {
    const notes = [note('1', { status: 'Todo' }), note('2', { status: 'Done' }), note('3', { status: 'Done' })];
    const rows = buildTableRowDescriptors(input({ sortedNotes: notes, visibleRootNotes: notes.slice(0, 1) }));
    expect(rows.map(row => row.kind)).toEqual(['group-header', 'group-header']);
    expect(rows).toMatchObject([{ groupKey: 'Todo', count: 1 }, { groupKey: 'Done', count: 2 }]);
  });

  it('uses stable field ids only when the field-name property is absent', () => {
    const rows = buildTableRowDescriptors(input({
      sortedNotes: [
        note('1', { fld_status: 'Todo' }), note('2', { status: '', fld_status: 'Done' }),
        note('3', { status: ['Done', 'Todo'] }), note('4', { status: null }),
      ]
    }));
    expect(rows).toMatchObject([
      { groupKey: 'Todo', count: 1 }, { groupKey: 'Done', count: 1 },
      { groupKey: ' empty', label: 'Sense valor', count: 2 },
    ]);
  });

  it('renders footer subtotals only for expanded groups with active aggregations', () => {
    const todo = note('todo', { status: 'Todo' }); const done = note('done', { status: 'Done' });
    const rows = buildTableRowDescriptors(input({
      sortedNotes: [todo, done],
      expandedGroups: new Set(['Done']), hasGroupAggregations: true
    }));
    expect(rows.map(row => row.kind)).toEqual(['group-header', 'group-header', 'row', 'group-footer']);
    expect(rows.at(-1)).toEqual({ kind: 'group-footer', groupKey: 'Done', notes: [done] });
  });

  it.each(['catalog', 'alpha', 'count'])('keeps empty groups last in descending %s order', (mode) => {
    const rows = buildTableRowDescriptors(input({
      activeView: { groupSort: mode, groupSortDir: 'desc' },
      sortedNotes: [note('empty'), note('a', { status: 'Done' }), note('b', { status: 'Todo' })]
    }));
    expect(rows.at(-1)).toMatchObject({ groupKey: ' empty' });
  });

  it('retains snake-case sorting aliases, numeric labels and catalog tie-breaks', () => {
    const notes = [note('1', { status: 'Group 10' }), note('2', { status: 'Group 2' })];
    expect(buildTableRowDescriptors(input({ sortedNotes: notes, activeView: { group_sort: 'alpha', group_sort_dir: 'asc' } })))
      .toMatchObject([{ label: 'Group 2' }, { label: 'Group 10' }]);
    expect(buildTableRowDescriptors(input({
      sortedNotes: [note('d', { status: 'Done' }), note('t', { status: 'Todo' })],
      activeView: { groupSort: 'count' }
    }))).toMatchObject([{ groupKey: 'Todo' }, { groupKey: 'Done' }]);
  });

  it('derives catalog colors and relation titles only from the related database', () => {
    const metadata = buildTableGroupMetadata('status', {
      status_config: { id: 'fld_status', relation_database_id: 'db', options: [{ name: 'Mercè', color: 'green' }] },
    }, [
      { ...note('person'), title: 'Mercè', resolved_table_id: 'db' },
      { ...note('other'), title: 'Excluded', resolved_table_id: 'elsewhere' },
      { ...note('fallback', { table_id: 'db' }), title: '' },
    ], { fallback: 'Fallback title' });
    expect(metadata?.labelMap).toEqual({ person: 'Mercè', fallback: 'Fallback title' });
    const rows = buildTableRowDescriptors(input({ groupMeta: metadata, sortedNotes: [note('1', { status: 'person' })] }));
    expect(rows).toMatchObject([{ label: 'Mercè', count: 1 }]);
    expect(rows[0]).toHaveProperty('colorHex', expect.any(String));
    expect(buildTableGroupMetadata('', {}, [], {})).toBeNull();
  });
});
