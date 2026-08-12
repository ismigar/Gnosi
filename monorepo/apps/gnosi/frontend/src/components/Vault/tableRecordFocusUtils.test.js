import { describe, expect, it } from 'vitest';

import { getTableRecordFocusPreparation } from './tableRecordFocusUtils';

const baseInput = {
    notes: [],
    sortedNotes: [],
    enableSubitems: false,
    expandedRows: new Set(),
    groupByField: '',
    groupFieldId: null,
    expandedGroups: new Set(),
    visibleRowsCount: 50,
    batchSize: 50,
};

describe('getTableRecordFocusPreparation', () => {
    it('loads the virtualized batch containing the stable record ID', () => {
        const notes = Array.from({ length: 80 }, (_, index) => ({ id: `record-${index}` }));

        expect(getTableRecordFocusPreparation({
            ...baseInput,
            recordId: 'record-68',
            notes,
            sortedNotes: [...notes].reverse(),
        })).toEqual({ status: 'ready' });

        expect(getTableRecordFocusPreparation({
            ...baseInput,
            recordId: 'record-68',
            notes,
            sortedNotes: notes,
        })).toEqual({ status: 'load-batch', requiredCount: 100 });
    });

    it('expands a parent before restoring a subitem', () => {
        const child = { id: 'child', metadata: { parent_id: 'parent' } };

        expect(getTableRecordFocusPreparation({
            ...baseInput,
            recordId: child.id,
            notes: [{ id: 'parent' }, child],
            sortedNotes: [{ id: 'parent' }],
            enableSubitems: true,
        })).toEqual({ status: 'expand-parent', parentId: 'parent' });
    });

    it('expands the record group before restoring focus', () => {
        const record = { id: 'record', metadata: { status_id: 'In progress' } };

        expect(getTableRecordFocusPreparation({
            ...baseInput,
            recordId: record.id,
            notes: [record],
            sortedNotes: [record],
            groupByField: 'Status',
            groupFieldId: 'status_id',
        })).toEqual({ status: 'expand-group', groupKey: 'In progress' });
    });
});

