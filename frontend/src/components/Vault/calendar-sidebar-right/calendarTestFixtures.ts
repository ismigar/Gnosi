import type { CalendarEvent } from '../../../shared/api/calendar';
import type { VaultPageMutation, VaultPageSummary } from '../../../shared/api/vaults';
import type { CalendarConfig, CalendarEntry, EventFields } from './calendarTypes';

export const LOCAL_CALENDAR: CalendarConfig = {id: 'table-calendar', source: 'Appointments', name: 'Appointments', kind: 'table', color: '#64b5f6', provider: null, account: null, google_calendar_id: null};
export function externalCalendar(provider = 'caldav'): CalendarConfig {
    return {id: provider, source: provider + '@example.test', name: provider, kind: 'external', color: '#4db6ac', provider, account: provider + '@example.test', google_calendar_id: 'primary'};
}
export const CALENDARS = [LOCAL_CALENDAR, externalCalendar('google'), externalCalendar()];
export const FIELDS: EventFields = {
    title: 'Appointment', allDay: true, startDate: '2026-09-02', endDate: '2026-09-03', startTime: '', endTime: '',
    calendarId: LOCAL_CALENDAR.id, location: '', locationLat: null, locationLon: null, reminder: '', travelTime: '',
    recurrence: '', selectedDays: [], endType: 'never', endCount: 10, untilDate: '', description: '', attendees: [],
};
export const LOCAL_EVENT: CalendarEntry = {id: 'local-event', title: 'Local appointment', content: 'Local description', metadata: {date: '2026-09-02', end_date: '2026-09-03', source: 'Gnosi', table_id: LOCAL_CALENDAR.id, all_day: true}};
export function mutation(overrides: Partial<VaultPageMutation> = {}): VaultPageMutation {
    return {id: LOCAL_EVENT.id, title: LOCAL_EVENT.title, content: LOCAL_EVENT.content || '', metadata: LOCAL_EVENT.metadata, folder: 'Calendar', message: '', status: 'ok', ...overrides};
}
export function pageSummary(): VaultPageSummary {
    return {id: LOCAL_EVENT.id, title: LOCAL_EVENT.title, metadata: LOCAL_EVENT.metadata, folder: 'Calendar', path: '/Calendar/appointment.md', size: 100, is_database: false, last_modified: '2026-09-01'};
}
export function externalEvent(provider = 'caldav'): CalendarEvent {
    return {id: provider + '-event', title: provider + ' appointment', provider, account: provider + '@example.test', calendar_id: 'primary', calendar_name: provider, start: '2026-09-02', end: '2026-09-04', all_day: true, source: provider + '@example.test', location: '', description: 'External description', status: 'confirmed', link: '', is_read_only: false};
}
