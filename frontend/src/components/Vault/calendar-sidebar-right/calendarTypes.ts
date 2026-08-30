import type { DigitalBrainCalendarProps } from '../DigitalBrainCalendar';
import type { CalendarAttendee } from '../../../shared/api/calendar';

export interface EventAttendee extends CalendarAttendee {
    rsvp?: string;
    self?: boolean;
    organizer?: boolean;
}

export interface EventMetadata extends Record<string, unknown> {
    title?: string;
    date?: string | null;
    start_time?: string;
    due_date?: string;
    end_date?: string | null;
    end_time?: string;
    all_day?: boolean;
    source?: string;
    table_id?: string;
    database_table_id?: string;
    location?: string;
    location_lat?: number | null;
    location_lon?: number | null;
    reminder?: string;
    travel_time?: string | number;
    rrule?: unknown;
    recurrence?: unknown;
    exdates?: string[] | string;
    attendees?: EventAttendee[];
    readonly?: boolean;
    _provider?: string;
    _account?: string;
    _calendar_id?: string;
    _vault_path?: string | null;
    _end_exclusive?: boolean;
}

export interface CalendarEntry extends Omit<DigitalBrainCalendarProps['allNotes'][number], 'title' | 'metadata'> {
    title: string;
    content?: string;
    path?: string | null;
    abs_path?: string;
    metadata: EventMetadata;
}

export interface CalendarConfig {
    id: string;
    source: string;
    kind: 'table' | 'external';
    name: string;
    account: string | null;
    google_calendar_id: string | null;
    provider: string | null;
    color: string;
    is_default?: boolean;
}

export interface EventPanel {
    mode: 'create' | 'edit' | 'view';
    data: CalendarEntry | null;
    date: string;
    isEditing?: boolean;
    isExternal?: boolean;
}

export interface CalendarSidebarRightProps {
    searchQuery: string;
    onSearchChange: (query: string) => void;
    eventPanel?: EventPanel | null;
    onClosePanel?: () => void;
    onSaved?: (event?: CalendarEntry) => void;
    onRsvp?: (status: string) => void;
    calendars?: readonly CalendarConfig[];
    onToggleSidebar?: () => void;
    onOpenSearch?: () => void;
    allNotes?: readonly CalendarEntry[];
    onEventEdit?: (id: string) => void;
    userEmail?: string;
    defaultCalendarId?: string;
}

export interface EventFormProps {
    mode: EventPanel['mode'];
    eventData: CalendarEntry | null;
    initialDate: string;
    calendars: readonly CalendarConfig[];
    onClose?: () => void;
    onSaved?: CalendarSidebarRightProps['onSaved'];
    onRsvp?: CalendarSidebarRightProps['onRsvp'];
    defaultCalendarId?: string;
}

export interface EventFields {
    title: string; allDay: boolean; startDate: string; endDate: string;
    startTime: string; endTime: string; calendarId: string;
    location: string; locationLat: number | null; locationLon: number | null;
    reminder: string; travelTime: string; recurrence: string; selectedDays: string[];
    endType: string; endCount: string | number; untilDate: string;
    description: string; attendees: EventAttendee[];
}
