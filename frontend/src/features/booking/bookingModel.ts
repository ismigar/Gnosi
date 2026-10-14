import type { BookingCalendar, BookingSchedule } from '../../shared/api/booking';

export interface CalendarChoice { key: string; label: string; calendar: BookingCalendar }
export interface BookingCalendarConfig {
  kind: 'table' | 'external'; name: string; account: string | null;
  google_calendar_id: string | null; provider: string | null;
}

export function calendarKey(calendar: BookingCalendar): string {
  return JSON.stringify([calendar.provider, calendar.account, calendar.calendar_id]);
}

export function bookingCalendars(calendars: readonly BookingCalendarConfig[], vaultLabel: string): CalendarChoice[] {
  const local: BookingCalendar = { provider: 'vault', account: '', calendar_id: 'gnosi' };
  const choices: CalendarChoice[] = [{ key: calendarKey(local), label: vaultLabel, calendar: local }];
  for (const entry of calendars) {
    if (entry.kind !== 'external' || !entry.account || !entry.google_calendar_id) continue;
    const calendar: BookingCalendar = {
      provider: entry.provider === 'google' ? 'google' : 'caldav',
      account: entry.account, calendar_id: entry.google_calendar_id,
    };
    const key = calendarKey(calendar);
    if (!choices.some(choice => choice.key === key)) choices.push({ key, label: `${entry.name} · ${entry.account}`, calendar });
  }
  return choices.map(choice => ({
    ...choice,
    label: choices.some(other => other.key !== choice.key && other.label === choice.label)
      ? `${choice.label} · ${choice.calendar.provider} · ${choice.calendar.calendar_id}` : choice.label,
  }));
}

export function defaultSchedule(choices: readonly CalendarChoice[]): BookingSchedule {
  return {
    calendars: choices.slice(0, 20).map(choice => choice.calendar), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    weekdays: [0, 1, 2, 3, 4], working_start: '09:00', working_end: '18:00', duration_minutes: 30,
    buffer_minutes: 0, notice_minutes: 60, horizon_days: 30,
  };
}

export function localDate(): string {
  const now = new Date();
  return `${String(now.getFullYear())}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function formatSlot(start: string, end: string, timezone: string, locale: string): string {
  const formatter = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', timeZone: timezone, timeZoneName: 'short' });
  return `${formatter.format(new Date(start))} – ${formatter.format(new Date(end))}`;
}
