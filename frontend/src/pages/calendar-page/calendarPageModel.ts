import type { CalendarEvent, CalendarListItem } from '../../shared/api/calendar';
import type { IntegrationsDocument } from '../../shared/api/integrations';
import type { CalendarConfig, CalendarEntry } from '../../components/Vault/calendar-sidebar-right/calendarTypes';
import { attendeeList, record, stringList, textValue } from '../../components/Vault/calendar-sidebar-right/calendarBoundary';

export interface EnabledTable { id: string; name: string; type: 'table'; color?: string }
interface CalendarIntegration { email: string; name: string; url: string; color: string }
export interface CalendarSettings {
    calendars?: CalendarIntegration[];
    calendar_aliases?: Record<string, string>;
    calendar_colors?: Record<string, string>;
    calendar_selection?: string[] | { selection: string[] };
    default_calendar?: string;
    vault_calendar?: { color: string; enabled_tables: string[] };
}

function stringMap(value: unknown): Record<string, string> {
    return Object.fromEntries(Object.entries(record(value)).map(([key, item]) => [key, textValue(item)]));
}
export function calendarSettings(value: IntegrationsDocument): CalendarSettings {
    if (!Object.keys(value).length) return {};
    const rawCalendars: unknown[] = Array.isArray(value.calendars) ? value.calendars : [];
    const vault = record(value.vault_calendar);
    return {
        calendars: rawCalendars.map((item) => { const calendar = record(item); return { email: textValue(calendar.email), name: textValue(calendar.name), url: textValue(calendar.url), color: textValue(calendar.color) }; }),
        calendar_aliases: stringMap(value.calendar_aliases), calendar_colors: stringMap(value.calendar_colors),
        calendar_selection: Array.isArray(value.calendar_selection) ? stringList(value.calendar_selection) : { selection: stringList(record(value.calendar_selection).selection) },
        default_calendar: textValue(value.default_calendar),
        vault_calendar: { color: textValue(vault.color), enabled_tables: stringList(vault.enabled_tables) },
    };
}

export function availableCalendarSources(pages: readonly CalendarEntry[], externalEvents: readonly CalendarEntry[], enabledTables: readonly EnabledTable[], integrations: CalendarSettings): string[] {
    const sources = new Set<string>(enabledTables.map((table) => table.name));
    for (const calendar of integrations.calendars ?? []) {
        const source = calendar.email || calendar.name || calendar.url;
        if (source) sources.add(source);
    }
    for (const page of pages) {
        const source = (page.metadata.source ?? '').trim();
        if (source && source !== 'Gnosi' && source !== 'Gnosi Vault' && source !== 'es_es' && !source.includes('holidays')) sources.add(source);
    }
    for (const event of externalEvents) {
        const source = (event.metadata.source ?? '').trim();
        if (source && source !== 'Gnosi' && source !== 'Gnosi Vault') sources.add(source);
    }
    return [...sources];
}

export function hybridCalendarEntry(event: CalendarEvent): CalendarEntry {
    return { id: event.id, title: event.title, metadata: {
        date: event.start, end_date: event.end || null, all_day: event.all_day, source: event.source,
        location: event.location || '', description: event.description || '', rrule: event.recurrence || null,
        status: event.status, link: event.link || '', color: event.color || null, readonly: event.is_read_only || false,
        attendees: attendeeList(event.attendees), organizer: event.organizer || '', _provider: event.provider,
        _account: event.account, _calendar_id: event.calendar_id, _calendar_name: event.calendar_name,
        _vault_path: event.vault_path || null, _end_exclusive: event.provider !== 'vault' && event.all_day,
        _event_type: event.event_type || 'default', _birthday_properties: event.birthday_properties || null,
        recurring_event_id: event.recurring_event_id || null,
    } };
}

export function calendarConfigsFor(available: readonly string[], integrations: CalendarSettings, tables: readonly EnabledTable[], calendars: readonly CalendarListItem[]): CalendarConfig[] {
    const colors = ['#64b5f6', '#ffb74d', '#ba68c8', '#4db6ac', '#f06292'];
    return available.map((source, index) => {
        const isGnosi = source === 'Gnosi' || source === 'Gnosi Vault';
        const table = tables.find((item) => item.name === source);
        const alias = integrations.calendar_aliases?.[source] || (table ? integrations.calendar_aliases?.[table.id] : null);
        const integration = isGnosi || table
            ? { color: integrations.vault_calendar?.color || table?.color || 'var(--gnosi-primary)', name: '' }
            : integrations.calendars?.find((item) => item.url === source || item.name === source || item.email === source || (source.includes(' - ') && source.startsWith(item.email)));
        const [first, ...rest] = source.split(' - ');
        const account = source.includes(' - ') ? first ?? null : source.includes('@') ? source : null;
        const subName = source.includes(' - ') ? rest.join(' - ') : null;
        const calendar = !isGnosi && !table ? calendars.find((item) => item.account === account && ((subName && item.name === subName) || (!subName && (item.id === account || item.primary || item.name === account)))) : undefined;
        return { id: table?.id || source, source, kind: table ? 'table' : 'external', name: alias || subName || integration?.name || source,
            account, google_calendar_id: calendar?.id ?? null, provider: calendar ? textValue(calendar.provider) || 'google' : null,
            color: integrations.calendar_colors?.[source] || integration?.color || (isGnosi ? 'var(--gnosi-primary)' : colors[index % colors.length] ?? '#64b5f6') };
    });
}

export function formatLocalDate(date: Date): string {
    return `${String(date.getFullYear())}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function formatLocalDateTime(date: Date): string {
    return `${formatLocalDate(date)}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:00`;
}
