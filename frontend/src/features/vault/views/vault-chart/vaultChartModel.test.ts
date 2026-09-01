import { describe, expect, it } from 'vitest';

import {
    aggregateChartValues,
    buildChartData,
    chartCategoryLabels,
    chartNumber,
    formatChartNumber,
    truncateChartLabel,
} from './vaultChartModel';


describe('vaultChartModel', () => {
    it('parses finite numbers with decimal commas and spaces', () => {
        expect(chartNumber(' 1 234,5 ')).toBe(1234.5);
        expect(chartNumber(Number.POSITIVE_INFINITY)).toBeNull();
        expect(chartNumber('invalid')).toBeNull();
    });

    it('normalizes scalar, array, object, and empty categories', () => {
        expect(chartCategoryLabels('', '(empty)')).toEqual(['(empty)']);
        expect(chartCategoryLabels(['A', { name: 'B' }], '(empty)')).toEqual(['A', 'B']);
        expect(chartCategoryLabels({ title: 'Record' }, '(empty)')).toEqual(['Record']);
    });

    it('supports every aggregation and ignores null numeric values', () => {
        const values = [2, null, 6];
        expect(aggregateChartValues(values, 'count')).toBe(3);
        expect(aggregateChartValues(values, 'sum')).toBe(8);
        expect(aggregateChartValues(values, 'avg')).toBe(4);
        expect(aggregateChartValues(values, 'min')).toBe(2);
        expect(aggregateChartValues(values, 'max')).toBe(6);
    });

    it('groups repeated categories and sorts numeric charts by value', () => {
        expect(buildChartData({
            aggregation: 'sum',
            emptyLabel: '(empty)',
            records: [
                { category: 'B', value: 1 },
                { category: 'A', value: 5 },
                { category: 'B', value: 2 },
            ],
            temporalCategory: false,
            usesValueField: true,
        })).toEqual([
            { label: 'A', value: 5 },
            { label: 'B', value: 3 },
        ]);
    });

    it('sorts temporal categories chronologically and formats labels', () => {
        const data = buildChartData({
            aggregation: 'count',
            emptyLabel: '(empty)',
            records: [
                { category: '2026-12-01', value: null },
                { category: '2026-01-01', value: null },
            ],
            temporalCategory: true,
            usesValueField: false,
        });
        expect(data.map(({ label }) => label)).toEqual(['2026-01-01', '2026-12-01']);
        expect(formatChartNumber(2.345)).toBe('2,35');
        expect(truncateChartLabel('Long category', 6)).toBe('Long …');
    });
});
