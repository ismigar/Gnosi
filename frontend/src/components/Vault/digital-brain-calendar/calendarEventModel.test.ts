import { describe, expect, it } from 'vitest';
import { buildCalendarEvents, localCalendarDateTime } from './calendarEventModel';
import { calendarMetadataPatch } from './calendarMutations';

const options = { ignoreCalendarFilter: true, untitled: 'Untitled' };

describe('digital brain calendar event model', () => {
  it('uses the configured source id and folds accents when searching', () => {
    const events = buildCalendarEvents([{ id: 'one', title: 'Reunió', resolved_table_id: 'table', metadata: { date: '2026-09-01', source: 'old' } }], {
      untitled: 'Untitled', searchQuery: 'reunio', selectedCalendars: new Set(['Team']),
      calendarConfigs: [{ id: 'table', source: 'Team' }], colorMap: { Team: '#123456' },
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ id: 'one', title: 'Reunió', color: '#123456' });
  });

  it('does not fall back to a different date when a configured field is empty', () => {
    expect(buildCalendarEvents([{ id: 'one', metadata: { date: '2026-09-01', Planned: '' } }], { ...options, dateField: 'Planned' })).toEqual([]);
  });

  it('preserves period boundaries and converts inclusive all-day ends exactly once', () => {
    const events = buildCalendarEvents([{ id: 'one', metadata: { Planned: { start: '2026-09-01', end: '2026-09-03' } } }], { ...options, dateField: 'Planned' });
    expect(events[0]).toMatchObject({ start: '2026-09-01', end: '2026-09-04', allDay: true });
    const provider = buildCalendarEvents([{ id: 'two', metadata: { date: '2026-09-01', end_date: '2026-09-03', _end_exclusive: true } }], options);
    expect(provider[0]?.end).toBe('2026-09-03');
  });

  it('uses the explicit end field for non-recurring events', () => {
    const events = buildCalendarEvents([{ id: 'one', metadata: { Starts: '2026-09-01T10:00:00', Ends: '2026-09-01T11:30:00', end_date: '2030-01-01' } }], { ...options, dateField: 'Starts', endDateField: 'Ends' });
    expect(events[0]).toMatchObject({ start: '2026-09-01T10:00:00', end: '2026-09-01T11:30:00', allDay: false });
  });

  it('preserves recurrence count, weekdays and both exclusion sources', () => {
    const events = buildCalendarEvents([{ id: 'one', metadata: { date: '2026-09-01', rrule: 'FREQ=WEEKLY;COUNT=4;INTERVAL=2;BYDAY=MO,TU;EXDATE=2026-09-07', exdates: ['2026-09-08'] } }], options);
    expect(events[0]).toMatchObject({
      rrule: { dtstart: '2026-09-01', freq: 'weekly', count: 4, interval: 2, byweekday: ['MO', 'TU'] },
      exdate: ['2026-09-08', '2026-09-07'],
    });
  });

  it('serializes local clock fields without UTC conversion', () => {
    expect(localCalendarDateTime(new Date(2026, 7, 30, 10, 5, 4))).toBe('2026-08-30T10:05:04');
  });

  it('updates configured period fields while retaining planning constraints', () => {
    const patch = calendarMetadataPatch({ Planned: { start: '2026-09-01', end: '2026-09-03', startMode: 'auto', endMode: 'auto', deadline: '2026-09-10', dependencies: [{ predecessorId: 'parent', type: 'FS', lagMinutes: 30 }] } }, 'ignored', '2026-09-05', 'resize', { dateField: 'Planned' });
    expect(patch.metadata).toMatchObject({ Planned: { start: '2026-09-01', end: '2026-09-05', startMode: 'auto', endMode: 'manual', deadline: '2026-09-10', dependencies: [{ predecessorId: 'parent', type: 'FS', lagMinutes: 30 }] } });
    expect(patch.metadata).not.toHaveProperty('end_date');
  });
});
