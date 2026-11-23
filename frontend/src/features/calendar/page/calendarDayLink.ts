import { vaultPath } from '../../../shared/routing/vaultRouting';
import { formatLocalDate } from './calendarPageModel';

export function calendarDayLink(day: string, eventId?: string, source?: string, instance?: string): string {
    const query = new URLSearchParams({ date: day });
    if (source) query.set('source', source);
    if (instance) query.set('instance', instance);
    const path = eventId ? `event/${encodeURIComponent(eventId)}` : '';
    return `${vaultPath('calendar', path)}?${query.toString()}`;
}

export function readCalendarDayLink(pathname: string, search: string) {
    const query = new URLSearchParams(search);
    const rawDate = query.get('date') || '';
    const date = /^\d{4}-\d{2}-\d{2}$/u.test(rawDate) && formatLocalDate(new Date(`${rawDate}T12:00:00`)) === rawDate
        ? rawDate : undefined;
    const encoded = /^\/@[^/]+\/calendar\/event\/([^/]+)\/?$/u.exec(pathname)?.[1];
    let eventId: string | undefined;
    if (encoded) {
        try { eventId = decodeURIComponent(encoded); } catch { /* A malformed link can still open its day. */ }
    }
    return { date, eventId, source: query.get('source') || undefined, instance: query.get('instance') || undefined };
}
