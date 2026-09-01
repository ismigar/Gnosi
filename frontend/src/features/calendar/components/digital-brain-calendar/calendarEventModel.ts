import type { DateInput, EventApi, EventInput } from '@fullcalendar/core';
import type {} from '@fullcalendar/rrule';

import { inclusiveToExclusiveAllDayEnd } from '../../../../shared/dates/calendarUtils';
import { parsePeriod } from '../../../../shared/dates/projectPlanning';
import { calendarPeriodInput, calendarRecord, calendarText, isCalendarPeriod } from './calendarPeriod';
import type { CalendarEventDetails, CalendarMetadata, CalendarNote, DigitalBrainCalendarProps, RenderedCalendarEvent } from './calendarTypes';

export const EMPTY_CALENDAR_SOURCES: ReadonlySet<string> = new Set();
export const EMPTY_CALENDAR_CONFIGS = [] as const;
export const EMPTY_CALENDAR_COLORS = Object.freeze({});

const foldAccents = (value: string): string => value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

function dateValue(value: unknown): string | number | Date | undefined {
  return typeof value === 'string' || typeof value === 'number' || value instanceof Date ? value : undefined;
}

function recurrence(rule: string, start: DateInput, metadata: CalendarMetadata): Pick<EventInput, 'rrule' | 'exdate'> {
  const rrule: Exclude<NonNullable<EventInput['rrule']>, string> = { dtstart: start };
  let excluded: string[] = [];
  for (const part of rule.split(';')) {
    const [key, value] = part.split('=');
    if (!value) continue;
    if (key === 'FREQ') rrule.freq = value.toLowerCase();
    if (key === 'COUNT') rrule.count = Number.parseInt(value);
    if (key === 'UNTIL') rrule.until = value;
    if (key === 'INTERVAL') rrule.interval = Number.parseInt(value);
    if (key === 'BYDAY') rrule.byweekday = value.split(',');
    if (key === 'EXDATE') excluded = value.split(',').filter(Boolean);
  }
  if (!rrule.freq) return {};
  const metadataExcluded = Array.isArray(metadata.exdates)
    ? metadata.exdates.flatMap((value: unknown) => { const date = dateValue(value); return date === undefined ? [] : [date]; })
    : calendarText(metadata.exdates).split(',').filter(Boolean);
  const exdate = [...metadataExcluded, ...excluded];
  return { rrule, ...(exdate.length > 0 ? { exdate } : {}) };
}

interface EventOptions extends Pick<DigitalBrainCalendarProps, 'searchQuery' | 'selectedCalendars' | 'calendarConfigs' | 'colorMap' | 'dateField' | 'endDateField' | 'ignoreCalendarFilter'> {
  readonly untitled: string;
}

function noteEvent(note: CalendarNote, options: EventOptions): RenderedCalendarEvent | null {
  const metadata = note.metadata;
  if (!metadata) return null;
  let source = calendarText(metadata.table_name || metadata.database_table_name || metadata.source || 'Gnosi').trim();
  if (source === 'Gnosi Vault') source = 'Gnosi';
  const tableId = note.resolved_table_id || metadata.table_id || metadata.database_table_id;
  const sourceConfig = tableId ? options.calendarConfigs?.find((config) => config.id === tableId) : undefined;
  if (sourceConfig) source = sourceConfig.source;
  if (!options.ignoreCalendarFilter && !options.selectedCalendars?.has(source)) return null;
  const title = note.title || calendarText(metadata.title) || options.untitled;
  if (options.searchQuery && !foldAccents(title).includes(foldAccents(options.searchQuery))) return null;
  let rawStart = options.dateField
    ? metadata[options.dateField]
    : metadata.date || metadata.data || metadata.start_time || metadata.due_date;
  let periodEnd: string | null = null;
  if (isCalendarPeriod(rawStart)) {
    const period = parsePeriod(calendarPeriodInput(rawStart));
    rawStart = period.start;
    periodEnd = period.end || null;
  }
  if (!rawStart) return null;
  const start = dateValue(rawStart);
  if (start === undefined) return null;
  const allDay = !String(start).includes('T') || Boolean(metadata.all_day);
  const color = options.colorMap?.[source] || calendarText(metadata.color)
    || (source === 'Gnosi' ? 'var(--gnosi-primary)' : 'var(--text-tertiary)');
  const configuredEnd = options.endDateField ? metadata[options.endDateField] : undefined;
  const rawEnd = options.endDateField
    ? (configuredEnd !== null && configuredEnd !== undefined && configuredEnd !== '' ? configuredEnd : periodEnd)
    : periodEnd || metadata.end_date || metadata.end_time;
  let end = dateValue(rawEnd);
  if (end && allDay && !metadata._end_exclusive && !(end instanceof Date)) end = inclusiveToExclusiveAllDayEnd(end);
  return {
    id: note.id, title, start, end, allDay, color, textColor: allDay ? '#ffffff' : color,
    extendedProps: { id: note.id, readonly: Boolean(metadata.readonly), metadata },
    ...recurrence(calendarText(metadata.rrule), start, metadata),
  };
}

export function buildCalendarEvents(notes: readonly CalendarNote[], options: EventOptions): RenderedCalendarEvent[] {
  return notes.flatMap((note) => { const event = noteEvent(note, options); return event ? [event] : []; });
}

/** Narrow FullCalendar's untyped extendedProps at the third-party boundary. */
export function calendarEventDetails(event: Pick<EventApi, 'id' | 'extendedProps'>): CalendarEventDetails {
  const raw: unknown = event.extendedProps;
  const details = calendarRecord(raw);
  return {
    id: calendarText(details?.id) || event.id,
    readonly: Boolean(details?.readonly),
    metadata: calendarRecord(details?.metadata) ?? {},
  };
}

export function localCalendarDateTime(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function calendarEventAppearance(event: Pick<EventApi, 'allDay' | 'start' | 'end' | 'startStr' | 'id' | 'extendedProps'>, now = new Date()) {
  const allDay = event.allDay || Boolean(calendarEventDetails(event).metadata.all_day) || !event.startStr.includes('T');
  const date = event.start ?? new Date(event.startStr);
  const dayStart = (value: Date): number => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  return { allDay, past: allDay ? dayStart(date) < dayStart(now) : (event.end ?? date).getTime() < now.getTime() };
}
