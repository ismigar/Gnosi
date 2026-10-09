import { describe, expect, it } from 'vitest';
import { calendarScale, scaleWidth, shiftTimelineDate } from './timelineScale';

describe('calendar timeline scale', () => {
    const range = { start: new Date('2026-02-12T00:00'), end: new Date('2026-04-05T00:00'), ticks: [] };
    it('uses localized months and Monday week boundaries', () => {
        const scale = calendarScale(range, 'days', 'week', 'ca-ES', false);
        expect(scale?.start).toEqual(new Date('2026-02-01T00:00'));
        expect(scale?.months?.[0]?.label).toContain('febrer');
        expect(scale?.ticks.slice(1).every(tick => tick.at.getDay() === 1)).toBe(true);
        expect(scale?.ticks.every(tick => tick.at.getHours() === 0)).toBe(true);
    });
    it('fits the overview to the viewport and scales zoom by actual date span', () => {
        const scale = calendarScale(range, 'days', 'day', 'en-US', false);
        expect(scaleWidth(scale, 'days', 'day', 700, true)).toBe(700);
        expect(scaleWidth(scale, 'days', 'day', 700, false)).toBeGreaterThan(scaleWidth(scale, 'days', 'week', 700, false));
    });
    it('extends the visible range when navigating to today outside the project', () => {
        const focus = new Date('2026-10-09T12:00');
        const scale = calendarScale(range, 'days', 'week', 'ca-ES', false, focus);
        expect(scale?.end.getTime()).toBeGreaterThan(focus.getTime());
    });
    it('preserves local dates and clock times when moving over DST', () => {
        const date = new Date(2026, 2, 28, 9);
        const shifted = shiftTimelineDate(date, 2, 'days');
        expect(shifted.getDate()).toBe(30);
        expect(shifted.getHours()).toBe(9);
        expect(date.getDate()).toBe(28);
    });
    it('shows complete calendar years with twelve monthly columns in year view', () => {
        const scale = calendarScale(range, 'days', 'year', 'ca-ES', false);
        expect(scale?.start).toEqual(new Date('2026-01-01T00:00'));
        expect(scale?.end).toEqual(new Date('2027-01-01T00:00'));
        expect(scale?.months?.map(tick => tick.label)).toEqual(['2026']);
        expect(scale?.ticks).toHaveLength(12);
        expect(scale?.ticks[11]?.at.getMonth()).toBe(11);
        expect(scaleWidth(scale, 'days', 'year', 320, false)).toBe(600);
        expect(calendarScale(range, 'hours', 'year', 'ca-ES', false)?.ticks).toHaveLength(12);
    });

});
