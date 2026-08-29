import { describe, expect, it } from 'vitest';

import {
    buildTimelineChart,
    buildTimelineTicks,
    predecessorCandidates,
} from './timelineModel';
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
});
