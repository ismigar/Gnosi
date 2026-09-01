import { describe, expect, it } from 'vitest';
import type { TableNote } from './vault-table/types';

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
});
