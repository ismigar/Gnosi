import { inclusiveToExclusiveAllDayEnd } from '../../../../shared/dates/calendarUtils';
import type { EventFields, EventMetadata, EventFormProps } from './calendarTypes';
export function recurrenceText(value: unknown): string {
    if (typeof value === 'string') return value.replace(/^RRULE:/, '');
    if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string').find(item => item.startsWith('RRULE:'))?.slice(6) || '';
    return '';
}
export function buildDatetime(date: string, time: string, allDay: boolean): string | null {
    if (!date) return null;
    return !allDay && time ? `${date}T${time}:00` : date;
}
export function padTime(value: string): string {
    const parts = value.split(':');
    return parts.length === 2 ? `${(parts[0] || '').padStart(2, '0')}:${(parts[1] || '').padStart(2, '0')}` : value;
}
export function buildExternalEventData(fields: EventFields) {
 const { title, allDay, startDate, endDate, startTime, endTime, location, recurrence, selectedDays, endType, endCount, untilDate, description, attendees } = fields;
        const tz = (typeof Intl !== 'undefined' && Intl.DateTimeFormat().resolvedOptions().timeZone) || 'Europe/Madrid';
        const ev: Record<string, unknown> = { summary: title.trim() };
        if (allDay) {
            ev.start = { date: startDate };
            // In Google, end.date is EXCLUSIVE → +1 day relative to the last day
            const base = endDate || startDate;
            ev.end = { date: inclusiveToExclusiveAllDayEnd(base) };
        } else {
            const st = `${startDate}T${startTime || '00:00'}:00`;
            const en = (endDate && endTime) ? `${endDate}T${endTime}:00`
                : (endTime ? `${startDate}T${endTime}:00` : `${startDate}T${startTime || '00:00'}:00`);
            ev.start = { dateTime: st, timeZone: tz };
            ev.end = { dateTime: en, timeZone: tz };
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
 const fullStart = buildDatetime(startDate, startTime, allDay);
 const fullEnd = buildDatetime(endDate, endTime, allDay);
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
