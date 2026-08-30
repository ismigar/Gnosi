import { useCallback, useState, type Dispatch, type SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import type { DigitalBrainCalendarProps } from '../../../components/Vault/DigitalBrainCalendar';
import { toast } from '../../../lib/toast';
import { fetchVaultPage, patchVaultPage } from '../../../shared/api/vaults';
import { rsvpCalendarEvent } from '../../../shared/api/calendar';
import { calendarEntry } from '../../../components/Vault/calendar-sidebar-right/calendarBoundary';
import type { CalendarEntry, EventPanel } from '../../../components/Vault/calendar-sidebar-right/calendarTypes';
import type { useCalendarSources } from './useCalendarSources';
import { formatLocalDate, formatLocalDateTime } from './calendarPageModel';

type CalendarEditUpdate = Parameters<NonNullable<DigitalBrainCalendarProps['onEventEdit']>>[1];
type CalendarMenuInput = Parameters<NonNullable<DigitalBrainCalendarProps['onContextMenu']>>[0];
export interface PageContextMenu extends CalendarMenuInput { open: boolean; instanceStart: string; allDay: boolean }
export interface PendingModify { id: string; patchData: NonNullable<CalendarEditUpdate>; action: 'move' | 'resize'; instanceStart: string }

export function useCalendarEventActions(sources: ReturnType<typeof useCalendarSources>, setShowRightSidebar: Dispatch<SetStateAction<boolean>>, dateRange: { start: string; end: string } | null, searchQuery: string) {
    const { t } = useTranslation();
    const { pages, externalEvents, setPages, setExternalEvents, fetchPages, fetchExternalEvents } = sources;
    const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
    const [selectedEvent, setSelectedEvent] = useState<CalendarEntry | null>(null);
    const [, setIsEditingEvent] = useState(false);
    const [eventPanel, setEventPanel] = useState<EventPanel | null>(null);
    const [contextMenu, setContextMenu] = useState<PageContextMenu>({ open: false, x: 0, y: 0, date: '', eventId: null, instanceStart: '', allDay: false });
    const [isConfirmDeleteOpen, setIsConfirmDeleteOpen] = useState(false);
    const [isRecurrenceChoiceOpen, setIsRecurrenceChoiceOpen] = useState(false);
    const [isRecurrenceModifyOpen, setIsRecurrenceModifyOpen] = useState(false);
    const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
    const [pendingModify, setPendingModify] = useState<PendingModify | null>(null);
    const handleCreateEventAtDate = useCallback((clickedDate: Date) => {
        const hasTime = clickedDate instanceof Date && (clickedDate.getHours() !== 0 || clickedDate.getMinutes() !== 0);
        const dateStr = hasTime ? formatLocalDateTime(clickedDate) : formatLocalDate(clickedDate);
        // Opens the form in creation mode WITHOUT creating the appointment yet: it's only saved
        // when the user gives it a title (the form's autosave handles this). This way
        // we avoid empty "New appointment" drafts if it's closed without typing anything.
        setSelectedEventId(null);
        setSelectedEvent(null);
        setIsEditingEvent(true);
        setShowRightSidebar(true);
        setEventPanel({ mode: 'create', data: null, date: dateStr, isEditing: true });
    }, [setShowRightSidebar]);


    // Click on event → opens edit panel (vault) or detail panel (external)
    const handleEventClick = useCallback(async (pageId: string, patchData: CalendarEditUpdate | null = null, action: 'move' | 'resize' | null = null) => {
        // If patchData and action are passed to us, it's a direct modification (drag/resize)
        if (patchData && action) {
            const event = pages.find(p => p.id === pageId) || externalEvents.find(ev => ev.id === pageId);
            if (!event) return;

            const isRecurrent = !!(event.metadata.rrule || event.metadata.recurrence);
            if (isRecurrent) {
                setPendingModify({ id: pageId, patchData, action, instanceStart: patchData.instanceStart });
                setIsRecurrenceModifyOpen(true);
                return;
            }

            // If it's not recurring, we apply the patch directly
            try {
                await patchVaultPage(pageId, { metadata: {...patchData} });
                toast.success(t('calendar.event_updated', "Appointment updated!"));
                void fetchPages();
            } catch {
                toast.error(t('calendar.event_save_error'));
            }
            return;
        }

        if (selectedEventId === pageId) {
            setSelectedEventId(null);
            setSelectedEvent(null);
            setIsEditingEvent(false);
            setEventPanel(null);
            return;
        }

        // Check whether it's an external event (Google/CalDAV)
        const externalEv = externalEvents.find(ev => ev.id === pageId);
        if (externalEv) {
            // One's own Google appointments (not read-only) open in edit mode so that
            // they can be edited (they're saved with PATCH to Google); shared/read-only ones and the
            // the rest of the external ones, in read-only mode.
            const m = externalEv.metadata;
            const isEditableGoogle = (m._provider === 'google' || !!m._account) && !m._vault_path && !m.readonly;
            setSelectedEventId(pageId);
            setSelectedEvent(externalEv);
            setIsEditingEvent(isEditableGoogle);
            setShowRightSidebar(true);
            setEventPanel({ mode: isEditableGoogle ? 'edit' : 'view', data: externalEv, date: '', isEditing: isEditableGoogle, isExternal: true });
            return;
        }

        // Vault event → loads the full page for editing
        try {
            const event = calendarEntry(await fetchVaultPage(pageId));
            setSelectedEventId(pageId);
            setSelectedEvent(event);
            setIsEditingEvent(true);
            setShowRightSidebar(true);
            setEventPanel({ mode: 'edit', data: event, date: '', isEditing: true });
        } catch {
            toast.error(t('calendar.error_loading_event_data'));
        }
    }, [selectedEventId, externalEvents, pages, t, fetchPages, setShowRightSidebar]);

    // Context menu (right click)
    const handleContextMenu = useCallback(({ x, y, date, eventId, instanceStart = '', allDay = false }: CalendarMenuInput) => {
        // If a click was made on an event, select it and look up its data
        if (eventId) {
            setSelectedEventId(eventId);
            const event = pages.find(p => p.id === eventId);
            setSelectedEvent(event || null);
        }
        setContextMenu({ open: true, x, y, date, eventId, instanceStart, allDay });
    }, [pages]);

    // Open panel in create mode from the context menu
    const handleNewEventFromContext = useCallback(() => {
        const baseDate = contextMenu.date ? new Date(`${contextMenu.date}T09:00:00`) : new Date();
        handleCreateEventAtDate(baseDate);
    }, [contextMenu.date, handleCreateEventAtDate]);

    const closeContextMenu = useCallback(() => {
        setContextMenu(prev => ({
            ...prev,
            open: false,
            eventId: null,
            instanceStart: '',
            allDay: false,
        }));
    }, []);

    // buildOccurrenceKey moved to utils/calendarUtils.js

    // Delete event from context menu (reinforced with direct ID)
    const handleDeleteFromContext = useCallback((forcedId: string | null = null) => {
        const targetEventId = forcedId || contextMenu.eventId || selectedEventId;
        if (!targetEventId) return;

        const eventData = pages.find(p => p.id === targetEventId) || selectedEvent;
        if (!eventData) return;

        // Origin guard
        const isGoogleEvent = eventData.metadata.source === 'google' ||
                             (typeof eventData.id === 'string' && eventData.id.length > 20 && !eventData.id.includes('-'));

        if (isGoogleEvent) {
            toast.error(t('calendar.external_event_delete_warning'));
            return;
        }

        setPendingDeleteId(targetEventId);
        const isRecurrent = !!(eventData.metadata.rrule || eventData.metadata.recurrence);

        if (isRecurrent) {
            setIsRecurrenceChoiceOpen(true);
        } else {
            setIsConfirmDeleteOpen(true);
        }
        closeContextMenu();
    }, [contextMenu.eventId, selectedEventId, pages, selectedEvent, t, closeContextMenu]);


    // Callback for when an event is saved - update only that event in the local state
    const handleEventSaved = useCallback((updatedEvent?: CalendarEntry) => {
        if (updatedEvent) {
            const m = updatedEvent.metadata;
            const isGoogle = (m._provider === 'google' || !!m._account) && !m._vault_path;
            if (isGoogle) {
                // Optimistic update of an external event (Google): updates ONLY this
                // event, without refetching, so as not to reload the whole calendar on every keystroke.
                setExternalEvents(prev => prev.map(ev =>
                    ev.id === updatedEvent.id
                        ? { ...ev, ...updatedEvent, metadata: { ...ev.metadata, ...(updatedEvent.metadata) } }
                        : ev
                ));
            } else {
                // Optimistic update (Vault)
                setPages(prevPages => {
                    const existingIndex = prevPages.findIndex(page => page.id === updatedEvent.id);
                    if (existingIndex !== -1) {
                        // Event existent: actualitzar
                        return prevPages.map(page =>
                            page.id === updatedEvent.id
                                ? {
                                    ...page,
                                    ...updatedEvent,
                                    metadata: updatedEvent.metadata,
                                }
                                : page
                        );
                    } else {
                        // New event: add
                        return [...prevPages, updatedEvent];
                    }
                });
            }

            // If the updated event is the selected one, update selectedEvent too
            if (selectedEventId === updatedEvent.id) {
                setSelectedEvent(prevEvent => ({
                    ...prevEvent,
                    ...updatedEvent,
                    metadata: updatedEvent.metadata,
                }));
            }
        } else {
            // If no event is passed, refresh everything: Vault and also the events from
            // Google (operations on Google call onSaved() without an argument).
            void fetchPages();
            if (dateRange) void fetchExternalEvents(dateRange.start, dateRange.end, searchQuery);
        }
    }, [selectedEventId, dateRange, searchQuery, fetchPages, fetchExternalEvents, setExternalEvents, setPages]);

    // RSVP: accept/decline/maybe a Google Calendar invitation
    const handleRsvp = useCallback(async (rsvpStatus: string) => {
        if (!eventPanel) return;
        const eventId = eventPanel.data?.id;
        const meta = eventPanel.data?.metadata || {};
        const calId = meta._calendar_id || 'primary';
        const acct = meta._account;
        if (!eventId || !acct) return;

        try {
            await rsvpCalendarEvent({
                eventId,
                email: acct,
                rsvp: rsvpStatus,
                calendarId: calId,
            });
            // Update local state without re-fetching
            setEventPanel(prev => {
                if (!prev?.data) return prev;
                const updatedAttendees = (prev.data.metadata.attendees || []).map(a =>
                    a.self ? { ...a, rsvp: rsvpStatus } : a
                );
                return {
                    ...prev,
                    data: {
                        ...prev.data,
                        metadata: { ...prev.data.metadata, attendees: updatedAttendees },
                    },
                };
            });
            setExternalEvents(prev => prev.map(ev => {
                if (ev.id !== eventId) return ev;
                return {
                    ...ev,
                    metadata: {
                        ...ev.metadata,
                        attendees: (ev.metadata.attendees || []).map(a =>
                            a.self ? { ...a, rsvp: rsvpStatus } : a
                        ),
                    },
                };
            }));
            const label = rsvpStatus === 'accepted' ? t('calendar.rsvp_accepted', "✓ Accepted")
                : rsvpStatus === 'declined' ? t('calendar.rsvp_declined', "✗ Declined")
                : t('calendar.rsvp_maybe', "? Maybe");
            toast.success(label);
        } catch {
            toast.error(t('calendar.rsvp_error', "Error updating the response."));
        }
    }, [eventPanel, t, setExternalEvents]);


    const closePanel = () => {
        const wasEditing = eventPanel?.mode === 'edit';
        setEventPanel(null); setSelectedEventId(null); setSelectedEvent(null); setIsEditingEvent(false);
        if (wasEditing && dateRange) window.setTimeout(() => {
            void fetchExternalEvents(dateRange.start, dateRange.end, searchQuery);
            void fetchPages();
        }, 700);
    };
    return { selectedEventId, selectedEvent, setSelectedEventId, setSelectedEvent, eventPanel, setEventPanel, contextMenu, isConfirmDeleteOpen, setIsConfirmDeleteOpen, isRecurrenceChoiceOpen, setIsRecurrenceChoiceOpen, isRecurrenceModifyOpen, setIsRecurrenceModifyOpen, pendingDeleteId, setPendingDeleteId, pendingModify, setPendingModify, handleCreateEventAtDate, handleEventClick, handleContextMenu, handleNewEventFromContext, closeContextMenu, handleDeleteFromContext, handleEventSaved, handleRsvp, closePanel };
}
