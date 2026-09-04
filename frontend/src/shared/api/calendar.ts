import type { components } from '../../generated/openapi';
import { apiClient } from './client';
import { unwrapApiResult } from './errors';


export type CalendarListItem = components['schemas']['CalendarListItemResponse'];
export type CalendarEvent = components['schemas']['CalendarEventResponse'];
export type GoogleCalendarEvent = components['schemas']['GoogleEventResourceResponse'];
export type MeetingReminder = components['schemas']['MeetingReminderResponse'];
export type MeetingReminders = components['schemas']['MeetingRemindersResponse'];
export type MeetingReminderSettings =
  components['schemas']['MeetingReminderSettingsResponse'];
export type CalendarStatus = components['schemas']['CalendarStatusResponse'];
export type CalendarStatusMessage =
  components['schemas']['CalendarStatusMessageResponse'];
export type CalendarFreeBusy = components['schemas']['FreeBusyResponse'];
export type CalendarSyncResult = components['schemas']['CalendarSyncResponse'];
export type CalendarAttendee =
  components['schemas']['CalendarAttendeeSearchResponse'];
export type CalendarGeocodeResult =
  components['schemas']['CalendarGeocodeResponse'];
export type CalendarRsvpResult = components['schemas']['CalendarRsvpResponse'];
export type CalendarInviteInput = components['schemas']['CalendarInviteRequest'];
export type CalendarInviteResult = components['schemas']['CalendarInviteResponse'];


export interface CalendarListResult {
  readonly authError: string;
  readonly items: CalendarListItem[];
}


export interface CalendarEventsQuery {
  readonly calendarId?: string;
  readonly email?: string;
  readonly includeVault?: boolean;
  readonly search?: string;
  readonly timeMax?: string;
  readonly timeMin?: string;
}


export interface CalendarEventMutationInput {
  readonly calendarId?: string;
  readonly email: string;
  readonly event: Record<string, unknown>;
  readonly eventId: string;
}


export interface CalendarEventCreateInput {
  readonly calendarId?: string;
  readonly email: string;
  readonly event: Record<string, unknown>;
}


export interface CalendarEventDeleteInput {
  readonly calendarId?: string;
  readonly email: string;
  readonly eventId: string;
  readonly vaultPath?: string;
}


export interface CalendarFreeBusyInput {
  readonly calendarIds?: string[];
  readonly email: string;
  readonly timeMax: string;
  readonly timeMin: string;
}


export interface CalendarRsvpInput {
  readonly calendarId?: string;
  readonly email: string;
  readonly eventId: string;
  readonly rsvp: string;
}


export async function fetchCalendarList(email?: string): Promise<CalendarListResult> {
  const result = await apiClient.GET('/api/calendar/calendars', {
    params: { query: { email } },
  });
  return {
    authError: result.response.headers.get('X-Calendar-Auth-Error') ?? '',
    items: unwrapApiResult<CalendarListItem[], unknown>(result),
  };
}


export async function fetchCalendarEvents(
  query: CalendarEventsQuery = {},
  signal?: AbortSignal,
): Promise<CalendarEvent[]> {
  return unwrapApiResult<CalendarEvent[], unknown>(
    await apiClient.GET('/api/calendar/events', {
      params: {
        query: {
          calendar_id: query.calendarId,
          email: query.email,
          include_vault: query.includeVault,
          search: query.search,
          time_max: query.timeMax,
          time_min: query.timeMin,
        },
      },
      signal,
    }),
  );
}


export async function fetchCalendarEvent(
  eventId: string,
  email: string,
  calendarId?: string,
): Promise<CalendarEvent> {
  return unwrapApiResult<CalendarEvent, unknown>(
    await apiClient.GET('/api/calendar/events/{event_id}', {
      params: {
        path: { event_id: eventId },
        query: { calendar_id: calendarId, email },
      },
    }),
  );
}


export async function createCalendarEvent({
  calendarId = 'primary',
  email,
  event,
}: CalendarEventCreateInput): Promise<GoogleCalendarEvent> {
  return unwrapApiResult<GoogleCalendarEvent, unknown>(
    await apiClient.POST('/api/calendar/events', {
      body: event,
      params: { query: { calendar_id: calendarId, email } },
    }),
  );
}


export async function updateCalendarEvent({
  calendarId = 'primary',
  email,
  event,
  eventId,
}: CalendarEventMutationInput): Promise<CalendarStatus> {
  return unwrapApiResult<CalendarStatus, unknown>(
    await apiClient.PATCH('/api/calendar/events/{event_id}', {
      body: event,
      params: {
        path: { event_id: eventId },
        query: { calendar_id: calendarId, email },
      },
    }),
  );
}


export async function deleteCalendarEvent({
  calendarId = 'primary',
  email,
  eventId,
  vaultPath,
}: CalendarEventDeleteInput): Promise<CalendarStatus> {
  return unwrapApiResult<CalendarStatus, unknown>(
    await apiClient.DELETE('/api/calendar/events/{event_id}', {
      params: {
        path: { event_id: eventId },
        query: { calendar_id: calendarId, email, vault_path: vaultPath },
      },
    }),
  );
}


export async function fetchMeetingReminders(): Promise<MeetingReminders> {
  return unwrapApiResult<MeetingReminders, unknown>(
    await apiClient.GET('/api/calendar/reminders'),
  );
}


export async function dismissMeetingReminder(reminderId: string): Promise<CalendarStatus> {
  return unwrapApiResult<CalendarStatus, unknown>(
    await apiClient.POST('/api/calendar/reminders/{reminder_id}/dismiss', {
      params: { path: { reminder_id: reminderId } },
    }),
  );
}


export async function fetchMeetingReminderSettings(): Promise<MeetingReminderSettings> {
  return unwrapApiResult<MeetingReminderSettings, unknown>(
    await apiClient.GET('/api/calendar/reminders/settings'),
  );
}


export async function updateMeetingReminderSettings(
  settings: Partial<MeetingReminderSettings>,
): Promise<MeetingReminderSettings> {
  return unwrapApiResult<MeetingReminderSettings, unknown>(
    await apiClient.PUT('/api/calendar/reminders/settings', { body: settings }),
  );
}


export async function fetchCalendarFreeBusy({
  calendarIds = [],
  email,
  timeMax,
  timeMin,
}: CalendarFreeBusyInput): Promise<CalendarFreeBusy> {
  return unwrapApiResult<CalendarFreeBusy, unknown>(
    await apiClient.POST('/api/calendar/freebusy', {
      body: { calendar_ids: calendarIds, time_max: timeMax, time_min: timeMin },
      params: { query: { email } },
    }),
  );
}


export async function syncCalendar(email?: string): Promise<CalendarSyncResult> {
  return unwrapApiResult<CalendarSyncResult, unknown>(
    await apiClient.POST('/api/calendar/sync', {
      params: { query: { email } },
    }),
  );
}


export async function searchCalendarAttendees(query: string): Promise<CalendarAttendee[]> {
  return unwrapApiResult<CalendarAttendee[], unknown>(
    await apiClient.GET('/api/calendar/attendees/search', {
      params: { query: { q: query } },
    }),
  );
}


export async function geocodeCalendarLocation(
  query: string,
): Promise<CalendarGeocodeResult[]> {
  return unwrapApiResult<CalendarGeocodeResult[], unknown>(
    await apiClient.GET('/api/calendar/geocode', {
      params: { query: { q: query } },
    }),
  );
}


export async function rsvpCalendarEvent({
  calendarId = 'primary',
  email,
  eventId,
  rsvp,
}: CalendarRsvpInput): Promise<CalendarRsvpResult> {
  return unwrapApiResult<CalendarRsvpResult, unknown>(
    await apiClient.POST('/api/calendar/events/{event_id}/rsvp', {
      body: { calendar_id: calendarId, email, rsvp },
      params: { path: { event_id: eventId } },
    }),
  );
}


export async function inviteCalendarEvent(
  eventId: string,
  input: Partial<CalendarInviteInput>,
): Promise<CalendarInviteResult> {
  return unwrapApiResult<CalendarInviteResult, unknown>(
    await apiClient.POST('/api/calendar/events/{event_id}/invite', {
      body: { calendar_id: 'primary', is_vault: false, ...input },
      params: { path: { event_id: eventId } },
    }),
  );
}


export async function hideCalendarEvent(eventId: string): Promise<CalendarStatusMessage> {
  return unwrapApiResult<CalendarStatusMessage, unknown>(
    await apiClient.POST('/api/calendar/events/{event_id}/hide', {
      params: { path: { event_id: eventId } },
    }),
  );
}


export async function unhideCalendarEvent(eventId: string): Promise<CalendarStatusMessage> {
  return unwrapApiResult<CalendarStatusMessage, unknown>(
    await apiClient.POST('/api/calendar/events/{event_id}/unhide', {
      params: { path: { event_id: eventId } },
    }),
  );
}
