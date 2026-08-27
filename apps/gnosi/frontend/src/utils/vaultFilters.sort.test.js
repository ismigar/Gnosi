import { describe, expect, it } from 'vitest';

import { compareFieldValues } from './vaultFilters';

describe('compareFieldValues', () => {
    it.each(['asc', 'desc'])('keeps empty values last for %s sorting', (direction) => {
        const values = ['', '2026', '2025', null, undefined];

        const sorted = [...values].sort((a, b) => compareFieldValues(a, b, direction));

        expect(sorted.slice(-3)).toEqual(['', null, undefined]);
        expect(sorted.slice(0, 2)).toEqual(direction === 'asc' ? ['2025', '2026'] : ['2026', '2025']);
    });

    it('applies secondary ascending dates after a descending year sort', () => {
        const rows = [
            { year: '', date: '' },
            { year: '2025', date: '2025-10-29' },
            { year: '2026', date: '2026-02-23' },
            { year: '2025', date: '2025-05-16' },
        ];

        const sorted = [...rows].sort((a, b) => (
            compareFieldValues(a.year, b.year, 'desc')
            || compareFieldValues(a.date, b.date, 'asc')
        ));

        expect(sorted).toEqual([
            { year: '2026', date: '2026-02-23' },
            { year: '2025', date: '2025-05-16' },
            { year: '2025', date: '2025-10-29' },
            { year: '', date: '' },
        ]);
    });
});
