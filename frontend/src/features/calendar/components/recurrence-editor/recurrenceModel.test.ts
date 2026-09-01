import { describe, expect, it } from 'vitest';

import { buildRrule, parseRrule, toggleRecurrenceDay } from './recurrenceModel';


describe('recurrenceModel', () => {
    it('parses prefixed weekly rules with a count', () => {
        expect(parseRrule('RRULE:FREQ=WEEKLY;BYDAY=MO,WE;COUNT=4')).toEqual({
            endCount: '4',
            endType: 'count',
            recurrence: 'WEEKLY',
            selectedDays: ['MO', 'WE'],
            untilDate: '',
        });
    });

    it('parses UTC-until dates into date input values', () => {
        expect(parseRrule('FREQ=MONTHLY;UNTIL=20261231T235959Z')).toMatchObject({
            endType: 'until',
            recurrence: 'MONTHLY',
            untilDate: '2026-12-31',
        });
    });

    it('builds weekly count and until rules without changing their format', () => {
        expect(buildRrule({
            endCount: '8',
            endType: 'count',
            recurrence: 'WEEKLY',
            selectedDays: ['TU', 'TH'],
            untilDate: '',
        })).toBe('FREQ=WEEKLY;BYDAY=TU,TH;COUNT=8');
        expect(buildRrule({
            endCount: '10',
            endType: 'until',
            recurrence: 'DAILY',
            selectedDays: [],
            untilDate: '2026-11-05',
        })).toBe('FREQ=DAILY;UNTIL=20261105T235959Z');
    });

    it('returns null for no recurrence and toggles weekdays idempotently', () => {
        expect(buildRrule(parseRrule(null))).toBeNull();
        expect(toggleRecurrenceDay(['MO'], 'WE')).toEqual(['MO', 'WE']);
        expect(toggleRecurrenceDay(['MO', 'WE'], 'MO')).toEqual(['WE']);
    });
});
