import { describe, expect, it } from 'vitest';

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
});

describe('getTableFocusTarget', () => {
  const navRows = [{ id: 'first' }, { id: 'selected' }];
  const gridColumns = [{ key: 'title' }, { key: 'status' }];

  it('keeps the selected record when clearing a search restores it to the table', () => {
    expect(
      getTableFocusTarget({
        activeCell: { rowId: 'selected', field: 'status' },
        navRows,
        gridColumns,
      }),
    ).toEqual({ rowId: 'selected', field: 'status' });
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
