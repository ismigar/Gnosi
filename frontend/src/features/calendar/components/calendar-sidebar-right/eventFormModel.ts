import { inclusiveToExclusiveAllDayEnd } from '../../../../shared/dates/calendarUtils';
import type { CalendarConfig, EventFields, EventMetadata, EventFormProps } from './calendarTypes';

export function eventCalendarChoices(calendars: readonly CalendarConfig[]) {
    // Legacy source aliases may refer to the same physical calendar. Keep those
    // sources for filtering, but offer each write destination once.
    const destinations = new Map<string, CalendarConfig>();
    for (const calendar of calendars) {
        if (!destinations.has(calendar.id)) destinations.set(calendar.id, calendar);
    }
    const unique = [...destinations.values()];
    return unique.map(calendar => ({
        calendar,
        label: unique.some(other => other.id !== calendar.id && other.name === calendar.name)
            ? [calendar.name, calendar.account, calendar.provider, calendar.google_calendar_id || calendar.id].filter(Boolean).join(' · ')
            : calendar.name,
    }));
}

export function recurrenceText(value: unknown): string {
    if (typeof value === 'string') return value.replace(/^RRULE:/, '');
    if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string').find(item => item.startsWith('RRULE:'))?.slice(6) || '';
    return '';
}
export function buildDatetime(date: string, time: string, allDay: boolean): string | null {
    if (!date) return null;
    return !allDay && time ? `${date}T${time}:00` : date;
}
function hasTimestampOffset(value: string): boolean {
    return /T.*(?:Z|[+-]\d{2}:?\d{2})$/i.test(value);
}
export function eventDateFields(value: string): { date: string; time: string } {
    const [date = '', clock = ''] = value.split('T');
    if (!hasTimestampOffset(value)) return { date, time: clock.slice(0, 5) };
    const instant = new Date(value);
    if (Number.isNaN(instant.getTime())) return { date, time: clock.slice(0, 5) };
    const pad = (part: number) => String(part).padStart(2, '0');
    return {
        date: `${String(instant.getFullYear())}-${pad(instant.getMonth() + 1)}-${pad(instant.getDate())}`,
        time: `${pad(instant.getHours())}:${pad(instant.getMinutes())}`,
    };
}
export function buildExternalDatetime(date: string, time: string, allDay: boolean, original?: string | null): string | null {
    const value = buildDatetime(date, time, allDay);
    if (!value || allDay || !time) return value;
    // Preserve the original instant (and seconds) when only another field changed.
    // This also distinguishes the two occurrences of a local time at DST fall-back.
    if (original) {
        const previous = eventDateFields(original);
        if (previous.date === date && previous.time === time) return original;
        if (original.includes('T') && !hasTimestampOffset(original)) return value;
    }
    const instant = new Date(value);
    return Number.isNaN(instant.getTime()) ? null : instant.toISOString();
}
export function buildExternalEventTimes(fields: EventFields, originalStart?: string | null, originalEnd?: string | null) {
    const { allDay, startDate, startTime, endDate, endTime } = fields;
    const start = buildExternalDatetime(startDate, startTime || '00:00', allDay, originalStart);
    if (allDay) return { start, end: inclusiveToExclusiveAllDayEnd(endDate || startDate) };
    if (endTime) return { start, end: buildExternalDatetime(endDate || startDate, endTime, false, originalEnd) };
    // End time is optional in the editor. Keep the duration of an event just
    // created by autosave, or give a new timed event one hour.
    const previousDuration = originalStart && originalEnd ? new Date(originalEnd).getTime() - new Date(originalStart).getTime() : 0;
    const duration = previousDuration > 0 ? previousDuration : 60 * 60 * 1000;
    const base = endDate && endDate !== startDate
        ? buildExternalDatetime(endDate, startTime || '00:00', false, originalStart)
        : start;
    if (!base) return { start, end: null };
    const floating = !hasTimestampOffset(base);
    const end = new Date(new Date(floating ? `${base}Z` : base).getTime() + duration);
    if (Number.isNaN(end.getTime())) return { start, end: null };
    const serializedEnd = end.toISOString();
    return { start, end: floating ? serializedEnd.slice(0, -5) : serializedEnd };
}
export function padTime(value: string): string {
    const parts = value.split(':');
    return parts.length === 2 ? `${(parts[0] || '').padStart(2, '0')}:${(parts[1] || '').padStart(2, '0')}` : value;
}
export function buildExternalEventData(fields: EventFields) {
 const { title, allDay, location, recurrence, selectedDays, endType, endCount, untilDate, description, attendees } = fields;
        const tz = (typeof Intl !== 'undefined' && Intl.DateTimeFormat().resolvedOptions().timeZone) || 'Europe/Madrid';
        const ev: Record<string, unknown> = { summary: title.trim() };
        const { start, end } = buildExternalEventTimes(fields);
        if (allDay) {
            ev.start = { date: start };
            ev.end = { date: end };
        } else {
            ev.start = { dateTime: start, timeZone: tz };
            ev.end = { dateTime: end, timeZone: tz };
        }
        if (location.trim()) ev.location = location.trim();
        if (description.trim()) ev.description = description.trim();
        if (attendees.length > 0) ev.attendees = attendees.map(a => ({ email: a.email, displayName: a.name || undefined }));
        if (recurrence) {
            const parts = [`FREQ=${recurrence}`];
            if (recurrence === 'WEEKLY' && selectedDays.length > 0) parts.push(`BYDAY=${selectedDays.join(',')}`);
            if (endType === 'count') parts.push(`COUNT=${String(endCount)}`);
            else if (endType === 'until' && untilDate) parts.push(`UNTIL=${untilDate.replace(/-/g, '')}T235959Z`);
            ev.recurrence = [`RRULE:${parts.join(';')}`];
        }
        return ev;
    };


export function buildLocalMetadata(fields: EventFields, {eventData, calendars}: Pick<EventFormProps, 'eventData' | 'calendars'>) {
 const { allDay, startDate, endDate, startTime, endTime, calendarId, location, locationLat, locationLon, reminder, recurrence, selectedDays, endType, endCount, untilDate, attendees, travelTime } = fields;
 const originalStart = eventData?.metadata.date || eventData?.metadata.start_time || eventData?.metadata.due_date;
 const originalEnd = eventData?.metadata.end_date || eventData?.metadata.end_time;
 const fullStart = buildExternalDatetime(startDate, startTime, allDay, originalStart?.includes('T') ? originalStart : buildDatetime(startDate, startTime, allDay));
 const fullEnd = buildExternalDatetime(endDate, endTime, allDay, originalEnd?.includes('T') ? originalEnd : buildDatetime(endDate, endTime, allDay));
        const metadata: EventMetadata = {
            date: fullStart,
            source: 'Gnosi',
            all_day: allDay,
            exdates: eventData?.metadata.exdates || [],
        };
        if (fullEnd) metadata.end_date = fullEnd;
        const removeMetaKeys = [];
        if (location.trim()) {
            metadata.location = location.trim();
            if (locationLat != null && locationLon != null) {
                metadata.location_lat = locationLat;
                metadata.location_lon = locationLon;
            } else {
                // Unverified location (free text/URL): clears old coords (PATCH merges)
                removeMetaKeys.push('location_lat', 'location_lon');
            }
        } else {
            // No location: clears the whole location block
            removeMetaKeys.push('location', 'location_lat', 'location_lon');
        }
        if (reminder) metadata.reminder = reminder;
        if (travelTime) metadata.travel_time = parseInt(travelTime, 10);
        else removeMetaKeys.push('travel_time');
        if (attendees.length > 0) metadata.attendees = attendees;

        if (recurrence) {
            const rruleParts = [`FREQ=${recurrence}`];
            if (recurrence === 'WEEKLY' && selectedDays.length > 0) {
                rruleParts.push(`BYDAY=${selectedDays.join(',')}`);
            }
            if (endType === 'count') {
                rruleParts.push(`COUNT=${String(endCount)}`);
            } else if (endType === 'until' && untilDate) {
                const compactUntil = untilDate.replace(/-/g, '') + 'T235959Z';
                rruleParts.push(`UNTIL=${compactUntil}`);
            }
            metadata.rrule = rruleParts.join(';');
        } else {
            metadata.rrule = null;
        }

        if (calendarId) {
            const cal = calendars.find(c => c.id === calendarId);
            if (cal?.kind === 'table') {
                metadata.table_id = calendarId;
                metadata.database_table_id = calendarId;
                metadata.table_name = cal.name;
                metadata.database_table_name = cal.name;
            } else {
                // External calendar (Google): we do NOT change the source to the calendar's email.
                // fetchPages filters out everything that isn't source 'Gnosi', so the appointment
                // would disappear on refresh. Until there's an integration to actually create it
                // in Google, we save it to the first Gnosi table so it remains
                // visible i no es perdi.
                const fallbackTable = calendars.find(c => c.kind === 'table');
                if (fallbackTable) {
                    metadata.table_id = fallbackTable.id;
                    metadata.database_table_id = fallbackTable.id;
                    metadata.table_name = fallbackTable.name;
                    metadata.database_table_name = fallbackTable.name;
                }
            }
        }


 return { metadata, removeMetaKeys };
}
