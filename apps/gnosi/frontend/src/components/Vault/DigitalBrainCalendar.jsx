import React, { useState, useEffect, useCallback, useMemo } from 'react';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import rrulePlugin from '@fullcalendar/rrule';
import caLocale from '@fullcalendar/core/locales/ca';
import esLocale from '@fullcalendar/core/locales/es';
import axios from 'axios';
import { toast } from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { useVaultSelection } from '../../hooks/useVaultSelection';
import { VaultBulkActionsBar } from './VaultBulkActionsBar';
import { useVaultSelectionShortcuts } from '../../hooks/useVaultSelectionShortcuts';

export const DigitalBrainCalendar = ({
    allNotes,
    searchQuery = '',
    selectedCalendars = new Set(),
    selectedEventId,
    onNoteSelect,
    onEventEdit,
    onContextMenu,
    calendarRef,
    onTitleChange,
    onRefresh,
    calendarConfigs = [],
    colorMap = {},
    onDateClick,
    onSelection,
    onDeleteSelected,
    onDeletePage,
}) => {
    const { i18n } = useTranslation();
    const [events, setEvents] = useState([]);
    const [theme, setTheme] = useState(localStorage.getItem('db-theme') || 'light');
    const { selectedIds, isSelected, toggleSelect, selectAll, clearSelection } = useVaultSelection(events);

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

        // El colorMap ja ens ve per prop de forma consolidada.
        // Només volem assegurar que les notes tinguin accés al color correcte.

        allNotes.forEach(note => {
            const { metadata, id, title } = note;
            if (!metadata) return;

            // Determinar la font de l'event (taula o calendari extern)
            let eventSource = (metadata.table_name || metadata.database_table_name || metadata.source || 'Gnosi').trim();
            if (eventSource === 'Gnosi Vault') eventSource = 'Gnosi';

            // Intentar trobar el source original si tenim un ID (més fiable que el nom)
            const tid = note.resolved_table_id || metadata.table_id || metadata.database_table_id;
            if (tid) {
                const cfg = calendarConfigs.find(c => c.id === tid);
                if (cfg) eventSource = cfg.source;
            }

            if (!selectedCalendars.has(eventSource) && eventSource !== 'Gnosi') return;

            const noteTitle = title || metadata.title || 'Sense Títol';

            if (searchQuery && !noteTitle.toLowerCase().includes(searchQuery.toLowerCase())) {
                return;
            }

            const dateStr = metadata.date || metadata.start_time || metadata.due_date;

            if (dateStr) {
                const isExternal = metadata.source !== undefined && metadata.source !== 'Gnosi' && metadata.source !== 'Gnosi Vault';
                const isAllDay = !dateStr.includes('T') || metadata.all_day;

                // Busquem el color al colorMap consolidat
                const configColor = colorMap[eventSource];
                const defaultColor = (eventSource === 'Gnosi' ? 'var(--gnosi-primary)' : 'var(--text-tertiary)');
                const eventColor = configColor || metadata.color || defaultColor;

                const endStr = metadata.end_date || metadata.end_time || null;
                let eventObj = {
                    id: id,
                    title: noteTitle,
                    start: metadata.date || metadata.start_time || metadata.due_date,
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
                        eventObj.end = metadata.end_date || metadata.end_time || null;
                        eventObj.allDay = isAllDay;
                    }
                } else {
                    eventObj.start = dateStr;
                    eventObj.end = metadata.end_date || metadata.end_time || null;
                    eventObj.allDay = isAllDay;
                }

                calendarEvents.push(eventObj);
            }
        });

        setEvents(calendarEvents);
    }, [allNotes, searchQuery, selectedCalendars, calendarConfigs, theme]);

    // Clic sobre un event → obrir modal d'edició
    const handleEventClick = useCallback((clickInfo) => {
        const { id, readonly } = clickInfo.event.extendedProps;
        const nativeEvent = clickInfo.jsEvent;
        const isSelectionIntent = !!(nativeEvent?.metaKey || nativeEvent?.ctrlKey || nativeEvent?.shiftKey);

        if (id && (isSelectionIntent || selectedIds.size > 0)) {
            nativeEvent?.preventDefault();
            toggleSelect(id, nativeEvent);
            return;
        }

        if (readonly) {
            toast.error("Esdeveniment extern (només lectura).");
            return;
        }
        if (id && onEventEdit) {
            onEventEdit(id);
        } else if (id && onNoteSelect) {
            onNoteSelect(id);
        }
    }, [onEventEdit, onNoteSelect, selectedIds, toggleSelect]);

    useVaultSelectionShortcuts({
        selectedCount: selectedIds.size,
        onClearSelection: clearSelection,
        onDeleteSelection: handleBulkDelete,
    });

    // Arrossegar event (canviar data)
    const handleEventDrop = useCallback(async (dropInfo) => {
        const { event } = dropInfo;
        const { id, readonly } = event.extendedProps;

        if (readonly) {
            dropInfo.revert();
            toast.error("No pots moure un esdeveniment extern (Read-Only).");
            return;
        }

        const newStart = event.allDay
            ? event.startStr
            : event.start.toISOString().replace('.000Z', '');
        const newEnd = event.end
            ? (event.allDay ? event.endStr : event.end.toISOString().replace('.000Z', ''))
            : null;

        try {
            const patchData = { metadata: { date: newStart } };
            if (newEnd) patchData.metadata.end_date = newEnd;
            await axios.patch(`/api/vault/pages/${id}`, patchData);
            toast.success("Data actualitzada!");
            onRefresh?.();
        } catch (error) {
            console.error('Error movent event:', error);
            dropInfo.revert();
            toast.error("Error movent l'esdeveniment.");
        }
    }, [onRefresh]);

    // Estirar event (canviar data fi)
    const handleEventResize = useCallback(async (resizeInfo) => {
        const { event } = resizeInfo;
        const { id, readonly } = event.extendedProps;

        if (readonly) {
            resizeInfo.revert();
            toast.error("No pots redimensionar un esdeveniment extern.");
            return;
        }

        const newEnd = event.allDay
            ? event.endStr
            : event.end.toISOString().replace('.000Z', '');

        try {
            await axios.patch(`/api/vault/pages/${id}`, {
                metadata: { end_date: newEnd }
            });
            toast.success("Durada actualitzada!");
            onRefresh?.();
        } catch (error) {
            console.error('Error redimensionant event:', error);
            resizeInfo.revert();
            toast.error("Error redimensionant l'esdeveniment.");
        }
    }, [onRefresh]);

    // Afegir context menu a cada event
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
            className="h-full bg-surface flex flex-col overflow-hidden"
            onContextMenu={(e) => {
                // Capturem clic dret sobre el calendari (espais buits)
                e.preventDefault();
                
                // Busquem si hi ha una cel·la de data sota el cursor
                const dayEl = e.target.closest('.fc-daygrid-day, .fc-timegrid-slot');
                let dateStr = '';
                if (dayEl) {
                    dateStr = dayEl.getAttribute('data-date') || '';
                }
                
                // Només cridem si no és sobre un event (els events tenen el seu propi handler)
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
                />
            )}

            <div className="calendar-container flex-1">
                <FullCalendar
                    ref={calendarRef}
                    plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin, rrulePlugin]}
                    initialView="dayGridMonth"
                    headerToolbar={false}
                    locales={[caLocale, esLocale]}
                    locale={i18n.language || 'en'}
                    events={events}
                    editable={true}
                    droppable={true}
                    selectable={true}
                    eventResizableFromStart={false}
                    eventClick={handleEventClick}
                    eventDrop={handleEventDrop}
                    eventResize={handleEventResize}
                    eventDidMount={handleEventDidMount}
                    height="100%"
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
                        let classes = `cursor-pointer font-medium shadow-sm transition-transform hover:scale-[1.02] ${!isAllDay ? 'timed-event-colored' : ''}`;
                        if (isSelected(arg.event.id)) {
                            classes += ' ring-2 ring-[var(--gnosi-primary)]';
                        }
                        if (arg.event.id && arg.event.id === selectedEventId) {
                            classes += ' ring-2 ring-[var(--gnosi-primary)]';
                        }
                        return classes;
                    }}
                    eventContent={(arg) => {
                        const isAllDay = arg.event.allDay || arg.event.extendedProps.metadata?.all_day || !arg.event.startStr.includes('T');
                        const color = arg.event.backgroundColor || arg.event.borderColor;

                        if (isAllDay) {
                            return (
                                <div className="fc-event-main-frame flex items-center px-1.5 overflow-hidden h-full rounded shadow-sm"
                                    style={{ backgroundColor: color, color: '#ffffff', minHeight: '1.4rem' }}>
                                    <div className="fc-event-title flex-grow truncate text-[0.7rem] font-bold py-0.5">{arg.event.title}</div>
                                </div>
                            );
                        }

                        return (
                            <div className="fc-event-main-frame flex items-center gap-1 overflow-hidden" style={{ color: color }}>
                                <div className="fc-daygrid-event-dot" style={{ borderColor: color }}></div>
                                <div className="fc-event-time flex-shrink-0">{arg.timeText}</div>
                                <div className="fc-event-title flex-grow truncate">{arg.event.title}</div>
                            </div>
                        );
                    }}
                    dateClick={(arg) => {
                        if (onDateClick) {
                            onDateClick(arg.date);
                        }
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
                        if (onTitleChange) {
                            onTitleChange(arg.view.title);
                        }
                    }}
                />
            </div>
            <style jsx global>{`
                .fc {
                    color: var(--text-primary);
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
                /* Forçar estils per a cites amb hora */
                .timed-event-colored {
                    background-color: transparent !important;
                    border-color: transparent !important;
                    box-shadow: none !important;
                }
                .timed-event-colored:hover {
                    background-color: var(--bg-surface-hover) !important;
                }
                /* Esdeveniments de tot el dia (blocs) */
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
                    background-color: var(--gnosi-primary);
                    border-color: var(--gnosi-primary);
                }
                .fc .fc-button-primary:not(:disabled):active, 
                .fc .fc-button-primary:not(:disabled).fc-button-active {
                    background-color: var(--gnosi-primary);
                    filter: brightness(0.9);
                    border-color: var(--gnosi-primary);
                }
                .fc-theme-standard td, .fc-theme-standard th, .fc-scrollgrid {
                    border-color: var(--border-subtle) !important;
                }
                .fc .fc-day-today {
                    background-color: var(--bg-surface-hover) !important;
                }
                /* Cursor de resize visible */
                .fc-event-resizer {
                    cursor: ew-resize;
                }
                .fc-event-resizer-end {
                    cursor: e-resize;
                }
            `}</style>
        </div>
    );
};
