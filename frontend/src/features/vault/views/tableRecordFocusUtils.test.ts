import { describe, expect, it } from 'vitest';
import type { TableNote } from './vault-table/types';
import { buildTableRowTree } from './vault-table/rowTree';

import {
  getTableFocusTarget,
  getTableRecordFocusPreparation,
} from './tableRecordFocusUtils';

const baseInput = {
  notes: [],
  sortedNotes: [],
  enableSubitems: false,
  expandedRows: new Set<string>(),
  groupByField: '',
  groupFieldId: null,
  expandedGroups: new Set<string>(),
  visibleRowsCount: 50,
  batchSize: 50,
};

describe('getTableRecordFocusPreparation', () => {
  it('loads the virtualized batch containing the stable record ID', () => {
    const notes = Array.from({ length: 80 }, (_, index) => ({
      id: `record-${String(index)}`,
    }));

    expect(
      getTableRecordFocusPreparation({
        ...baseInput,
        recordId: 'record-68',
        notes,
        sortedNotes: [...notes].reverse(),
      }),
    ).toEqual({ status: 'ready' });

    expect(
      getTableRecordFocusPreparation({
        ...baseInput,
        recordId: 'record-68',
        notes,
        sortedNotes: notes,
      }),
    ).toEqual({ status: 'load-batch', requiredCount: 100 });
  });

  it('expands a parent before restoring a subitem', () => {
    const child = {
      id: 'child',
      metadata: { parent_id: 'parent' },
    };

    expect(
      getTableRecordFocusPreparation({
        ...baseInput,
        recordId: child.id,
        notes: [{ id: 'parent' }, child],
        sortedNotes: [{ id: 'parent' }],
        enableSubitems: true,
      }),
    ).toEqual({ status: 'expand-parent', parentId: 'parent' });
  });

  it('reveals the full ancestor chain and uses the rendered root group', () => {
    const root = { id: 'root', metadata: { status: 'right' } };
    const parent = { id: 'parent', metadata: { parent_id: 'root', status: 'left' } };
    const child = { id: 'child', metadata: { parent_id: 'parent', status: 'left' } };
    const input = { ...baseInput, recordId: child.id, notes: [root, parent, child], sortedNotes: [root], enableSubitems: true, groupByField: 'status', expandedGroups: new Set(['left']) };
    expect(getTableRecordFocusPreparation(input)).toEqual({ status: 'expand-parent', parentId: 'root' });
    expect(getTableRecordFocusPreparation({ ...input, expandedRows: new Set(['root']) })).toEqual({ status: 'expand-parent', parentId: 'parent' });
    expect(getTableRecordFocusPreparation({ ...input, expandedRows: new Set(['root', 'parent']) })).toEqual({ status: 'expand-group', groupKey: 'right' });
    expect(getTableRecordFocusPreparation({ ...input, expandedRows: new Set(['root', 'parent']), expandedGroups: new Set(['right']) })).toEqual({ status: 'ready' });
  });
  it.each([3, true, 3n])('treats a non-string parent %s as a root, consistently with row rendering', parentId => {
    const note = { id: 'child', metadata: { parent_id: parentId, status: 'right' } };
    expect(buildTableRowTree([note], [note], true).sortedNotes).toEqual([note]);
    const input = { ...baseInput, recordId: note.id, notes: [note], sortedNotes: [note], enableSubitems: true, groupByField: 'status', expandedRows: new Set([String(parentId)]) };
    expect(getTableRecordFocusPreparation(input)).toEqual({ status: 'expand-group', groupKey: 'right' });
    expect(getTableRecordFocusPreparation({ ...input, expandedGroups: new Set(['right']) })).toEqual({ status: 'ready' });
  });
  it('uses rendered ancestry when a parent is excluded by a view filter', () => {
    const parent = { id: 'parent', metadata: { status: 'left' } };
    const child = { id: 'child', metadata: { parent_id: 'parent', status: 'right' } };
    expect(getTableRecordFocusPreparation({ ...baseInput, recordId: child.id, notes: [parent, child], sortedNotes: [child], childrenMap: {}, enableSubitems: true, expandedRows: new Set(['parent']), expandedGroups: new Set(['left']), groupByField: 'status' })).toEqual({ status: 'expand-group', groupKey: 'right' });
  });
  it('does not expand ancestors for a record excluded from the rendered hierarchy', () => {
    const parent = { id: 'parent' }, child = { id: 'child', metadata: { parent_id: 'parent' } };
    expect(getTableRecordFocusPreparation({ ...baseInput, recordId: child.id, notes: [parent, child], sortedNotes: [parent], childrenMap: {}, enableSubitems: true })).toEqual({ status: 'missing' });
  });
  it('bounds cyclic ancestor links without mutating records', () => {
    const a = { id: 'a', metadata: { parent_id: 'b' } }, b = { id: 'b', metadata: { parent_id: 'a' } };
    expect(getTableRecordFocusPreparation({ ...baseInput, recordId: 'a', notes: [a, b], sortedNotes: [a], enableSubitems: true, expandedRows: new Set(['b']) })).toEqual({ status: 'ready' });
    expect(a.metadata.parent_id).toBe('b'); expect(b.metadata.parent_id).toBe('a');
  });
  it('expands the record group before restoring focus', () => {
    const record = {
      id: 'record',
      metadata: { status_id: 'In progress' },
    };

    expect(
      getTableRecordFocusPreparation({
        ...baseInput,
        recordId: record.id,
        notes: [record],
        sortedNotes: [record],
        groupByField: 'Status',
        groupFieldId: 'status_id',
      }),
    ).toEqual({ status: 'expand-group', groupKey: 'In progress' });
  });

  it.each([
    [{ nested: [null, ['group']] }, '[object Object]'],
    [[{ nested: { value: null } }, 'ignored'], '[object Object]'],
    [[[' first ', 'second'], 'ignored'], 'first ,second'],
    [null, ' empty'],
    [[], ' empty'],
    [[null, 'ignored'], ' empty'],
  ])('coerces opaque group %j without discarding it', (group, groupKey) => {
    const record: TableNote = { id: 'record', metadata: { status: group } };
    const notes: readonly TableNote[] = [record];

    expect(getTableRecordFocusPreparation({
      ...baseInput, recordId: record.id, notes, sortedNotes: notes, groupByField: 'status',
    })).toEqual({ status: 'expand-group', groupKey });
    expect(record.metadata?.status).toBe(group);
    expect(notes[0]).toBe(record);
    expect(Object.isFrozen(record)).toBe(false);
  });

  it('uses an own null group before the field ID fallback and accepts null metadata', () => {
    const record: TableNote = { id: 'record', metadata: { Status: null, status_id: ['fallback'] } };
    const missing: TableNote = { id: 'missing', metadata: null };

    for (const note of [record, missing]) {
      expect(getTableRecordFocusPreparation({
        ...baseInput, recordId: note.id, notes: [note], sortedNotes: [note],
        groupByField: 'Status', groupFieldId: 'status_id', expandedGroups: new Set([' empty']),
      })).toEqual({ status: 'ready' });
    }
  });

  it('keeps both coercion calls when deriving a nonempty group key', () => {
    let coercions = 0;
    const group = { toString: () => {
      coercions += 1;
      return coercions === 1 ? 'checked for emptiness' : 'actual group key';
    } };
    const record: TableNote = { id: 'record', metadata: { status_id: group } };

    expect(getTableRecordFocusPreparation({
      ...baseInput, recordId: record.id, notes: [record], sortedNotes: [record],
      groupByField: 'Status', groupFieldId: 'status_id',
    })).toEqual({ status: 'expand-group', groupKey: 'actual group key' });
    expect(coercions).toBe(2);
    expect(record.metadata?.status_id).toBe(group);
  });

  it('preserves parent precedence before loading a batch or coercing a group', () => {
    const error = new Error('Cannot coerce group');
    const group = { toString: () => { throw error; } };
    const record: TableNote = {
      id: 'child', parent_id: 'outer',
      metadata: { parent_id: 'inner', source_parent_id: 'source', status: group },
    };
    const input = {
      ...baseInput, recordId: record.id, notes: [record], sortedNotes: [record],
      enableSubitems: true, groupByField: 'status', visibleRowsCount: 0,
    };

    expect(getTableRecordFocusPreparation(input)).toEqual({ status: 'expand-parent', parentId: 'inner' });
    expect(() => getTableRecordFocusPreparation({ ...input, expandedRows: new Set(['inner']) })).toThrow(error);
    expect(record.metadata?.status).toBe(group);
  });
});

describe('getTableFocusTarget', () => {
  const navRows = [{ id: 'first' }, { id: 'selected' }];
  const gridColumns = [{ key: 'title' }, { key: 'status' }];

  it('keeps the selected record when clearing a search restores it to the table', () => {
    const activeCell = { rowId: 'selected', field: 'status' };
    expect(
      getTableFocusTarget({
        activeCell,
        navRows,
        gridColumns,
      }),
    ).toBe(activeCell);
  });

  it('falls back to the first cell when the prior record is no longer visible', () => {
    expect(
      getTableFocusTarget({
        activeCell: { rowId: 'filtered-out', field: 'title' },
        navRows,
        gridColumns,
      }),
    ).toEqual({ rowId: 'first', field: 'title' });
  });
  it('preserves each surviving axis when the other disappears', () => {
    expect(getTableFocusTarget({ activeCell: { rowId: 'selected', field: 'removed' }, navRows, gridColumns }))
      .toEqual({ rowId: 'selected', field: 'title' });
    expect(getTableFocusTarget({ activeCell: { rowId: 'removed', field: 'status' }, navRows, gridColumns }))
      .toEqual({ rowId: 'first', field: 'status' });
    expect(getTableFocusTarget({ activeCell: { rowId: 'removed', field: 'status' }, navRows: [], gridColumns })).toBeNull();
  });

});
