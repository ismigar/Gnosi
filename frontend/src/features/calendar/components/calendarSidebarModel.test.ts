import { describe, expect, it } from 'vitest';

import {
  buildCalendarGrid,
  calendarSourceName,
  groupCalendarSources,
} from './calendarSidebarModel';


describe('calendarSidebarModel', () => {
  it('builds a Monday-first six-week grid and marks today', () => {
    const days = buildCalendarGrid(
      new Date(2026, 7, 1),
      new Date(2026, 7, 15),
    );
    expect(days).toHaveLength(42);
    expect(days.at(0)?.date.getDay()).toBe(1);
    expect(days.find((day) => day.isToday)?.num).toBe(15);
    expect(days.filter((day) => day.isCurrent)).toHaveLength(31);
  });

  it('prefers configured names and derives readable ICS names', () => {
    expect(calendarSourceName('https://calendar.test/team.ics', [{
      source: 'https://calendar.test/team.ics',
      name: 'Work',
    }])).toBe('Work');
    expect(calendarSourceName('https://calendar.test/team.ics', []))
      .toBe('team');
    expect(calendarSourceName('local-calendar', [])).toBe('local-calendar');
  });

  it('groups sources by account and excludes the locale calendar', () => {
    expect(groupCalendarSources([
      'work',
      'personal',
      'es_es',
    ], [
      { source: 'work', account: 'ada@example.test' },
      { source: 'personal', account: 'ada@example.test' },
    ])).toEqual([{
      account: 'ada@example.test',
      calendars: [
        { source: 'work', config: { source: 'work', account: 'ada@example.test' } },
        {
          source: 'personal',
          config: { source: 'personal', account: 'ada@example.test' },
        },
      ],
    }]);
  });
});
