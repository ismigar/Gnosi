import type { GlobalSearchNote } from '../../../shared/page-search/GlobalSearchModal';
import type { FilterValue } from '../../../shared/filtering/vaultFilters';
import type { CalendarEntry } from '../components/calendar-sidebar-right/calendarTypes';
import { record } from '../components/calendar-sidebar-right/calendarBoundary';

function filterValue(value: unknown): FilterValue {
    if (value === null || value === undefined || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return value;
    if (Array.isArray(value)) { const items: unknown[] = value; return items.map(filterValue); }
    return Object.fromEntries(Object.entries(record(value)).map(([key, item]) => [key, filterValue(item)]));
}

export function calendarSearchNote(note: CalendarEntry): GlobalSearchNote {
    return {
        ...Object.fromEntries(Object.entries(note).map(([key, value]) => [key, filterValue(value)])),
        id: note.id, title: note.title,
        metadata: Object.fromEntries(Object.entries(note.metadata).map(([key, value]) => [key, filterValue(value)])),
    };
}
