import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Clock, MapPin, AlignLeft, Users, Bell, Navigation, ChevronLeft, ChevronRight } from 'lucide-react';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import rrulePlugin from '@fullcalendar/rrule';
import multiMonthPlugin from '@fullcalendar/multimonth';
import caLocale from '@fullcalendar/core/locales/ca';
import esLocale from '@fullcalendar/core/locales/es';
import axios from 'axios';
import { toast } from '../../lib/toast';
import { useTranslation } from 'react-i18next';
import { useVaultSelection } from '../../hooks/useVaultSelection';
import { VaultBulkActionsBar } from './VaultBulkActionsBar';
import { useVaultSelectionShortcuts } from '../../hooks/useVaultSelectionShortcuts';
import './CalendarStyles.css';
import { useTitlePreview } from './useTitlePreview';
import { parsePeriod, withPeriodBoundaries } from '../../utils/projectPlanning';
import {
    exclusiveToInclusiveAllDayEnd,
    inclusiveToExclusiveAllDayEnd,
} from '../../utils/calendarUtils';

// Serializes a Date to "YYYY-MM-DDTHH:MM:SS" in LOCAL time (not UTC). When moving or
// when resizing a timed Vault event we must save the local time: `toISOString()`
// would convert it to UTC and, since the calendar reads the string again without a zone
// as local, the time would shift by the offset (e.g., −2h in Madrid during summer)
// every time the event is moved. (The Google branch already uses the local `startStr`.)
const _p2 = (n) => String(n).padStart(2, '0');
const toLocalDateTimeStr = (d) =>
    `${d.getFullYear()}-${_p2(d.getMonth() + 1)}-${_p2(d.getDate())}T${_p2(d.getHours())}:${_p2(d.getMinutes())}:${_p2(d.getSeconds())}`;

// Views selectable from the DB view's toolbar. Navigation is done
// with its OWN toolbar (like CalendarPage's, via calendarApi): activating the
// native FullCalendar `headerToolbar` with our custom eventContent
// caused an infinite re-render loop (CustomRenderingStore → setState) when
// navigate ("Maximum update depth exceeded") and the view would fall into the boundary.
const DB_VIEW_SWITCHER = [
    { id: 'multiMonthYear', labelKey: 'calendar.view_year', fallback: 'Any' },
    { id: 'dayGridMonth', labelKey: 'calendar.view_month', fallback: 'Mes' },
    { id: 'timeGridWeek', labelKey: 'calendar.view_week', fallback: 'Setmana' },
    { id: 'timeGridDay', labelKey: 'calendar.view_day', fallback: 'Dia' },
];

// STABLE defaults for the collection props. An inline default (`= new Set()`,
// `= []`) creates a NEW identity on every render; since they're deps of the effect
// that builds the events (setEvents), any re-render of the component
// without these props (the DB view doesn't pass them) would chain
// render→effect→setState→render until "Maximum update depth exceeded".
const EMPTY_SET = new Set();
const EMPTY_ARRAY = [];

// Folds accents for accent-insensitive search ("reunio" finds "Reunió"),
// as expected in a Catalan/Spanish vault (NFD + removal of the combining
// marks U+0300–U+036F: accents, cedilla, tilde).
const foldAccents = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export const DigitalBrainCalendar = ({
    allNotes,
    searchQuery = '',
    selectedCalendars = EMPTY_SET,
    onNoteSelect,
    onEventEdit,
    onContextMenu,
    calendarRef,
    onTitleChange,
    onDatesSet,
    onRefresh,
    calendarConfigs = EMPTY_ARRAY,
    colorMap = {},
    onDateClick,
    onSelection,
    onDeleteSelected,
    onDeletePage,
    onApplyTemplate,
    templates = [],
    // Vault DB view: date field to use as start (and optional end), and
    // bypass the filter by source — the table view has no selector for
    // calendars, so without this the calendar would come out empty.
    dateField = '',
    endDateField = '',
    ignoreCalendarFilter = false,
    // Initial FullCalendar view (configurable from the DB view). Values
    // supported by the loaded plugins: dayGridMonth | timeGridWeek |
    // timeGridDay | multiMonthYear.
    initialView = 'dayGridMonth',
    // The calendar page has its own external toolbar (via calendarRef)
    // and leaves it as false; the DB view has none and needs the
    // native to FullCalendar, to be able to navigate (prev/next/today and view switching).
    showHeaderToolbar = false,
}) => {
    const { i18n, t } = useTranslation();
    const [events, setEvents] = useState([]);
    // Own toolbar (DB view): internal ref if the caller doesn't pass one,
    // live month/week title, and active view to mark the button.
    const internalCalRef = useRef(null);
    const calRef = calendarRef || internalCalRef;
    const [tbTitle, setTbTitle] = useState('');
    const [tbView, setTbView] = useState(initialView);
    // Last title/view notified by datesSet. CRITICAL: datesSet re-fires
    // on every re-render (the inline closures of eventContent/eventClassNames
    // change identity and FullCalendar reprocesses the options); a setState
    // unconditional here chains nested updates up to "Maximum update depth".
    // We only update if the value REALLY changes, and outside the commit (setTimeout).
    const tbStateRef = useRef({ title: '', view: initialView });
    const [hoveredEvent, setHoveredEvent] = useState(null);
    const [theme, setTheme] = useState(localStorage.getItem('db-theme') || 'light');
    const { selectedIds, isSelected, toggleSelect, selectAll, clearSelection } = useVaultSelection(events);
    const lastEventClickTimeRef = useRef(0);
    // Content preview on hovering over an event that is
    // a Vault page (external appointments keep the classic tooltip).
    // Stable ref for the FullCalendar handlers (defined with deps []).
    const titlePreview = useTitlePreview({ onOpenPage: onNoteSelect });
    const titlePreviewRef = useRef(null);
    titlePreviewRef.current = titlePreview;

    const allEventIds = useMemo(
        () => [...new Set(events.map((event) => event.id))],
        [events]
    );

    const handleBulkDelete = useCallback(() => {
        if (selectedIds.size === 0) return;
        if (onDeleteSelected) {
            onDeleteSelected(new Set(selectedIds));
            clearSelection();
            return;
        }
        if (onDeletePage) {
            selectedIds.forEach((id) => {
                const note = allNotes.find((n) => n.id === id);
                if (note) onDeletePage(id, note.title);
            });
            clearSelection();
        }
    }, [selectedIds, onDeleteSelected, onDeletePage, allNotes, clearSelection]);

    useEffect(() => {
        const handleTheme = () => setTheme(localStorage.getItem('db-theme') || 'light');
        window.addEventListener('db-theme-changed', handleTheme);
        return () => window.removeEventListener('db-theme-changed', handleTheme);
    }, []);

    useEffect(() => {
        const calendarEvents = [];

        // The colorMap already comes to us as a prop, in consolidated form.
        // We just want to make sure notes have access to the correct color.

        allNotes.forEach(note => {
            const { metadata, id, title } = note;
            if (!metadata) return;

            // Determine the source of the event (table or external calendar)
            let eventSource = (metadata.table_name || metadata.database_table_name || metadata.source || 'Gnosi').trim();
            if (eventSource === 'Gnosi Vault') eventSource = 'Gnosi';

            // Try to find the original source if we have an ID (more reliable than the name)
            const tid = note.resolved_table_id || metadata.table_id || metadata.database_table_id;
            if (tid) {
                const cfg = calendarConfigs.find(c => c.id === tid);
                if (cfg) eventSource = cfg.source;
            }

            if (!ignoreCalendarFilter && !selectedCalendars.has(eventSource)) return;

            const noteTitle = title || metadata.title || t('common.untitled', "Untitled");

            if (searchQuery && !foldAccents(noteTitle).includes(foldAccents(searchQuery))) {
                return;
            }

            // With `dateField` configured on the view, ONLY this field governs: a
            // a note with no value disappears from it (like Notion), instead of falling back to
            // silently onto date/due_date and end up placed by a field that the
            // view did not request.
            let dateStr = dateField
                ? ((metadata[dateField] != null && metadata[dateField] !== '') ? metadata[dateField] : null)
                : (metadata.date || metadata.data || metadata.start_time || metadata.due_date);
            let periodEnd = null;
            const isPeriodValue = (
                dateStr
                && typeof dateStr === 'object'
            ) || String(dateStr || '').includes('/');
            if (isPeriodValue) {
                const period = parsePeriod(dateStr);
                dateStr = period.start || null;
                periodEnd = period.end || null;
            }

            if (dateStr) {

                // Defensive String(): a manual YAML frontmatter can give a
                // number (e.g. `Data: 2026`) and `.includes` would crash on it.
                const isAllDay = !String(dateStr).includes('T') || metadata.all_day;

                // We look up the color in the consolidated colorMap
                const configColor = colorMap[eventSource];
                const defaultColor = (eventSource === 'Gnosi' ? 'var(--gnosi-primary)' : 'var(--text-tertiary)');
                const eventColor = configColor || metadata.color || defaultColor;

                // With `endDateField` configured, only this field (with the
                // period's end as the only internal fallback); when not configured,
                // string read. All-day ends go from INCLUSIVE
                // (Vault) to EXCLUSIVE (FullCalendar).
                let endStr = endDateField
                    ? ((metadata[endDateField] != null && metadata[endDateField] !== '') ? metadata[endDateField] : (periodEnd || null))
                    : (periodEnd || metadata.end_date || metadata.end_time || null);
                if (endStr && isAllDay && !metadata._end_exclusive) {
                    endStr = inclusiveToExclusiveAllDayEnd(endStr);
                }
                let eventObj = {
                    id: id,
                    title: noteTitle,
                    start: dateStr,
                    end: endStr,
                    allDay: isAllDay,
                    color: eventColor,
                    textColor: isAllDay ? '#ffffff' : eventColor,
                    extendedProps: {
                        readonly: metadata.readonly || false,
                        id: id,
                        metadata: metadata,
                    }
                };

                if (metadata.rrule) {
                    const rruleStr = metadata.rrule;
                    const rruleObj = {
                        dtstart: dateStr
                    };
                    let exdates = [];

                    // Parse parts: FREQ=WEEKLY;BYDAY=MO,TU;COUNT=10
                    rruleStr.split(';').forEach(part => {
                        const [key, value] = part.split('=');
                        if (key === 'FREQ') rruleObj.freq = value.toLowerCase();
                        if (key === 'COUNT') rruleObj.count = parseInt(value);
                        if (key === 'UNTIL') rruleObj.until = value; // Format already correct: YYYYMMDDTHHMMSSZ
                        if (key === 'INTERVAL') rruleObj.interval = parseInt(value);
                        if (key === 'BYDAY') {
                            // FullCalendar expects 'byweekday' as an array or 'byday' inside the object
                            rruleObj.byweekday = value.split(',');
                        }
                        if (key === 'EXDATE') {
                            exdates = value.split(',').filter(Boolean);
                        }
                    });

                    if (rruleObj.freq) {
                        eventObj.rrule = rruleObj;
                        const metadataExdates = Array.isArray(metadata.exdates)
                            ? metadata.exdates
                            : (typeof metadata.exdates === 'string' ? metadata.exdates.split(',').filter(Boolean) : []);
                        const allExdates = [...metadataExdates, ...exdates];
                        if (allExdates.length > 0) {
                            eventObj.exdate = allExdates;
                        }
                        eventObj.allDay = isAllDay;
                    } else {
                        eventObj.start = dateStr;
                        eventObj.end = endStr;
                        eventObj.allDay = isAllDay;
                    }
                } else {
                    eventObj.start = dateStr;
                    // We use `endStr` (which already includes the period's end and the
                    // endDateField field), not just metadata.end_date/end_time: without
                    // this, a NON-recurring event with a `period` field or an
                    // the configured `endDateField` was losing the end and rendering
                    // as a single day.
                    eventObj.end = endStr;
                    eventObj.allDay = isAllDay;
                }

                calendarEvents.push(eventObj);
            }
        });

        setEvents(calendarEvents);
        // dateField/endDateField/ignoreCalendarFilter DO go into deps: in the view of
        // DB in calendar mode, changing the view's «date field» must reposition
        // the events (before they stayed with the old field until another dep changed).
        // colorMap is OMITTED on purpose: VaultViewBody does not pass it and it takes the default `{}` (new
        // reference on every render) → including it would cause an infinite effect→render→effect loop.
    }, [allNotes, searchQuery, selectedCalendars, calendarConfigs, theme, dateField, endDateField, ignoreCalendarFilter, t]);

    const handleEventMouseEnter = useCallback((info) => {
        const { event, jsEvent } = info;
        const { metadata, id, readonly } = event.extendedProps;

        // Vault pages (with id, and editable): content card with scroll,
        // as in the rest of the views. External appointments (Google, readonly) or
        // without a page keep the classic informational tooltip.
        if (id && !readonly) {
            titlePreviewRef.current?.openHover(id, info.el.getBoundingClientRect());
            return;
        }

        setHoveredEvent({
            title: event.title,
            start: event.start,
            end: event.end,
            allDay: event.allDay,
            location: metadata?.location,
            description: metadata?.description,
            attendees: metadata?.attendees,
            reminder: metadata?.reminder,
            travelTime: metadata?.travel_time,
            color: event.backgroundColor || event.borderColor,
            x: jsEvent.clientX,
            y: jsEvent.clientY
        });
    }, []);

    const handleEventMouseLeave = useCallback(() => {
        titlePreviewRef.current?.scheduleClose();
        setHoveredEvent(null);
    }, []);

    // Click on an event → open the edit modal
    const handleEventClick = useCallback((clickInfo) => {
        lastEventClickTimeRef.current = Date.now();

        const { id, readonly } = clickInfo.event.extendedProps;
        const nativeEvent = clickInfo.jsEvent;
        const isSelectionIntent = !!(nativeEvent?.metaKey || nativeEvent?.ctrlKey || nativeEvent?.shiftKey);

        if (id && (isSelectionIntent || selectedIds.size > 0)) {
            nativeEvent?.preventDefault();
            toggleSelect(id, nativeEvent);
            return;
        }

        if (readonly) {
            toast.error(t('calendar.external_readonly_error', "External event (read-only)."));
            return;
        }
        if (id && onEventEdit) {
            onEventEdit(id);
        } else if (id && onNoteSelect) {
            onNoteSelect(id);
        }
    }, [onEventEdit, onNoteSelect, selectedIds, toggleSelect, t]);

    useVaultSelectionShortcuts({
        selectedCount: selectedIds.size,
        onClearSelection: clearSelection,
        onDeleteSelection: handleBulkDelete,
    });

    // Drag event (change date)
    const handleEventDrop = useCallback(async (dropInfo) => {
        const { event } = dropInfo;
        const { id, readonly, metadata } = event.extendedProps;

        if (readonly) {
            dropInfo.revert();
            toast.error(t('calendar.external_move_error', "You can't move an external event (Read-Only)."));
            return;
        }

        const newStart = event.allDay
            ? event.startStr
            : toLocalDateTimeStr(event.start);
        // All-day end: FullCalendar gives it as EXCLUSIVE; the Vault stores it as INCLUSIVE.
        const newEnd = event.end
            ? (event.allDay ? exclusiveToInclusiveAllDayEnd(event.endStr) : toLocalDateTimeStr(event.end))
            : null;

        const isRecurrent = !!(metadata?.rrule || metadata?.recurrence);

        // If it's recurring, we delegate to the parent to ask
        if (isRecurrent && onEventEdit) {
            dropInfo.revert(); // We revert visually until it's confirmed
            onEventEdit(id, {
                date: newStart,
                end_date: newEnd,
                instanceStart: dropInfo.oldEvent.startStr
            }, 'move');
            return;
        }
        // Recurring WITHOUT a handler (DB view): writing the base date would move
        // the WHOLE series without asking. We revert and warn.
        if (isRecurrent) {
            dropInfo.revert();
            toast.error(t('calendar.recurrent_edit_elsewhere', "Recurring events are edited from the main calendar."));
            return;
        }

        // Google appointment: update in Google (not in the Vault). We use startStr/endStr (time
        // local) so the backend can set the correct zone on it; toISOString() would be UTC.
        const isGoogle = (metadata?._provider === 'google' || !!metadata?._account) && !metadata?._vault_path;
        try {
            if (isGoogle) {
                const gStart = event.startStr;
                const gEnd = event.endStr || gStart;
                await axios.patch(
                    `/api/calendar/events/${encodeURIComponent(id)}?email=${encodeURIComponent(metadata._account)}&calendar_id=${encodeURIComponent(metadata._calendar_id || 'primary')}`,
                    { start: gStart, end: gEnd, calendar_id: metadata._calendar_id || 'primary' }
                );
            } else {
                // Write to the VIEW fields (dateField/endDateField), not to the
                // fixed date/end_date: with a configured field, writing `date`
                // created a ghost field outside the schema and the event would go back to the day
                // old one when refreshing. A `period` value ("start/end" in a single
                // field) gets fully re-serialized.
                const startKey = dateField || 'date';
                const endKey = endDateField || 'end_date';
                const currentStartValue = metadata?.[startKey];
                const isPeriodValue = (
                    currentStartValue
                    && typeof currentStartValue === 'object'
                ) || String(currentStartValue || '').includes('/');
                const patchData = { metadata: {} };
                if (isPeriodValue) {
                    patchData.metadata[startKey] = withPeriodBoundaries(
                        currentStartValue,
                        newStart,
                        newEnd || newStart,
                        { startMode: 'manual', endMode: 'manual' },
                    );
                } else {
                    patchData.metadata[startKey] = newStart;
                    if (newEnd) patchData.metadata[endKey] = newEnd;
                }
                await axios.patch(`/api/vault/pages/${id}`, patchData);
            }
            toast.success(t('calendar.date_updated', "Date updated!"));
            onRefresh?.();
        } catch (error) {
            console.error('Error moving event:', error);
            dropInfo.revert();
            toast.error(t('calendar.move_event_error', "Error moving the event."));
        }
    }, [onRefresh, onEventEdit, dateField, endDateField, t]);

    // Resize event (change end date)
    const handleEventResize = useCallback(async (resizeInfo) => {
        const { event } = resizeInfo;
        const { id, readonly, metadata } = event.extendedProps;

        if (readonly) {
            resizeInfo.revert();
            toast.error(t('calendar.external_resize_error', "You can't resize an external event."));
            return;
        }

        // All-day end: FullCalendar gives it as EXCLUSIVE; the Vault stores it as INCLUSIVE.
        const newEnd = event.allDay
            ? exclusiveToInclusiveAllDayEnd(event.endStr)
            : toLocalDateTimeStr(event.end);

        const isRecurrent = !!(metadata?.rrule || metadata?.recurrence);

        // If it's recurring, we delegate to the parent to ask
        if (isRecurrent && onEventEdit) {
            resizeInfo.revert();
            onEventEdit(id, {
                end_date: newEnd,
                instanceStart: event.startStr
            }, 'resize');
            return;
        }
        // Recurring with no handler (DB view): we revert so as not to touch the series.
        if (isRecurrent) {
            resizeInfo.revert();
            toast.error(t('calendar.recurrent_edit_elsewhere', "Recurring events are edited from the main calendar."));
            return;
        }

        const isGoogle = (metadata?._provider === 'google' || !!metadata?._account) && !metadata?._vault_path;
        try {
            if (isGoogle) {
                await axios.patch(
                    `/api/calendar/events/${encodeURIComponent(id)}?email=${encodeURIComponent(metadata._account)}&calendar_id=${encodeURIComponent(metadata._calendar_id || 'primary')}`,
                    { start: event.startStr, end: event.endStr || event.startStr, calendar_id: metadata._calendar_id || 'primary' }
                );
            } else {
                // Write to THE VIEW'S field; a `period` value gets re-serialized
                // in full into the start field (see handleEventDrop).
                const startKey = dateField || 'date';
                const endKey = endDateField || 'end_date';
                const currentStartValue = metadata?.[startKey];
                const isPeriodValue = (
                    currentStartValue
                    && typeof currentStartValue === 'object'
                ) || String(currentStartValue || '').includes('/');
                const patchData = { metadata: {} };
                if (isPeriodValue) {
                    const currentPeriod = parsePeriod(currentStartValue);
                    patchData.metadata[startKey] = withPeriodBoundaries(
                        currentStartValue,
                        currentPeriod.start,
                        newEnd || currentPeriod.start,
                        { endMode: 'manual' },
                    );
                } else {
                    patchData.metadata[endKey] = newEnd;
                }
                await axios.patch(`/api/vault/pages/${id}`, patchData);
            }
            toast.success(t('calendar.duration_updated', "Duration updated!"));
            onRefresh?.();
        } catch (error) {
            console.error('Error resizing event:', error);
            resizeInfo.revert();
            toast.error(t('calendar.resize_event_error', "Error resizing the event."));
        }
    }, [onRefresh, onEventEdit, dateField, endDateField, t]);

    // Add context menu to each event
    const handleEventDidMount = useCallback((info) => {
        const { el, event } = info;
        el.oncontextmenu = (e) => {
            e.preventDefault();
            e.stopPropagation();
            const eventId = event.id || event.extendedProps?.id;
            if (eventId && onContextMenu) {
                onContextMenu({ 
                    x: e.clientX, 
                    y: e.clientY, 
                    date: event.startStr?.split('T')[0] || '', 
                    eventId,
                    instanceStart: event.startStr || '',
                    allDay: !!event.allDay,
                });
            }
        };
    }, [onContextMenu]);

    return (
        <div
            className="h-full bg-[var(--bg-primary)] flex flex-col overflow-hidden"
            onContextMenu={(e) => {
                // We capture right-click on the calendar (empty spaces)
                e.preventDefault();
                
                // We check whether there's a date cell under the cursor
                const dayEl = e.target.closest('.fc-daygrid-day, .fc-timegrid-slot');
                let dateStr = '';
                if (dayEl) {
                    dateStr = dayEl.getAttribute('data-date') || '';
                }
                
                // We only call it if it's not over an event (events have their own handler)
                onContextMenu?.({ x: e.clientX, y: e.clientY, date: dateStr, eventId: null });
            }}
        >
            {selectedIds.size > 0 && (
                <VaultBulkActionsBar
                    selectedIds={selectedIds}
                    totalCount={allEventIds.length}
                    onSelectAll={() => selectAll(allEventIds)}
                    onClearSelection={clearSelection}
                    onDeleteSelected={(onDeleteSelected || onDeletePage) ? handleBulkDelete : null}
                    templates={templates}
                    onApplyTemplate={onApplyTemplate ? (templateId) => { onApplyTemplate(new Set(selectedIds), templateId); clearSelection(); } : null}
                />
            )}

            {showHeaderToolbar && (
                <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-[var(--border-primary)] bg-[var(--bg-primary)]">
                    <div className="flex items-center gap-1">
                        <button
                            type="button"
                            onClick={() => calRef.current?.getApi()?.prev()}
                            className="p-1.5 rounded-md border border-[var(--border-primary)] text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] transition-colors"
                            title={t('calendar.prev', "Previous")}
                        >
                            <ChevronLeft size={14} />
                        </button>
                        <button
                            type="button"
                            onClick={() => calRef.current?.getApi()?.next()}
                            className="p-1.5 rounded-md border border-[var(--border-primary)] text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] transition-colors"
                            title={t('calendar.next', "Next")}
                        >
                            <ChevronRight size={14} />
                        </button>
                        <button
                            type="button"
                            onClick={() => calRef.current?.getApi()?.today()}
                            className="ml-1 px-2.5 py-1 rounded-md border border-[var(--border-primary)] text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] transition-colors"
                        >
                            {t('calendar.today', "Today")}
                        </button>
                    </div>
                    <div className="text-sm font-semibold text-[var(--text-primary)] truncate">{tbTitle}</div>
                    <div className="flex bg-[var(--bg-tertiary)] p-0.5 rounded-lg border border-[var(--border-primary)]">
                        {DB_VIEW_SWITCHER.map(v => (
                            <button
                                key={v.id}
                                type="button"
                                onClick={() => calRef.current?.getApi()?.changeView(v.id)}
                                className={`px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded transition-all ${tbView === v.id
                                    ? 'bg-[var(--bg-primary)] text-[var(--gnosi-primary)] shadow-sm'
                                    : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]'}`}
                            >
                                {t(v.labelKey, v.fallback)}
                            </button>
                        ))}
                    </div>
                </div>
            )}
            <div className={`calendar-container flex-1 ${showHeaderToolbar ? 'min-h-[34rem]' : ''}`}>
                <FullCalendar
                    ref={calRef}
                    plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin, rrulePlugin, multiMonthPlugin]}
                    initialView={initialView}
                    eventDisplay="block"
                    fixedWeekCount={false}
                    multiMonthMaxColumns={4}
                    views={{
                        multiMonthYear: {
                            multiMonthMinWidth: 150,
                            multiMonthMaxColumns: 4,
                            fixedWeekCount: false,
                            showNonCurrentDates: false,
                            eventDisplay: 'none',
                        }
                    }}
                    headerToolbar={false}
                    dayMaxEvents={4}
                    moreLinkContent={(arg) => `+ ${arg.shortText} ${t('calendar.more_suffix', "more")}`}
                    locales={[caLocale, esLocale]}
                    locale={i18n.language || 'en'}
                    events={events}
                    editable={true}
                    droppable={true}
                    selectable={true}
                    eventResizableFromStart={false}
                    eventClick={handleEventClick}
                    eventMouseEnter={handleEventMouseEnter}
                    eventMouseLeave={handleEventMouseLeave}
                    eventDrop={handleEventDrop}
                    eventResize={handleEventResize}
                    eventDidMount={handleEventDidMount}
                    height={showHeaderToolbar ? 'auto' : '100%'}
                    eventTimeFormat={{
                        hour: '2-digit',
                        minute: '2-digit',
                        meridiem: false,
                        hour12: false
                    }}
                    slotLabelFormat={{
                        hour: '2-digit',
                        minute: '2-digit',
                        meridiem: false,
                        hour12: false
                    }}
                    eventClassNames={(arg) => {
                        const isAllDay = arg.event.allDay || arg.event.extendedProps.metadata?.all_day || !arg.event.startStr.includes('T');
                        let classes = `cursor-pointer transition-all duration-300 hover:brightness-110 ${!isAllDay ? 'timed-event-minimal' : 'all-day-event-minimal'}`;
                        
                        // Detect past events
                        const now = new Date();
                        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
                        const eventDate = arg.event.start || new Date(arg.event.startStr);
                        const eventDateStart = new Date(eventDate.getFullYear(), eventDate.getMonth(), eventDate.getDate()).getTime();
                        
                        const isPast = isAllDay
                            ? eventDateStart < todayStart
                            : (arg.event.end || eventDate).getTime() < now.getTime();

                        if (isPast) {
                            classes += ' gnosi-event-past';
                        } else {
                            classes += ' gnosi-event-future font-bold shadow-md';
                        }

                        if (isSelected(arg.event.id)) {
                            classes += ' ring-2 ring-[var(--gnosi-primary)] z-20';
                        }
                        return classes;
                    }}
                    eventContent={(arg) => {
                        const isAllDay = arg.event.allDay || arg.event.extendedProps.metadata?.all_day || !arg.event.startStr.includes('T');
                        
                        const now = new Date();
                        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
                        const eventDate = arg.event.start || new Date(arg.event.startStr);
                        const eventDateStart = new Date(eventDate.getFullYear(), eventDate.getMonth(), eventDate.getDate()).getTime();
                        
                        const isPast = isAllDay
                            ? eventDateStart < todayStart
                            : (arg.event.end || eventDate).getTime() < now.getTime();

                        const color = arg.event.backgroundColor || arg.event.borderColor;

                        return (
                            <div className="fc-event-main-frame flex items-center px-1.5 overflow-hidden h-full rounded border-l-[4px] border-l-current shadow-sm"
                                style={{
                                    backgroundColor: 'var(--bg-secondary)',
                                    color: 'var(--text-primary)',
                                    borderLeftColor: color || 'var(--gnosi-action-bg)',
                                    minHeight: '1.4rem',
                                    fontWeight: isPast ? '600' : '800'
                                }}>
                                {!isAllDay && (
                                    <div className="fc-event-time flex-shrink-0 text-[0.65rem] font-black mr-1.5 text-[var(--text-secondary)]">
                                        {arg.timeText}
                                    </div>
                                )}
                                <div className="fc-event-title flex-grow truncate text-[0.725rem] py-0.5 tracking-tight">
                                    {arg.event.title}
                                </div>
                            </div>
                        );
                    }}
                    dateClick={(arg) => {
                        if (!onDateClick) return;
                        // Avoid creating an appointment if an event was just clicked (< 300ms)
                        if (Date.now() - lastEventClickTimeRef.current < 300) return;
                        // Avoid creating an appointment when the target is inside an event element
                        const target = arg.jsEvent?.target;
                        if (target?.closest('.fc-event, .fc-event-harness, .fc-daygrid-event-harness, .fc-timegrid-event-harness')) return;
                        onDateClick(arg.date);
                    }}
                    select={(arg) => {
                        if (onSelection) {
                            // Convert to a format that's easy to insert:
                            // Start and End as formatted strings or Date objects
                            onSelection({
                                start: arg.start,
                                end: arg.end,
                                allDay: arg.allDay,
                                startStr: arg.startStr,
                                endStr: arg.endStr
                            });
                        }
                    }}
                    datesSet={(arg) => {
                        if (onTitleChange) onTitleChange(arg.view.title);
                        if (onDatesSet) onDatesSet({ start: arg.startStr, end: arg.endStr });
                        if (showHeaderToolbar) {
                            const title = arg.view.title;
                            const type = arg.view.type;
                            if (tbStateRef.current.title !== title || tbStateRef.current.view !== type) {
                                tbStateRef.current = { title, view: type };
                                setTimeout(() => { setTbTitle(title); setTbView(type); }, 0);
                            }
                        }
                    }}
                />
            </div>

            {hoveredEvent && (
                <div 
                    className="fixed z-[var(--z-popover)] pointer-events-none transition-all duration-200 flex flex-col"
                    style={{
                        left: Math.min(hoveredEvent.x + 15, window.innerWidth - 340),
                        top: hoveredEvent.y,
                        width: '320px',
                        transform: hoveredEvent.y > window.innerHeight / 2 ? 'translateY(-105%)' : 'translateY(15px)'
                    }}
                >
                    <div className="bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-2xl shadow-2xl overflow-hidden backdrop-blur-2xl bg-opacity-95 dark:bg-opacity-90 max-h-[70vh] flex flex-col border-opacity-50">
                        <div 
                            className="h-1.5 w-full shrink-0" 
                            style={{ backgroundColor: hoveredEvent.color || 'var(--gnosi-primary)' }}
                        />
                        <div className="p-5 space-y-4 overflow-y-auto custom-scrollbar">
                            <h4 className="font-bold text-[0.9rem] text-[var(--text-primary)] leading-snug">
                                {hoveredEvent.title}
                            </h4>
                            
                            <div className="space-y-3 text-[0.8rem]">
                                <div className="flex items-center text-[var(--text-secondary)]">
                                    <Clock className="w-4 h-4 mr-3 opacity-70 shrink-0" />
                                    <span>
                                        {hoveredEvent.allDay
                                            ? t('calendar.all_day', "All day")
                                            : `${new Date(hoveredEvent.start).toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' })}${hoveredEvent.end ? ' - ' + new Date(hoveredEvent.end).toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' }) : ''}`
                                        }
                                    </span>
                                </div>
                                
                                {hoveredEvent.location && (
                                    <div className="flex items-start text-[var(--text-secondary)]">
                                        <MapPin className="w-4 h-4 mr-3 opacity-70 shrink-0 mt-0.5" />
                                        <span className="leading-relaxed break-words">{hoveredEvent.location}</span>
                                    </div>
                                )}

                                {hoveredEvent.travelTime ? (
                                    <div className="flex items-center text-[var(--text-secondary)]">
                                        <Navigation className="w-4 h-4 mr-3 opacity-70 shrink-0" />
                                        <span>{t('calendar.travel_time', "Travel time")}: {hoveredEvent.travelTime} min</span>
                                    </div>
                                ) : null}

                                {hoveredEvent.reminder ? (
                                    <div className="flex items-center text-[var(--text-secondary)]">
                                        <Bell className="w-4 h-4 mr-3 opacity-70 shrink-0" />
                                        <span>{(() => { const n = parseInt(hoveredEvent.reminder); const v = n % 1440 === 0 ? `${n / 1440} d` : n % 60 === 0 ? `${n / 60} h` : `${n} min`; return t('calendar.reminder_before', "Reminder {{value}} before", { value: v }); })()}</span>
                                    </div>
                                ) : null}

                                {Array.isArray(hoveredEvent.attendees) && hoveredEvent.attendees.length > 0 && (
                                    <div className="flex items-start text-[var(--text-secondary)]">
                                        <Users className="w-4 h-4 mr-3 opacity-70 shrink-0 mt-0.5" />
                                        <span className="leading-relaxed break-words">
                                            {hoveredEvent.attendees.slice(0, 5).map(a => a.name || a.email).join(', ')}
                                            {hoveredEvent.attendees.length > 5 ? ` +${hoveredEvent.attendees.length - 5}` : ''}
                                        </span>
                                    </div>
                                )}

                                {hoveredEvent.description && (
                                    <div className="flex items-start text-[var(--text-tertiary)] pt-3 border-t border-[var(--border-primary)] border-opacity-30 mt-2">
                                        <AlignLeft className="w-4 h-4 mr-3 mt-1 opacity-70 shrink-0" />
                                        <div className="leading-relaxed italic whitespace-pre-wrap break-words opacity-90">
                                            {hoveredEvent.description}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}
                <style>{`
                .custom-scrollbar::-webkit-scrollbar {
                    width: 4px;
                }
                .custom-scrollbar::-webkit-scrollbar-track {
                    background: transparent;
                }
                .custom-scrollbar::-webkit-scrollbar-thumb {
                    background: var(--border-primary);
                    border-radius: 10px;
                }
                .custom-scrollbar::-webkit-scrollbar-thumb:hover {
                    background: var(--text-tertiary);
                }
                .fc {
                    color: var(--text-primary);
                    background-color: var(--bg-primary);
                }
                .dark .fc {
                    background-color: #000000 !important;
                }
                .dark .fc-scrollgrid, 
                .dark .fc-col-header-cell, 
                .dark .fc-daygrid-day,
                .dark .fc-timegrid-slot,
                .dark .fc-timegrid-axis {
                    background-color: #000000 !important;
                }
                .fc-theme-standard .fc-scrollgrid {
                    border-color: var(--border-primary) !important;
                }
                .fc .fc-toolbar-title {
                    font-size: 1.25rem;
                    font-weight: 600;
                    color: var(--text-primary);
                }
                .fc .fc-col-header-cell-cushion,
                .fc .fc-daygrid-day-number {
                    color: var(--text-primary);
                    text-decoration: none;
                }
                /* Force styles for timed appointments */
                .timed-event-colored {
                    background-color: transparent !important;
                    border-color: transparent !important;
                    box-shadow: none !important;
                }
                .timed-event-colored:hover {
                    background-color: var(--bg-secondary) !important;
                }
                /* Days that fit to available space */
                .fc-daygrid-day-frame {
                    height: 100% !important;
                    display: flex !important;
                    flex-direction: column !important;
                }
                .fc-daygrid-day-events {
                    flex-grow: 1;
                }
                /* Style for the "+ more" button */
                .fc-daygrid-more-link {
                    font-size: 0.75rem !important;
                    font-weight: 600 !important;
                    color: var(--gnosi-primary) !important;
                    padding: 2px 4px !important;
                    border-radius: 4px !important;
                    transition: background 0.2s !important;
                    display: block !important;
                    text-align: center !important;
                    margin-top: 2px !important;
                }
                .fc-daygrid-more-link:hover {
                    background-color: var(--bg-secondary) !important;
                    text-decoration: none !important;
                }
                /* All-day events (blocks) */
                .fc-daygrid-block-event {
                    background: transparent !important;
                    border: none !important;
                    padding: 0 !important;
                    margin: 1px 4px !important;
                }
                .fc-v-event {
                    background-color: transparent !important;
                    border: none !important;
                }
                .fc-daygrid-dot-event .fc-event-title {
                    font-weight: 500;
                }
                .fc .fc-button {
                    font-size: 0.85rem !important;
                    padding: 0.4rem 0.6rem !important;
                    border-radius: 6px !important;
                    text-transform: capitalize;
                    margin: 0 2px !important;
                }
                .fc .fc-button-primary {
                    background-color: var(--gnosi-action-bg);
                    border-color: var(--gnosi-action-bg);
                }
                .fc .fc-button-primary:not(:disabled):active, 
                .fc .fc-button-primary:not(:disabled).fc-button-active {
                    background-color: var(--gnosi-action-bg);
                    filter: brightness(0.9);
                    border-color: var(--gnosi-action-bg);
                }
                .fc-theme-standard td, .fc-theme-standard th, .fc-scrollgrid {
                    border-color: var(--border-primary) !important;
                }
                 .fc .fc-day-today {
                    background-color: transparent !important;
                }
                .fc .fc-daygrid-day.fc-day-today .fc-daygrid-day-number {
                    background-color: var(--gnosi-action-bg);
                    color: #ffffff !important;
                    border-radius: 50%;
                    width: 26px;
                    height: 26px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    margin: 4px;
                    font-weight: 800;
                    box-shadow: 0 2px 4px rgba(0,0,0,0.2);
                }
                
                /* Weekend Backgrounds */
                .fc .fc-daygrid-day.fc-day-sat {
                    background-color: rgba(0, 0, 0, 0.05) !important;
                }
                .dark .fc .fc-daygrid-day.fc-day-sat {
                    background-color: rgba(255, 255, 255, 0.06) !important;
                }
                .fc .fc-daygrid-day.fc-day-sun {
                    background-color: rgba(0, 0, 0, 0.1) !important;
                }
                .dark .fc .fc-daygrid-day.fc-day-sun {
                    background-color: rgba(255, 255, 255, 0.12) !important;
                }
                
                .fc-list-day-cushion {
                    background-color: var(--bg-secondary) !important;
                }
                /* Visible resize cursor */
                .fc-event-resizer {
                    cursor: ew-resize;
                }
                .fc-event-resizer-end {
                    cursor: e-resize;
                }

                /* Multi-Month Year View - Compact */
                .fc-multimonth {
                    font-size: 0.65rem !important;
                    overflow-y: auto !important;
                }
                .fc-multimonth .fc-multimonth-month {
                    padding: 0 !important;
                    margin: 0 !important;
                }
                .fc-multimonth .fc-daygrid-body,
                .fc-multimonth .fc-scrollgrid-sync-table {
                    height: auto !important;
                }
                .fc-multimonth .fc-daygrid-day-frame {
                    min-height: 1.2em !important;
                    max-height: 1.4em !important;
                    padding: 0 !important;
                }
                .fc-multimonth .fc-daygrid-day-top {
                    justify-content: center;
                }
                .fc-multimonth .fc-daygrid-day-number {
                    padding: 1px !important;
                    font-size: 0.6rem !important;
                    line-height: 1 !important;
                }
                .fc-multimonth .fc-daygrid-day-events,
                .fc-multimonth .fc-daygrid-day-bg,
                .fc-multimonth .fc-daygrid-event-harness,
                .fc-multimonth .fc-daygrid-day-bottom {
                    display: none !important;
                }
                .fc-multimonth .fc-col-header-cell-cushion {
                    font-size: 0.55rem !important;
                    padding: 1px !important;
                    text-transform: lowercase;
                }
                .fc-multimonth-title {
                    font-size: 0.8rem !important;
                    font-weight: 600 !important;
                    color: var(--gnosi-primary) !important;
                    padding: 4px 6px !important;
                }
                .fc-multimonth-header {
                    border-bottom: 1px solid var(--border-primary) !important;
                }
                .fc-multimonth .fc-scrollgrid {
                    border: none !important;
                }
                .fc-multimonth .fc-scrollgrid-sync-table td,
                .fc-multimonth .fc-scrollgrid-sync-table th {
                    padding: 0 !important;
                }
                .fc-multimonth .fc-col-header-cell {
                    padding: 0 !important;
                }
            `}</style>

            {titlePreview.preview}
        </div>
    );
};
