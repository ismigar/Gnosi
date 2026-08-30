import type { DateInput, EventInput } from '@fullcalendar/core';
import type FullCalendar from '@fullcalendar/react';
import type { RefObject } from 'react';
import type { BulkActionTemplate } from '../VaultBulkActionsBar';

export type CalendarMetadata = Readonly<Record<string, unknown>>;

export interface CalendarNote {
  readonly id: string;
  readonly title?: string | null;
  readonly metadata?: CalendarMetadata | null;
  readonly resolved_table_id?: string | null;
}

export interface CalendarSourceConfig {
  readonly id?: string;
  readonly source: string;
}

export interface CalendarContextMenu {
  readonly x: number;
  readonly y: number;
  readonly date: string;
  readonly eventId: string | null;
  readonly instanceStart?: string;
  readonly allDay?: boolean;
}

export interface CalendarSelection {
  readonly start: Date;
  readonly end: Date;
  readonly allDay: boolean;
  readonly startStr: string;
  readonly endStr: string;
}

export interface CalendarEditUpdate {
  readonly date?: string;
  readonly end_date?: string | null;
  readonly instanceStart: string;
}

export interface DigitalBrainCalendarProps {
  readonly allNotes: readonly CalendarNote[];
  readonly searchQuery?: string;
  readonly selectedCalendars?: ReadonlySet<string>;
  readonly onNoteSelect?: (id: string) => void;
  readonly onEventEdit?: (id: string, update?: CalendarEditUpdate, mode?: 'move' | 'resize') => void;
  readonly onContextMenu?: (menu: CalendarContextMenu) => void;
  readonly calendarRef?: RefObject<FullCalendar | null>;
  readonly onTitleChange?: (title: string) => void;
  readonly onDatesSet?: (range: { readonly start: string; readonly end: string }) => void;
  readonly onRefresh?: () => void;
  readonly calendarConfigs?: readonly CalendarSourceConfig[];
  readonly colorMap?: Readonly<Record<string, string>>;
  readonly onDateClick?: (date: Date) => void;
  readonly onSelection?: (selection: CalendarSelection) => void;
  readonly onDeleteSelected?: (ids: Set<string>) => void;
  readonly onDeletePage?: (id: string, title?: string | null) => void;
  readonly onApplyTemplate?: (ids: Set<string>, templateId: string) => void;
  readonly templates?: readonly BulkActionTemplate[];
  readonly dateField?: string;
  readonly endDateField?: string;
  readonly ignoreCalendarFilter?: boolean;
  readonly initialView?: string;
  readonly showHeaderToolbar?: boolean;
}

export interface CalendarEventDetails {
  readonly id: string;
  readonly readonly: boolean;
  readonly metadata: CalendarMetadata;
}

export interface RenderedCalendarEvent extends EventInput {
  id: string;
  title: string;
  start: DateInput;
  extendedProps: CalendarEventDetails;
}

export interface CalendarHoveredEvent {
  readonly title: string;
  readonly start: Date | null;
  readonly end: Date | null;
  readonly allDay: boolean;
  readonly location: string;
  readonly description: string;
  readonly attendees: readonly string[];
  readonly reminder: string;
  readonly travelTime: string;
  readonly color: string;
  readonly x: number;
  readonly y: number;
}
