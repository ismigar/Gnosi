import { describe, expect, it } from 'vitest';

import {
    exclusiveToInclusiveAllDayEnd,
    inclusiveToExclusiveAllDayEnd,
    shiftCalendarDay,
} from './calendarUtils';

describe('calendar all-day boundaries', () => {
    it('converts a Google-exclusive end into the inclusive form date', () => {
        expect(exclusiveToInclusiveAllDayEnd('2026-08-20')).toBe('2026-08-19');
    });

    it('converts the inclusive form date back into a Google-exclusive end', () => {
        expect(inclusiveToExclusiveAllDayEnd('2026-08-19')).toBe('2026-08-20');
    });

    it('handles month and leap-year boundaries in local calendar time', () => {
        expect(shiftCalendarDay('2024-02-29', 1)).toBe('2024-03-01');
        expect(shiftCalendarDay('2026-01-01', -1)).toBe('2025-12-31');
    });

    it('leaves date-time values unchanged', () => {
        expect(inclusiveToExclusiveAllDayEnd('2026-08-19T10:00:00')).toBe(
            '2026-08-19T10:00:00',
        );
    });
});
