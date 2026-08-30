import { describe, expect, it } from 'vitest';

import {
    buildKanbanColumns,
    EMPTY_KANBAN_BUCKET,
    findKanbanMetadataKey,
    kanbanGroupValues,
    readKanbanCardValue,
    readKanbanGroupBy,
    readKanbanVisibleProperties,
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

    it('preserves open records, null metadata, and opaque values by identity', () => {
        const cyclic: Record<string, unknown> = {};
        cyclic.self = cyclic;
        const opaque = new Map([['cycle', cyclic]]);
        const metadata = { Status: 'Idea', opaque, cyclic, token: Symbol('token') };
        const openNote: KanbanNote = { id: 'open', title: 42, metadata, extension: () => opaque };
        const openNotes: readonly KanbanNote[] = [
            openNote,
            { id: 'null', title: null, metadata: null },
            { id: 'absent' },
        ];
        const columns = buildKanbanColumns(openNotes, {}, { groupBy: 'Status' }, new Map(), {});
        expect(columns[0]?.notes[0]).toBe(openNotes[0]);
        expect(columns.at(-1)?.notes).toEqual([openNotes[1], openNotes[2]]);
        expect(columns.at(-1)?.notes[0]).toBe(openNotes[1]);
        expect(readKanbanCardValue(openNote, 'opaque').value).toBe(opaque);
        expect(readKanbanCardValue(openNote, 'cyclic').value).toBe(cyclic);
        expect(openNotes[0]?.metadata).toBe(metadata);
    });

    it('retains scalar-only grouping and multivalue drop behavior for opaque entries', () => {
        const value = ['Idea', 0, false, 5n, '  ', { nested: true }, Symbol('opaque')];
        const note: KanbanNote = { id: 'open', metadata: { Status: value } };
        expect(kanbanGroupValues(note, 'Status', new Map())).toEqual(['Idea', '0', 'false', '5']);
        expect(resolveKanbanDropValue(value, 'Idea', 'Done')).toEqual(['0', 'false', '5', 'Done']);
        expect(readKanbanCardValue(note, 'Status').value).toBe(value);
        expect(value[0]).toBe('Idea');
    });

    it('preserves nullish precedence and native coercion of grouping field names', () => {
        const groupBy = {
            [Symbol.toPrimitive](hint: string) {
                expect(this).toBe(groupBy);
                expect(hint).toBe('string');
                return 'Status';
            },
        };
        expect(readKanbanGroupBy({ groupBy, group_by: 'ignored' })).toBe('Status');
        expect(readKanbanGroupBy({ groupBy: null, group_by: 'Legacy' })).toBe('Legacy');
        expect(readKanbanGroupBy({ groupBy: '' })).toBe('');
        expect(readKanbanGroupBy({ groupBy: 0 })).toBe('0');
        expect(() => readKanbanGroupBy({ groupBy: Symbol('Status') })).toThrow(TypeError);
        expect(buildKanbanColumns([], {}, { groupBy: ['status'] }, new Map(), {}).map(({ status }) => status))
            .toEqual([EMPTY_KANBAN_BUCKET]);
        const failure = new Error('group coercion failed');
        expect(() => readKanbanGroupBy({ groupBy: {
            [Symbol.toPrimitive]() { throw failure; },
        } })).toThrow(failure);
    });

    it('reads imported group ordering without coercing unknown modes or directions', () => {
        const extension = { [Symbol.toPrimitive]() { throw new Error('must remain opaque'); } };
        const schema = { Status_config: { options: ['Idea', 'Done'] } };
        const view = {
            groupBy: 'Status', groupSort: extension, group_sort: 'alpha',
            groupSortDir: extension, group_sort_dir: 'desc', extension,
        };
        expect(buildKanbanColumns([], schema, view, new Map(), {}).map(({ status }) => status))
            .toEqual(['Idea', 'Done', EMPTY_KANBAN_BUCKET]);
        expect(buildKanbanColumns([], schema, {
            group_by: 'Status', group_sort: 'alpha', group_sort_dir: 'desc',
        }, new Map(), {}).map(({ status }) => status)).toEqual(['Idea', 'Done', EMPTY_KANBAN_BUCKET]);
        expect(view.extension).toBe(extension);
    });

    it('keeps visible fields by identity and rejects malformed lists without removing entries', () => {
        const fields = ['Status', 'Related'];
        expect(readKanbanVisibleProperties(fields)).toBe(fields);
        expect(readKanbanVisibleProperties(null)).toBeUndefined();
        expect(readKanbanVisibleProperties([])).toBeUndefined();
        expect(readKanbanVisibleProperties({ extension: true })).toBeUndefined();
        expect(readKanbanVisibleProperties('A📌')).toEqual(['A', '📌']);
        expect(() => readKanbanVisibleProperties(['Status', {}])).toThrow(TypeError);
        expect(() => readKanbanVisibleProperties({ length: 1 })).toThrow(TypeError);
    });
});
