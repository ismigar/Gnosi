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
});
