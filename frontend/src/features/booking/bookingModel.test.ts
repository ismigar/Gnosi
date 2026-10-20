import { expect, it } from 'vitest';
import { bookingCalendars, defaultSchedule, type BookingCalendarConfig } from './bookingModel';

it.each([
  ['caldav', '/home/work-b/'],
  ['google', '/home/work-a/'],
])('includes and distinguishes every %s calendar when names or provider IDs coincide', (provider, secondId) => {
  const account = 'owner@example.test';
  const first: BookingCalendarConfig = {
    kind: 'external', name: 'Work', account, google_calendar_id: '/home/work-a/', provider: 'caldav',
  };
  const choices = bookingCalendars([
    first, { ...first, name: 'Legacy alias' }, { ...first, provider, google_calendar_id: secondId },
  ], 'Gnosi');
  expect(choices).toHaveLength(3);
  expect(new Set(choices.map(choice => choice.key)).size).toBe(3);
  expect(new Set(choices.map(choice => choice.label)).size).toBe(3);
  expect(defaultSchedule(choices).calendars).toEqual([
    { provider: 'vault', account: '', calendar_id: 'gnosi' },
    { provider: 'caldav', account, calendar_id: '/home/work-a/' },
    { provider, account, calendar_id: secondId },
  ]);
});
