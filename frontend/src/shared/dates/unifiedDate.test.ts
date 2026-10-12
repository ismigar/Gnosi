import { describe, expect, it } from 'vitest';
import { dateBoundary, dateDuration, dateWithDuration, formatUnifiedDate, unifiedDate } from './unifiedDate';
import { parsePeriod, serializePeriod } from './projectPlanning';

describe('unified dates', () => {
    it('distinguishes a point from an open period and retains hours independently', () => {
        expect(unifiedDate('2026-10-15').kind).toBe('point');
        expect(unifiedDate('2026-10-15/').kind).toBe('period');
        expect(unifiedDate('2026-10-15T10:00').withTime).toBe(true);
        expect(unifiedDate({ kind: 'period', start: '2026-10-15', end: '' }).kind).toBe('period');
    });
    it('supports multi-day periods with clocks and calculates 56 elapsed hours', () => {
        const date = unifiedDate('2026-10-15T10:00/2026-10-17T18:00');
        expect(dateDuration(date)).toBe(56);
        expect(dateWithDuration({ ...date, end: '' }, 56).end).toBe('2026-10-17T18:00');
    });
    it('counts whole calendar days inclusively across a DST transition', () => {
        expect(dateDuration(unifiedDate('2026-10-24/2026-10-26'))).toBe(3);
        expect(dateWithDuration(unifiedDate('2026-10-24/'), 3).end).toBe('2026-10-26');
    });
    it('hides and restores clocks and period boundaries without dropping extensions', () => {
        const date = unifiedDate({ kind: 'period', start: '2026-10-15T10:00', end: '2026-10-17T18:00',
            dependencies: [{ predecessorId: 'parent', type: 'SS', lagMinutes: 30 }], custom: 'keep' });
        expect(dateBoundary({ ...date, withTime: false }, 'start')).toBe('2026-10-15');
        expect(dateBoundary({ ...date, kind: 'point' }, 'end')).toBe(date.start);
        expect(unifiedDate({ ...date, kind: 'point' }).end).toBe('2026-10-17T18:00');
        expect(date.custom).toBe('keep');
    });
    it('retains modality and time preference through planning serialization', () => {
        const date = unifiedDate({ kind: 'period', withTime: false, start: '2026-10-15T09:00', end: '',
            dependencies: [{ predecessorId: 'parent' }] });
        expect(serializePeriod(parsePeriod(date))).toMatchObject({ kind: 'period', withTime: false });
        expect(serializePeriod(unifiedDate({ kind: 'period', withTime: true }))).toMatchObject({ kind: 'period', withTime: true });
    });
    it('formats imported intervals and pending finishes, ignoring a saved interval in point mode', () => {
        const date = unifiedDate('2026-10-15/2026-10-17');
        const options = { dateFormat: 'YYYY-MM-DD', pending: 'Fi pendent' };
        expect(formatUnifiedDate(date, options)).toBe('2026-10-15 → 2026-10-17');
        expect(formatUnifiedDate({ ...date, end: '' }, options)).toBe('2026-10-15 → Fi pendent');
        expect(formatUnifiedDate({ ...date, kind: 'point' }, options)).toBe('2026-10-15');
    });

});
