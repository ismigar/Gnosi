import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { DatesSetArg, EventClickArg, EventContentArg, EventHoveringArg, EventMountArg } from '@fullcalendar/core';
import type { DateClickArg } from '@fullcalendar/interaction';
import type FullCalendar from '@fullcalendar/react';

import { useVaultSelection } from '../../../../shared/records/hooks/useVaultSelection';
import { useVaultSelectionShortcuts } from '../../../../shared/records/hooks/useVaultSelectionShortcuts';
import { toast } from '../../../../shared/notifications/toast';
import { eventTargetClosest } from '../../../../shared/platform/browser-events';
import { useTitlePreview } from '../../../../shared/editor/useTitlePreview';
import { buildCalendarEvents, calendarEventAppearance, calendarEventDetails, EMPTY_CALENDAR_COLORS, EMPTY_CALENDAR_CONFIGS, EMPTY_CALENDAR_SOURCES } from './calendarEventModel';
import { persistCalendarChange, type CalendarChange } from './calendarMutations';
import { calendarRecord, calendarText } from './calendarPeriod';
import type { CalendarHoveredEvent, DigitalBrainCalendarProps } from './calendarTypes';

export function useDigitalBrainCalendar(props: DigitalBrainCalendarProps) {
  const { t, i18n } = useTranslation();
  const {
    allNotes, calendarConfigs = EMPTY_CALENDAR_CONFIGS, colorMap = EMPTY_CALENDAR_COLORS,
    dateField = '', endDateField = '', ignoreCalendarFilter = false,
    initialView = 'dayGridMonth', onApplyTemplate, onContextMenu, onDateClick,
    onDatesSet, onDeletePage, onDeleteSelected, onEventEdit, onNoteSelect, onRefresh,
    onTitleChange, searchQuery = '', selectedCalendars = EMPTY_CALENDAR_SOURCES,
    showHeaderToolbar = false,
  } = props;
  const internalCalendarRef = useRef<FullCalendar | null>(null);
  const calendarRef = props.calendarRef || internalCalendarRef;
  const [toolbar, setToolbar] = useState({ title: '', view: initialView });
  const toolbarRef = useRef({ title: '', view: initialView });
  const toolbarTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [hoveredEvent, setHoveredEvent] = useState<CalendarHoveredEvent | null>(null);
  const lastEventClickTimeRef = useRef(0);
  const { openHover, scheduleClose, preview } = useTitlePreview({ onOpenPage: onNoteSelect });
  const events = useMemo(() => buildCalendarEvents(allNotes, {
    calendarConfigs, colorMap, dateField, endDateField, ignoreCalendarFilter,
    searchQuery, selectedCalendars, untitled: t('common.untitled', 'Untitled'),
  }), [allNotes, calendarConfigs, colorMap, dateField, endDateField, ignoreCalendarFilter, searchQuery, selectedCalendars, t]);
  const { selectedIds, isSelected, toggleSelect, selectAll, clearSelection } = useVaultSelection(events);
  const allEventIds = useMemo(() => [...new Set(events.map((event) => event.id))], [events]);

  useEffect(() => () => {
    if (toolbarTimerRef.current !== null) clearTimeout(toolbarTimerRef.current);
  }, []);

  const handleBulkDelete = useCallback((): void => {
    if (selectedIds.size === 0) return;
    if (onDeleteSelected) {
      onDeleteSelected(new Set(selectedIds));
      clearSelection();
    } else if (onDeletePage) {
      for (const id of selectedIds) {
        const note = allNotes.find((item) => item.id === id);
        if (note) onDeletePage(id, note.title);
      }
      clearSelection();
    }
  }, [selectedIds, onDeleteSelected, onDeletePage, allNotes, clearSelection]);
  useVaultSelectionShortcuts({ selectAll: () => { selectAll(allEventIds); }, clearSelection,
    onDeleteSelected: (onDeleteSelected || onDeletePage) ? handleBulkDelete : undefined });

  const handleEventMouseEnter = useCallback((info: EventHoveringArg): void => {
    const { event, jsEvent } = info;
    const { id, readonly, metadata } = calendarEventDetails(event);
    if (id && !readonly) {
      openHover(id, info.el.getBoundingClientRect());
      return;
    }
    setHoveredEvent({
      title: event.title, start: event.start, end: event.end, allDay: event.allDay,
      location: calendarText(metadata.location), description: calendarText(metadata.description),
      attendees: Array.isArray(metadata.attendees) ? metadata.attendees.map((value: unknown) => {
        const attendee = calendarRecord(value);
        return calendarText(attendee?.name || attendee?.email);
      }) : [],
      reminder: calendarText(metadata.reminder), travelTime: calendarText(metadata.travel_time),
      color: event.backgroundColor || event.borderColor, x: jsEvent.clientX, y: jsEvent.clientY,
    });
  }, [openHover]);

  const handleEventMouseLeave = useCallback((): void => {
    scheduleClose();
    setHoveredEvent(null);
  }, [scheduleClose]);

  const handleEventClick = useCallback((info: EventClickArg): void => {
    lastEventClickTimeRef.current = Date.now();
    const { id, readonly } = calendarEventDetails(info.event);
    const native = info.jsEvent;
    if (id && (native.metaKey || native.ctrlKey || native.shiftKey || selectedIds.size > 0)) {
      native.preventDefault();
      toggleSelect(id, native);
    } else if (readonly) {
      toast.error(t('calendar.external_readonly_error', 'External event (read-only).'));
    } else if (id) {
      if (onEventEdit) onEventEdit(id);
      else onNoteSelect?.(id);
    }
  }, [selectedIds, toggleSelect, t, onEventEdit, onNoteSelect]);

  const handleChange = useCallback((change: CalendarChange, mode: 'move' | 'resize'): void => {
    void persistCalendarChange(change, mode, { onEventEdit, onRefresh, dateField, endDateField }, t);
  }, [onEventEdit, onRefresh, dateField, endDateField, t]);

  const handleEventDidMount = useCallback((info: EventMountArg): void => {
    info.el.oncontextmenu = (event) => {
      event.preventDefault();
      event.stopPropagation();
      const id = info.event.id || calendarEventDetails(info.event).id;
      if (id) onContextMenu?.({
        x: event.clientX, y: event.clientY, date: info.event.startStr.split('T')[0] || '',
        eventId: id, instanceStart: info.event.startStr, allDay: info.event.allDay,
      });
    };
  }, [onContextMenu]);

  const handleContextMenu = useCallback((event: MouseEvent<HTMLDivElement>): void => {
    event.preventDefault();
    const day = eventTargetClosest(event.target, '.fc-daygrid-day, .fc-timegrid-slot');
    onContextMenu?.({ x: event.clientX, y: event.clientY, date: day?.getAttribute('data-date') || '', eventId: null });
  }, [onContextMenu]);

  const handleDateClick = useCallback((info: DateClickArg): void => {
    if (Date.now() - lastEventClickTimeRef.current < 300) return;
    if (eventTargetClosest(info.jsEvent.target, '.fc-event, .fc-event-harness, .fc-daygrid-event-harness, .fc-timegrid-event-harness')) return;
    onDateClick?.(info.date);
  }, [onDateClick]);

  const handleDatesSet = useCallback((info: DatesSetArg): void => {
    onTitleChange?.(info.view.title);
    onDatesSet?.({ start: info.startStr, end: info.endStr });
    if (!showHeaderToolbar) return;
    const next = { title: info.view.title, view: info.view.type };
    if (toolbarRef.current.title === next.title && toolbarRef.current.view === next.view) return;
    toolbarRef.current = next;
    if (toolbarTimerRef.current !== null) clearTimeout(toolbarTimerRef.current);
    toolbarTimerRef.current = setTimeout(() => { setToolbar(next); }, 0);
  }, [onTitleChange, onDatesSet, showHeaderToolbar]);

  const eventClassNames = useCallback((info: EventContentArg): string => {
    const { allDay, past } = calendarEventAppearance(info.event);
    return `cursor-pointer transition-all duration-300 hover:brightness-110 ${allDay ? 'all-day-event-minimal' : 'timed-event-minimal'} ${past ? 'gnosi-event-past' : 'gnosi-event-future font-bold shadow-md'}${isSelected(info.event.id) ? ' ring-2 ring-[var(--gnosi-primary)] z-20' : ''}`;
  }, [isSelected]);

  const applyTemplate = onApplyTemplate ? (id: string): void => {
    onApplyTemplate(new Set(selectedIds), id);
    clearSelection();
  } : null;

  return {
    calendarRef,
    controller: {
      allEventIds, applyTemplate, clearSelection, eventClassNames, events,
      handleBulkDelete, handleChange, handleContextMenu, handleDateClick, handleDatesSet,
      handleEventClick, handleEventDidMount, handleEventMouseEnter, handleEventMouseLeave,
      hoveredEvent, initialView, language: i18n.language || 'en', preview, props,
      selectAll, selectedIds, showHeaderToolbar, t, toolbar,
    },
  };
}

export type DigitalBrainCalendarController = ReturnType<typeof useDigitalBrainCalendar>['controller'];
