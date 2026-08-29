import { describe, expect, it } from 'vitest';

import {
    buildKanbanColumns,
    EMPTY_KANBAN_BUCKET,
    findKanbanMetadataKey,
    kanbanGroupValues,
    readKanbanCardValue,
    resolveKanbanDropValue,
    type KanbanNote,
} from './vaultKanbanModel';


const notes: readonly KanbanNote[] = [
    {
        id: 'page-1',
        metadata: { '📌 Estat': 'Idea' },
        title: 'First',
    },
    {
        id: 'page-2',
        metadata: { Status: ['Idea', 'Review'] },
        title: 'Second',
    },
    {
        id: 'page-3',
        metadata: {},
        title: 'Third',
    },
];


function noteAt(index: number): KanbanNote {
    const note = notes[index];
    if (!note) throw new Error(`Missing fixture note at ${String(index)}`);
    return note;
}


describe('vaultKanbanModel', () => {
    it('resolves decorative metadata keys without creating duplicates', () => {
        expect(readKanbanCardValue(noteAt(0), 'Estat')).toEqual({
            metadataKey: '📌 Estat',
            value: 'Idea',
        });
        expect(findKanbanMetadataKey(noteAt(0), 'Estat')).toBe('📌 Estat');
    });

    it('uses pending multi-value moves for optimistic grouping', () => {
        const pending = new Map([['page-1', ['Review', 'Done']]]);
        expect(kanbanGroupValues(noteAt(0), 'Estat', pending)).toEqual([
            'Review',
            'Done',
        ]);
    });

    it('replaces the source value while retaining other multi-value groups', () => {
        expect(resolveKanbanDropValue(
            ['Idea', 'Review'],
            'Idea',
            'Done',
        )).toEqual(['Review', 'Done']);
    });

    it('clears scalar and multi-value fields according to their shape', () => {
        expect(resolveKanbanDropValue('Idea', 'Idea', EMPTY_KANBAN_BUCKET)).toBe('');
        expect(resolveKanbanDropValue(
            ['Idea'],
            'Idea',
            EMPTY_KANBAN_BUCKET,
        )).toEqual([]);
    });

    it('builds catalog, custom, relation-labelled, and empty columns', () => {
        const columns = buildKanbanColumns(
            notes,
            {
                Status: 'select',
                Status_config: {
                    options: [
                        { color: 'blue', name: 'Idea' },
                        { color: 'green', name: 'Done' },
                    ],
                },
            },
            { groupBy: 'Status' },
            new Map(),
            { Review: 'Needs review' },
        );

        expect(columns.map(({ label, status }) => ({ label, status }))).toEqual([
            { label: 'Idea', status: 'Idea' },
            { label: 'Done', status: 'Done' },
            { label: 'Needs review', status: 'Review' },
            { label: EMPTY_KANBAN_BUCKET, status: EMPTY_KANBAN_BUCKET },
        ]);
        expect(columns.find(({ status }) => status === 'Idea')?.notes).toHaveLength(1);
        expect(columns.find(({ status }) => status === 'Review')?.notes).toHaveLength(1);
        expect(columns.at(-1)?.notes.map(({ id }) => id)).toEqual(['page-1', 'page-3']);
    });
});
