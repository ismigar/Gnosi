import { describe, expect, it, vi } from 'vitest';

import {
    buildBarColorResolver,
    buildTimelineChart,
    buildTimelineTicks,
    predecessorCandidates,
    predecessorsFor,
    resolveTimelineDateFields,
} from './timelineModel';
import type { VaultViewPage } from '../../../hooks/useVaultViewData';
import type {
    TimelineChartNote,
    TimelineSchemaReaders,
} from './types';


const readers: TimelineSchemaReaders = {
    fieldConfig: () => ({}),
    fieldEntries: (schema) => Object.entries(schema)
        .filter(([field]) => !field.endsWith('_config'))
        .map(([field, type]) => [field, typeof type === 'string' ? type : 'text']),
    fieldNames: (schema) => Object.keys(schema)
        .filter((field) => !field.endsWith('_config')),
    fieldType: (schema, field) => {
        const value = field ? schema[field] : undefined;
        return typeof value === 'string' ? value : 'text';
    },
    filters: () => [],
    sorts: () => [],
};


function chartNote(
    id: string,
    predecessors: readonly string[] = [],
): TimelineChartNote {
    return {
        depth: 0,
        end: new Date('2024-01-02T00:00:00'),
        id,
        metadata: { predecessor_ids: predecessors },
        start: new Date('2024-01-01T00:00:00'),
        title: id,
    };
}


describe('timelineModel', () => {
    it('builds signed year labels without losing BCE dates', () => {
        const start = new Date(0);
        start.setFullYear(-4, 0, 1);
        const end = new Date(0);
        end.setFullYear(2, 0, 1);

        const ticks = buildTimelineTicks(start, end, 'years');

        expect(ticks[0]?.label).toBe('4 BCE');
        expect(ticks.some(({ label }) => label === '0')).toBe(true);
    });

    it('flattens a parent before its child and derives the summary span', () => {
        const model = buildTimelineChart({
            dateField: 'Start',
            endDateField: 'End',
            hasExplicitSorts: false,
            notes: [
                {
                    id: 'child',
                    metadata: {
                        End: '2024-01-06',
                        Start: '2024-01-05',
                        parent_id: 'parent',
                    },
                    title: 'Child',
                },
                {
                    id: 'parent',
                    metadata: { End: '2024-01-03', Start: '2024-01-02' },
                    title: 'Parent',
                },
            ],
            readers,
            schema: { End: 'date', Start: 'date' },
            timelineUnit: 'days',
        });

        expect(model.chartData.map(({ id }) => id)).toEqual(['parent', 'child']);
        expect(model.chartData[0]).toMatchObject({ depth: 0, isParent: true });
        expect(model.chartData[0]?.summaryEnd).toEqual(
            new Date('2024-01-06T00:00:00'),
        );
        expect(model.chartData[1]?.depth).toBe(1);
    });

    it('excludes transitive successors from predecessor candidates', () => {
        const notes = [
            chartNote('root'),
            chartNote('child', ['root']),
            chartNote('grandchild', ['child']),
            chartNote('independent'),
        ];

        const candidates = predecessorCandidates(
            'root',
            notes,
            (note) => Array.isArray(note.metadata?.predecessor_ids)
                ? note.metadata.predecessor_ids.filter(
                    (value): value is string => typeof value === 'string',
                )
                : [],
        );

        expect(candidates.map(({ id }) => id)).toEqual(['independent']);
    });

    it('retains opaque, cyclic and non-JSON values in chart metadata and row extensions', () => {
        const opaque = new Map([['key', new Set([1n])]]);
        const cyclic: Record<string, unknown> = { opaque };
        cyclic.self = cyclic;
        const callback = (): string => 'extension';
        const metadata = { Start: '2024-01-01', cyclic, callback, opaque };
        const notes: readonly VaultViewPage[] = [
            { id: 'open', metadata, title: 19n, extension: callback },
            { id: 'null', metadata: null, last_modified: '2024-01-02' },
            { id: 'missing', last_modified: '2024-01-03' },
        ];
        const model = buildTimelineChart({
            dateField: 'Start', endDateField: undefined, hasExplicitSorts: true,
            notes, readers, schema: { Start: 'date' }, timelineUnit: 'days',
        });
        expect(model.chartData.map(({ id }) => id)).toEqual(['open', 'null', 'missing']);
        expect(model.chartData[0]?.metadata).toBe(metadata);
        expect(model.chartData[0]?.metadata?.cyclic).toBe(cyclic);
        expect(model.chartData[0]?.metadata?.opaque).toBe(opaque);
        expect(model.chartData[0]?.extension).toBe(callback);
        expect(model.chartData[0]?.title).toBe(19n);
        expect(model.chartData[1]?.metadata).toBeNull();
        expect(model.chartData[2]?.metadata).toBeUndefined();
        expect(notes[0]?.metadata).toBe(metadata);
    });

    it('uses the native receiver for opaque dates and parent references', () => {
        const start = { value: '2024-01-03', toString() { return this.value; } };
        const parent = { value: 'parent', toString() { return this.value; } };
        const model = buildTimelineChart({
            dateField: 'Start', endDateField: undefined, hasExplicitSorts: false,
            notes: [
                { id: 'child', metadata: { Start: start }, parent_id: parent },
                { id: 'parent', metadata: { Start: '2024-01-02' } },
            ],
            readers, schema: { Start: 'date' }, timelineUnit: 'days',
        });
        expect(model.chartData.map(({ id }) => id)).toEqual(['parent', 'child']);
        expect(model.chartData[1]?.depth).toBe(1);
        expect(model.chartData[1]?.start).toEqual(new Date('2024-01-03T00:00:00'));
        expect(model.chartData[1]?.parent_id).toBe(parent);
        expect(model.chartData[1]?.metadata?.Start).toBe(start);
    });

    it('propagates failures in native coercion instead of discarding imported values', () => {
        const failure = new Error('opaque coercion');
        const invalidDate = { toString(): string { throw failure; } };
        expect(() => buildTimelineChart({
            dateField: 'Start', endDateField: undefined, hasExplicitSorts: false,
            notes: [{ id: 'bad', metadata: { Start: invalidDate } }],
            readers, schema: { Start: 'date' }, timelineUnit: 'days',
        })).toThrow(failure);
    });

    it('reads open periods directly and tolerates null metadata for predecessor lookup', () => {
        const predecessorIds = ['parent'];
        const period: Record<string, unknown> = {
            start: { toString: () => '2024-01-01' },
            end: '2024-01-02', predecessorIds,
        };
        period.self = period;
        const note: VaultViewPage = { id: 'period', metadata: { Period: period } };
        expect(predecessorsFor(note, true, 'Period')).toEqual(['parent']);
        expect(predecessorsFor({ id: 'null', metadata: null }, true, 'Period')).toEqual([]);
        expect(predecessorsFor({ id: 'mixed', metadata: {
            predecessor_ids: ['valid', null, 4, new Map(), ''],
        } }, false, undefined)).toEqual(['valid']);
        expect(period.predecessorIds).toBe(predecessorIds);
        const model = buildTimelineChart({
            dateField: 'Period', endDateField: undefined, hasExplicitSorts: false,
            notes: [note], readers, schema: { Period: 'period' }, timelineUnit: 'days',
        });
        expect(model.chartData[0]?.metadata?.Period).toBe(period);
        expect(model.chartData[0]?.start).toEqual(new Date('2024-01-01T00:00:00'));
    });

    it('narrows unknown date field extensions only when choosing a schema field', () => {
        expect(resolveTimelineDateFields(
            { Start: 'date', end_date: 'date' }, { invalid: true }, 17, readers,
        )).toEqual({ dateField: 'Start', endDateField: 'end_date' });
    });

    it('preserves color field coercion, null metadata and symbol errors', () => {
        const field = { value: 'Status', toString() { return this.value; } };
        const fieldConfig = vi.fn<TimelineSchemaReaders['fieldConfig']>(() => ({
            options: [{ name: 'Done', color: 'green' }],
        }));
        const resolver = buildBarColorResolver({}, field, { ...readers, fieldConfig });
        expect(fieldConfig).toHaveBeenCalledWith({}, 'Status');
        expect(resolver({ ...chartNote('note'), metadata: null })).toBe('var(--gnosi-primary)');
        expect(resolver({ ...chartNote('note'), metadata: { Status: 'Done' } }))
            .not.toBe('var(--gnosi-primary)');
        expect(() => buildBarColorResolver({}, Symbol('field'), readers)).toThrow(TypeError);
    });
});
