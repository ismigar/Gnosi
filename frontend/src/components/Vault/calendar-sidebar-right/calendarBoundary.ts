import type { CalendarEntry, EventAttendee, EventMetadata } from './calendarTypes';
import type { VaultPage, VaultPageMutation, VaultPageSummary } from '../../../shared/api/vaults';

export function record(value: unknown): Readonly<Record<string, unknown>> {
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Readonly<Record<string, unknown>> : {};
}
export function textValue(value: unknown): string {
    return typeof value === 'string' ? value : typeof value === 'number' || typeof value === 'boolean' ? String(value) : '';
}
export function stringList(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    const values: unknown[] = value;
    return values.filter((item): item is string => typeof item === 'string');
}
export function attendeeList(value: unknown): EventAttendee[] {
    if (!Array.isArray(value)) return [];
    const values: unknown[] = value;
    return values.map((item) => {
        const attendee = record(item);
        return { ...attendee, email: textValue(attendee.email), name: textValue(attendee.name), rsvp: textValue(attendee.rsvp), self: Boolean(attendee.self), organizer: Boolean(attendee.organizer) };
    });
}
export function eventMetadata(value: unknown): EventMetadata {
    const raw = record(value);
    const result: EventMetadata = { ...raw };
    const strings = ['title', 'date', 'start_time', 'due_date', 'end_date', 'end_time', 'source', 'table_id', 'database_table_id', 'location', 'reminder', '_provider', '_account', '_calendar_id', '_vault_path'] as const;
    for (const key of strings) {
        if (key in raw) result[key] = textValue(raw[key]);
    }
    if ('travel_time' in raw) result.travel_time = textValue(raw.travel_time);
    if ('attendees' in raw) result.attendees = attendeeList(raw.attendees);
    if ('exdates' in raw) result.exdates = typeof raw.exdates === 'string' ? raw.exdates : stringList(raw.exdates);
    for (const key of ['all_day', 'readonly', '_end_exclusive'] as const) {
        if (key in raw) result[key] = Boolean(raw[key]);
    }
    for (const key of ['location_lat', 'location_lon'] as const) {
        if (key in raw) result[key] = typeof raw[key] === 'number' ? raw[key] : null;
    }
    return result;
}
export function calendarEntry(page: VaultPage | VaultPageMutation | VaultPageSummary): CalendarEntry {
    return { ...page, title: textValue(page.title), metadata: eventMetadata(page.metadata), ...('content' in page ? { content: textValue(page.content) } : {}) };
}

export function exdatesFor(meta: EventMetadata): string[] {
    return Array.isArray(meta.exdates) ? meta.exdates : typeof meta.exdates === 'string' ? meta.exdates.split(',').filter(Boolean) : [];
}
