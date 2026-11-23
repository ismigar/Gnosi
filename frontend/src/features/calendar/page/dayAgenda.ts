import { RRule } from 'rrule';
import type { RenderedCalendarEvent } from '../components/digital-brain-calendar/calendarTypes';
import { formatLocalDate } from './calendarPageModel';

export interface DayAppointment {
    readonly id: string;
    readonly source?: string;
    readonly instance?: string;
    readonly title: string;
    readonly start: Date;
    readonly end: Date;
    readonly allDay: boolean;
    readonly color?: string;
}

export function localDayRange(now: Date) {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    return { start: start.toISOString(), end: end.toISOString(), day: formatLocalDate(start) };
}

function dateValue(value: unknown, allDay: boolean): Date | null {
    let result: Date;
    if (value instanceof Date) result = value;
    else if (typeof value === 'number') result = new Date(value);
    else if (typeof value === 'string') {
        // Date-only values are civil dates in the calendar, even west of UTC.
        result = new Date(allDay || /^\d{4}-\d{2}-\d{2}$/u.test(value) ? `${value.slice(0, 10)}T00:00:00` : value);
    } else return null;
    return Number.isFinite(result.getTime()) ? result : null;
}

function floatingUtc(date: Date) {
    return new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), date.getHours(), date.getMinutes(), date.getSeconds()));
}
function fromFloatingUtc(date: Date) {
    return new Date(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds());
}

function occurrenceStarts(event: RenderedCalendarEvent, start: Date, earliest: Date, latest: Date): Date[] {
    const meta = event.extendedProps.metadata;
    const text = meta.date_rrule || meta.rrule;
    // Providers deliver expanded instances. Vault series store the original date and rule.
    if (event.extendedProps.isExternal || typeof text !== 'string' || !text) return [start];
    const parts = text.replace(/^RRULE:/iu, '').split(';');
    const rule = parts.filter(part => !part.startsWith('EXDATE=')).join(';');
    const metadataDates: unknown[] = Array.isArray(meta.exdates) ? meta.exdates : typeof meta.exdates === 'string' ? meta.exdates.split(',') : [];
    const excluded = [
        ...parts.filter(part => part.startsWith('EXDATE=')).flatMap(part => part.slice(7).split(',')),
        ...metadataDates,
    ].filter((date): date is string => typeof date === 'string');
    const allDay = Boolean(event.allDay);
    const isFloating = allDay || (typeof event.start === 'string' && !/T.*(?:Z|[+-]\d{2}:?\d{2})$/iu.test(event.start));
    const toRuleTime = (date: Date) => isFloating ? floatingUtc(date) : date;
    try {
        const options = RRule.parseString(rule);
        // These are the recurrence units supported by the calendar editor.
        if (options.freq === undefined || options.freq > RRule.DAILY || (options.interval ?? 1) < 1) return [start];
        const series = new RRule({ ...options, dtstart: toRuleTime(start) }, true);
        const excludedTimes = new Set(excluded.flatMap(value => {
            const parsed = dateValue(value, allDay);
            return parsed ? [parsed.getTime()] : [];
        }));
        return series.between(toRuleTime(earliest), toRuleTime(latest), true)
            .map(date => isFloating ? fromFloatingUtc(date) : date)
            .filter(date => !excludedTimes.has(date.getTime()));
    } catch { return [start]; }
}

export function appointmentsForDay(events: readonly RenderedCalendarEvent[], range: ReturnType<typeof localDayRange>): DayAppointment[] {
    const dayStart = new Date(range.start);
    const dayEnd = new Date(range.end);
    const appointments: DayAppointment[] = [];
    for (const event of events) {
        const meta = event.extendedProps.metadata;
        if (meta.status === 'cancelled') continue;
        const allDay = Boolean(event.allDay);
        const start = dateValue(event.start, allDay);
        if (!start) continue;
        const end = dateValue(event.end, allDay);
        const elapsed = end && end > start ? end.getTime() - start.getTime() : 3_600_000;
        const days = allDay && end ? Math.max(1, Math.round((floatingUtc(end).getTime() - floatingUtc(start).getTime()) / 86_400_000)) : 1;
        const earliest = new Date(dayStart);
        if (allDay) earliest.setDate(earliest.getDate() - days);
        else earliest.setTime(earliest.getTime() - elapsed);
        for (const occurrence of occurrenceStarts(event, start, earliest, dayEnd)) {
            const finish = new Date(occurrence);
            if (allDay) finish.setDate(finish.getDate() + days);
            else finish.setTime(finish.getTime() + elapsed);
            if (occurrence >= dayEnd || finish <= dayStart) continue;
            appointments.push({
                id: event.id, source: event.extendedProps.isExternal && typeof meta.source === 'string' ? meta.source : undefined,
                instance: meta._provider === 'caldav' && typeof meta.date === 'string' ? meta.date : undefined,
                title: event.title, allDay, start: occurrence, end: finish, color: event.color,
            });
        }
    }
    return appointments.sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start.getTime() - b.start.getTime() || a.title.localeCompare(b.title));
}

export function visibleAppointments(items: readonly DayAppointment[], now: Date, compact: boolean) {
    const next = items.find(item => !item.allDay && item.start > now);
    const rows = compact
        ? [...items.filter(item => !item.allDay && item.end > now), ...items.filter(item => item.allDay)].slice(0, 2)
        : items;
    return rows.map(item => ({
        ...item,
        state: item.allDay ? 'all-day' : item.end <= now ? 'past' : item.start <= now ? 'current' : item === next ? 'next' : 'later',
    }));
}
