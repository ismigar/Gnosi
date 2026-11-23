import { describe, expect, it } from 'vitest';
import { buildCalendarEvents } from '../components/digital-brain-calendar/calendarEventModel';
import { appointmentsForDay, localDayRange, visibleAppointments } from './dayAgenda';
import { readCalendarDayLink } from './calendarDayLink';

const options = { ignoreCalendarFilter: true, untitled: 'Untitled' };
const now = new Date(2026, 10, 23, 10, 15);
const range = localDayRange(now);

describe('home day agenda', () => {
    it('keeps civil all-day dates and exclusive ends, and intersects overnight events across offsets', () => {
        const dayStart = new Date(range.start).getTime();
        const events = buildCalendarEvents([
            { id: 'local', metadata: { date: '2026-11-22', end_date: '2026-11-23' } },
            { id: 'provider', metadata: { date: '2026-11-22', end_date: '2026-11-23', _end_exclusive: true } },
            { id: 'overnight', metadata: { date: new Date(dayStart - 1_800_000).toISOString(), end_date: new Date(dayStart + 1_800_000).toISOString() } },
            { id: 'tomorrow', metadata: { date: range.end } },
            { id: 'cancelled', metadata: { date: range.start, status: 'cancelled' } },
        ], options);
        const rows = appointmentsForDay(events, range);
        expect(rows.map(row => row.id)).toEqual(['local', 'overnight']);
        expect(rows[0]?.end).toEqual(new Date(2026, 10, 24));
        expect(rows[1]?.start.getTime()).toBe(dayStart - 1_800_000);
    });

    it('shows the current and next timed entries in a compact block and the whole day in a wide block', () => {
        const rows = appointmentsForDay(buildCalendarEvents([
            { id: 'holiday', metadata: { date: '2026-11-23' } },
            ...['08', '10', '11', '14'].map(hour => ({ id: hour, metadata: { date: `2026-11-23T${hour}:00:00` } })),
        ], options), range);
        expect(visibleAppointments(rows, now, true).map(row => [row.id, row.state])).toEqual([['10', 'current'], ['11', 'next']]);
        expect(visibleAppointments(rows, now, false).map(row => [row.id, row.state])).toEqual([
            ['holiday', 'all-day'], ['08', 'past'], ['10', 'current'], ['11', 'next'], ['14', 'later'],
        ]);
    });

    it('keeps the local clock through DST in recurring Vault appointments and honors exclusions', () => {
        const base = { date: '2026-06-01T10:00:00', end_date: '2026-06-01T10:30:00', rrule: 'FREQ=WEEKLY;BYDAY=MO' };
        const rows = appointmentsForDay(buildCalendarEvents([
            { id: 'series', metadata: base },
            { id: 'excluded', metadata: { ...base, exdates: ['2026-11-23T10:00:00'] } },
        ], options), range);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ id: 'series', start: new Date(2026, 10, 23, 10), end: new Date(2026, 10, 23, 10, 30) });
    });

    it('reads escaped provider identifiers and validated dates from day links', () => {
        expect(readCalendarDayLink('/@work/calendar/event/team%2Fevent', '?date=2026-11-23&source=Team')).toEqual({
            date: '2026-11-23', eventId: 'team/event', source: 'Team',
        });
        expect(readCalendarDayLink('/@work/calendar/event/%E0', '?date=2026-02-31')).toEqual({
            date: undefined, eventId: undefined, source: undefined,
        });
    });
});
