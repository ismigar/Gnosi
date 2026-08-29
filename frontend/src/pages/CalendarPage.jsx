import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import axios from '../shared/api/legacy-http';
import { toast } from '../lib/toast';
import { Calendar, ChevronLeft, ChevronRight, PanelLeft, PanelRight, Circle, Trash2, Bell } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { AppHeader } from '../components/AppHeader';
import { DigitalBrainCalendar } from '../components/Vault/DigitalBrainCalendar';
import { CalendarSidebarLeft } from '../components/Vault/CalendarSidebarLeft';
import { CalendarSidebarRight } from '../components/Vault/CalendarSidebarRight';
import { CalendarContextMenu } from '../components/Vault/CalendarContextMenu';
import { useTranslation } from 'react-i18next';
import { GlobalSearchModal } from '../components/Vault/GlobalSearchModal';
import { ConfirmModal } from '../components/ConfirmModal';
import { RecurrenceChoiceModal } from '../components/Vault/RecurrenceChoiceModal';
import { buildOccurrenceKey, truncateRruleBefore } from '../utils/calendarUtils';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { usePlugins } from '../plugins/usePlugins';
import { vaultPath } from '../lib/vaultRouting';
import {
    fetchCalendarEvents,
    rsvpCalendarEvent,
} from '../shared/api/calendar';
import {
    fetchIntegrations,
    updateCalendarAliases,
    updateCalendarColors,
    updateCalendarSelection,
    updateDefaultCalendar,
} from '../shared/api/integrations';
import { fetchVaultPages, fetchVaultTables } from '../shared/api/vaults';
import {
    useCalendarList,
    useMeetingReminderSettings,
    useUpdateMeetingReminderSettings,
} from '../shared/api/useCalendarData';

// Keyboard handler removed in favor of RecurrenceChoiceModal component

export default function CalendarPage() {
    const { t } = useTranslation();
    const { isEnabled } = usePlugins();
    const aiMeetingsEnabled = isEnabled('ai-platform');
    const navigate = useNavigate();
    const isCompact = useMediaQuery('(max-width: 1023px)');
    const [pages, setPages] = useState([]);           // notes vault locals (source=Gnosi)
    const [externalEvents, setExternalEvents] = useState([]); // Google/CalDAV events
    const [undatedNotes, setUndatedNotes] = useState([]);
    const [dateRange, setDateRange] = useState(null);  // { start, end } of the visible range
    const [loading, setLoading] = useState(true);
    const [currentTitle, setCurrentTitle] = useState('');
    const [activeView, setActiveView] = useState(() => isCompact ? 'timeGridDay' : 'dayGridMonth');
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedCalendars, setSelectedCalendars] = useState(new Set());
    const [enabledTables, setEnabledTables] = useState([]); // Enabled tables as calendars
    const [integrations, setIntegrations] = useState({});
    const calendarRef = useRef(null);
    // Ref that stores the original server selection (to restore async sources like sub-calendars)
    const savedCalendarSelectionRef = useRef(undefined);
    const [showLeftSidebar, setShowLeftSidebar] = useState(true);
    const [showRightSidebar, setShowRightSidebar] = useState(false);
    const [isGlobalSearchOpen, setIsGlobalSearchOpen] = useState(false);
    const [, setPartialData] = useState(false);

    // AI meeting notifier (agenda)
    const [remindersEnabled, setRemindersEnabled] = useState(false);
    const [remindersLead, setRemindersLead] = useState(10);
    const calendarListQuery = useCalendarList();
    const googleCalendars = calendarListQuery.data?.items || [];
    const reminderSettingsQuery = useMeetingReminderSettings(aiMeetingsEnabled);
    const updateReminderSettingsMutation = useUpdateMeetingReminderSettings();

    // Event selection and editing state
    const [selectedEventId, setSelectedEventId] = useState(null); // ID of the selected event
    const [, setIsEditingEvent] = useState(false); // Whether it's in edit mode
    const [selectedEvent, setSelectedEvent] = useState(null); // Event complet seleccionat

    // Side panel (replaces popup modal)
    const [eventPanel, setEventPanel] = useState(null); // null | { mode, data, date, isEditing }

    // Context menu
    const [contextMenu, setContextMenu] = useState({
        open: false,
        x: 0,
        y: 0,
        date: '',
        eventId: null,
        instanceStart: '',
        allDay: false
    });

    // Deletion states
    const [isConfirmDeleteOpen, setIsConfirmDeleteOpen] = useState(false);
    const [isRecurrenceChoiceOpen, setIsRecurrenceChoiceOpen] = useState(false);
    const [isRecurrenceModifyOpen, setIsRecurrenceModifyOpen] = useState(false);
    const [pendingDeleteId, setPendingDeleteId] = useState(null);
    const [pendingModify, setPendingModify] = useState(null); // { id, patchData, action, instanceStart }

    useEffect(() => {
        if (isCompact) {
            setShowLeftSidebar(false);
            setShowRightSidebar(false);
        }
    }, [isCompact]);

    const availableCalendars = useMemo(() => {
        const sources = new Set();
        enabledTables.forEach(t => sources.add(t.name));

        (integrations?.calendars || []).forEach(c => {
            const src = c.email || c.name || c.url;
            if (src) sources.add(src);
        });

        // Sources for local vault notes
        pages.forEach(p => {
            const s = (p.metadata?.source || '').trim();
            if (!s || s === 'Gnosi' || s === 'Gnosi Vault') return;
            if (s !== 'es_es' && !s.includes('holidays')) sources.add(s);
        });

        // Sources of hybrid external events
        externalEvents.forEach(ev => {
            const s = (ev.metadata?.source || '').trim();
            if (s && s !== 'Gnosi' && s !== 'Gnosi Vault') sources.add(s);
        });

        return Array.from(sources);
    }, [pages, externalEvents, enabledTables, integrations]);

    const calendarConfigs = useMemo(() => {
        const fallbackColors = ['#64b5f6', '#ffb74d', '#ba68c8', '#4db6ac', '#f06292'];

        const configs = availableCalendars.map((s, index) => {
            const isGnosi = s === 'Gnosi' || s === 'Gnosi Vault';
            const table = enabledTables.find(t => t.name === s);
            const isTable = !!table;

            const customName = integrations?.calendar_aliases?.[s] || (table ? integrations?.calendar_aliases?.[table.id] : null);

            const integration = (isGnosi || isTable)
                ? { color: integrations?.vault_calendar?.color || (table?.color) || 'var(--gnosi-primary)' }
                : (integrations?.calendars || []).find(c =>
                    c.url === s || c.name === s || c.email === s || (s.includes(' - ') && s.startsWith(c.email))
                );

            let account = null;
            let subName = null;

            if (s.includes(' - ')) {
                const parts = s.split(' - ');
                account = parts[0];
                subName = parts.slice(1).join(' - ');
            } else if (s.includes('@')) {
                account = s;
            }

            const customColor = integrations?.calendar_colors?.[s];

            // Resolves the real Google calendar (calendar_id + provider) to actually create events in it
            let googleCalId = null;
            let provider = null;
            if (!isGnosi && !isTable) {
                const gcal = googleCalendars.find(gc =>
                    gc.account === account && (
                        (subName && gc.name === subName) ||
                        (!subName && (gc.id === account || gc.primary || gc.name === account))
                    )
                );
                if (gcal) { googleCalId = gcal.id; provider = gcal.provider || 'google'; }
            }

            return {
                id: table?.id || s,
                source: s,
                kind: isTable ? 'table' : 'external',
                name: customName || subName || integration?.name || s,
                account: account,
                google_calendar_id: googleCalId,
                provider,
                color: customColor || integration?.color || (isGnosi ? 'var(--gnosi-primary)' : fallbackColors[index % fallbackColors.length])
            };
        });

        return configs;
    }, [availableCalendars, integrations, enabledTables, googleCalendars]);

    const defaultCalendarId = useMemo(() => {
        const defSource = integrations?.default_calendar;
        if (defSource) {
            const cfg = calendarConfigs.find(c => c.source === defSource);
            if (cfg) return cfg.id;
        }
        return calendarConfigs[0]?.id || '';
    }, [integrations, calendarConfigs]);

    const colorMap = useMemo(() => {
        const map = {};
        calendarConfigs.forEach(cfg => {
            if (cfg.source) map[cfg.source] = cfg.color;
        });
        // Key fallbacks for local notes
        const vaultColor = integrations?.vault_calendar?.color || 'var(--gnosi-primary)';
        if (!map['Gnosi']) map['Gnosi'] = vaultColor;
        if (!map['Gnosi Vault']) map['Gnosi Vault'] = vaultColor;
        return map;
    }, [calendarConfigs, integrations]);

    // Initial selection: restores the saved visibility, even for async sources (sub-calendars)
    useEffect(() => {
        if (calendarConfigs.length === 0) return;

        // Initialize the ref with the saved selection (only the first time integrations has data)
        if (savedCalendarSelectionRef.current === undefined && Object.keys(integrations).length > 0) {
            const raw = integrations?.calendar_selection;
            if (Array.isArray(raw) && raw.length > 0) {
                savedCalendarSelectionRef.current = new Set(raw);
            } else if (raw?.selection && Array.isArray(raw.selection) && raw.selection.length > 0) {
                savedCalendarSelectionRef.current = new Set(raw.selection);
            } else {
                savedCalendarSelectionRef.current = null; // null = no saved selection → show everything
            }
        }

        const savedSet = savedCalendarSelectionRef.current;

        // Add sources that should be selected but aren't yet
        setSelectedCalendars(prev => {
            const next = new Set(prev);
            let changed = false;
            calendarConfigs.forEach(cfg => {
                if (!next.has(cfg.source)) {
                    // Add if: there's no saved selection (show everything) or it was in the saved selection
                    if (savedSet === null || savedSet === undefined || savedSet.has(cfg.source)) {
                        next.add(cfg.source);
                        changed = true;
                    }
                    // If it was explicitly hidden (not in savedSet) → don't add
                }
            });
            return changed ? next : prev;
        });
    }, [calendarConfigs, integrations]);

    // Converts a hybrid event (Google/CalDAV) to the allNotes format expected by DigitalBrainCalendar
    const convertHybridEvent = (ev) => ({
        id: ev.id,
        title: ev.title,
        metadata: {
            date: ev.start,
            end_date: ev.end || null,
            all_day: ev.all_day,
            source: ev.source,
            location: ev.location || '',
            description: ev.description || '',
            rrule: ev.recurrence || null,
            status: ev.status,
            link: ev.link || '',
            color: ev.color || null,
            readonly: ev.is_read_only || false,
            attendees: ev.attendees || [],
            organizer: ev.organizer || '',
            // internal fields to distinguish vault vs external
            _provider: ev.provider,
            _account: ev.account,
            _calendar_id: ev.calendar_id,
            _calendar_name: ev.calendar_name,
            _vault_path: ev.vault_path || null,
            _end_exclusive: ev.provider !== 'vault' && ev.all_day,
            _event_type: ev.event_type || 'default',
            _birthday_properties: ev.birthday_properties || null,
            recurring_event_id: ev.recurring_event_id || null,
        },
    });

    // Fetch external events (Google Calendar / CalDAV) for the visible range.
    // If the range/search changes while a request is in flight, the
    // previous one to prevent setExternalEvents from receiving stale data (race).
    const externalEventsAbortRef = useRef(null);
    const fetchExternalEvents = async (timeMin, timeMax, search = '') => {
        if (externalEventsAbortRef.current) {
            externalEventsAbortRef.current.abort();
        }
        const controller = new AbortController();
        externalEventsAbortRef.current = controller;
        try {
            const events = await fetchCalendarEvents({
                includeVault: false,
                search: search || undefined,
                timeMax: timeMax || undefined,
                timeMin: timeMin || undefined,
            }, controller.signal);
            if (controller.signal.aborted) return;
            const converted = events.map(convertHybridEvent);
            setExternalEvents(converted);
        } catch (err) {
            if (controller.signal.aborted || err?.name === 'CanceledError' || axios.isCancel?.(err)) return;
            console.warn('fetchExternalEvents error:', err);
        } finally {
            if (externalEventsAbortRef.current === controller) {
                externalEventsAbortRef.current = null;
            }
        }
    };

    const fetchPages = async () => {
        setLoading(true);
        try {
            const timeout = 120000;
            const signal = AbortSignal.timeout(timeout);
            const [pagesRes, integrationsRes, tablesRes] = await Promise.allSettled([
                fetchVaultPages({ only_calendar: true }, signal),
                fetchIntegrations(signal),
                fetchVaultTables(undefined, signal),
            ]);

            if (pagesRes.status !== 'fulfilled') throw pagesRes.reason;

            const integrationsData = integrationsRes.status === 'fulfilled'
                ? (integrationsRes.value || {}) : null;
            const hasIntegrations = integrationsData !== null;
            const safeIntegrations = integrationsData || {};
            setIntegrations(safeIntegrations);

            const enabledTableIds = safeIntegrations.vault_calendar?.enabled_tables || [];
            const allTables = tablesRes.status === 'fulfilled' ? (tablesRes.value || []) : [];
            const tables = allTables
                .filter(tbl => !hasIntegrations || enabledTableIds.includes(tbl.id))
                .map(tbl => ({ id: tbl.id, name: tbl.name, type: 'table' }));
            setEnabledTables(tables);

            const allData = pagesRes.value || [];
            const dated = [];
            const undated = [];

            allData.forEach(page => {
                const tableId = page.resolved_table_id || page.metadata?.table_id || page.metadata?.database_table_id;
                if (tableId && hasIntegrations && !enabledTableIds.includes(tableId)) return;

                const hasDate = page.metadata?.date;
                const source = (page.metadata?.source || '').trim();
                // Exclude events from external providers (now they come from the hybrid API)
                if (source && source !== 'Gnosi' && source !== 'Gnosi Vault') return;

                if (hasDate) {
                    dated.push(page);
                } else {
                    const path = page.path || page.abs_path || '';
                    if (path.includes('/Calendar/') || path.includes('\\Calendar\\')) {
                        undated.push(page);
                    }
                }
            });

            setPages(dated);
            setUndatedNotes(undated);
            setPartialData(integrationsRes.status !== 'fulfilled' || tablesRes.status !== 'fulfilled');

            if (integrationsRes.status !== 'fulfilled' || tablesRes.status !== 'fulfilled') {
                toast.error(t('calendar.partial_data_warning'));
            }
        } catch (err) {
            console.error(err);
            toast.error(t('calendar.error_loading_pages'));
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchPages();
    }, []);

    // Abort the external events request if the component unmounts.
    useEffect(() => {
        return () => {
            if (externalEventsAbortRef.current) {
                externalEventsAbortRef.current.abort();
                externalEventsAbortRef.current = null;
            }
        };
    }, []);

    // Re-fetch external events when the date range or the search changes
    useEffect(() => {
        if (dateRange) {
            fetchExternalEvents(dateRange.start, dateRange.end, searchQuery);
        }
    }, [dateRange, searchQuery]);

    const formatLocalDate = (date) => {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    };

    const formatLocalDateTime = (date) => {
        const base = formatLocalDate(date);
        const h = String(date.getHours()).padStart(2, '0');
        const min = String(date.getMinutes()).padStart(2, '0');
        return `${base}T${h}:${min}:00`;
    };

    const handleCreateEventAtDate = useCallback((clickedDate) => {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handleRenameCalendar = async (source, newName) => {
        try {
            const currentAliases = integrations?.calendar_aliases || {};
            const updatedAliases = { ...currentAliases, [source]: newName.trim() };

            // Remove alias if empty
            if (!newName.trim()) {
                delete updatedAliases[source];
            }

            const updatedIntegrations = { ...integrations, calendar_aliases: updatedAliases };

            await updateCalendarAliases(updatedAliases);
            setIntegrations(updatedIntegrations);
            toast.success(t('calendar.calendar_renamed_success'));
        } catch (err) {
            console.error('Error renaming calendar:', err);
            toast.error(t('calendar.calendar_rename_error'));
        }
    };

    const handleUpdateCalendarColor = async (source, newColor) => {
        try {
            const currentColors = integrations?.calendar_colors || {};
            const updatedColors = { ...currentColors, [source]: newColor };

            const updatedIntegrations = { ...integrations, calendar_colors: updatedColors };

            await updateCalendarColors(updatedColors);
            setIntegrations(updatedIntegrations);
            toast.success(t('calendar.calendar_color_updated_success'));
        } catch (err) {
            console.error('Error updating calendar color:', err);
            toast.error(t('calendar.calendar_color_update_error'));
        }
    };

    // Keyboard shortcuts
    useEffect(() => {
        const handleKeyDown = (e) => {
            // Cmd+K -> Global search
            if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
                e.preventDefault();
                setIsGlobalSearchOpen(prev => !prev);
            }
            // . -> Toggle sidebar
            if (e.key === '.') {
                setShowRightSidebar(prev => !prev);
            }
            // , -> Ir a data (selector? de moment avui o scroll to focus?)
            if (e.key === ',') {
                handleToday();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, []);

    // Click on event → opens edit panel (vault) or detail panel (external)
    const handleEventClick = useCallback(async (pageId, patchData = null, action = null) => {
        // If patchData and action are passed to us, it's a direct modification (drag/resize)
        if (patchData && action) {
            const event = pages.find(p => p.id === pageId) || externalEvents.find(ev => ev.id === pageId);
            if (!event) return;

            const isRecurrent = !!(event.metadata?.rrule || event.metadata?.recurrence);
            if (isRecurrent) {
                setPendingModify({ id: pageId, patchData, action, instanceStart: patchData.instanceStart });
                setIsRecurrenceModifyOpen(true);
                return;
            }

            // If it's not recurring, we apply the patch directly
            try {
                await axios.patch(`/api/vault/pages/${pageId}`, { metadata: patchData });
                toast.success(t('calendar.event_updated', "Appointment updated!"));
                fetchPages();
            } catch (err) {
                console.error('Error updating event:', err);
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
            const m = externalEv.metadata || {};
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
            const res = await axios.get(`/api/vault/pages/${pageId}`);
            setSelectedEventId(pageId);
            setSelectedEvent(res.data);
            setIsEditingEvent(true);
            setShowRightSidebar(true);
            setEventPanel({ mode: 'edit', data: res.data, date: '', isEditing: true });
        } catch (err) {
            console.error('Error loading event:', err);
            toast.error(t('calendar.error_loading_event_data'));
        }
    }, [selectedEventId, externalEvents, pages, t]);

    // Context menu (right click)
    const handleContextMenu = useCallback(({ x, y, date, eventId = null, instanceStart = '', allDay = false }) => {
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
    const handleDeleteFromContext = useCallback((forcedId = null) => {
        const targetEventId = forcedId || contextMenu.eventId || selectedEventId;
        if (!targetEventId) return;

        const eventData = pages.find(p => p.id === targetEventId) || selectedEvent;
        if (!eventData) return;

        // Origin guard
        const isGoogleEvent = eventData?.metadata?.source === 'google' || 
                             (typeof eventData.id === 'string' && eventData.id.length > 20 && !eventData.id.includes('-'));
        
        if (isGoogleEvent) {
            toast.error(t('calendar.external_event_delete_warning'));
            return;
        }

        setPendingDeleteId(targetEventId);
        const isRecurrent = !!(eventData.metadata?.rrule || eventData.metadata?.recurrence);
        
        if (isRecurrent) {
            setIsRecurrenceChoiceOpen(true);
        } else {
            setIsConfirmDeleteOpen(true);
        }
        closeContextMenu();
    }, [contextMenu.eventId, selectedEventId, pages, selectedEvent, t, closeContextMenu]);

    const executeDelete = async (isSeries = false, isInstanceOnly = false, isFollowing = false) => {
        const targetEventId = pendingDeleteId;
        if (!targetEventId) return;

        const eventData = pages.find(p => p.id === targetEventId) || selectedEvent;
        if (!eventData) return;

        try {
            if (isInstanceOnly) {
                const occurrenceKey = buildOccurrenceKey(
                    contextMenu.instanceStart,
                    contextMenu.date,
                    contextMenu.allDay,
                    eventData.metadata || {}
                );
                if (!occurrenceKey) {
                    toast.error(t('calendar.error_identifying_instance'));
                    return;
                }

                const existingExdates = Array.isArray(eventData.metadata?.exdates)
                    ? eventData.metadata.exdates
                    : (typeof eventData.metadata?.exdates === 'string'
                        ? eventData.metadata.exdates.split(',').filter(Boolean)
                        : []);

                const patchedMetadata = {
                    ...(eventData.metadata || {}),
                    exdates: [...new Set([...existingExdates, occurrenceKey])],
                };
                await axios.patch(`/api/vault/pages/${targetEventId}`, {
                    metadata: patchedMetadata,
                });
                toast.success(t('calendar.instance_deleted'));
            } else if (isFollowing) {
                // Split: Truncate the master's rrule so it ends before today
                const newRrule = truncateRruleBefore(eventData.metadata?.rrule, contextMenu.instanceStart);
                await axios.patch(`/api/vault/pages/${targetEventId}`, {
                    metadata: { rrule: newRrule }
                });
                toast.success(t('calendar.following_deleted', "Series truncated from today."));
            } else {
                // Delete full series
                await axios.delete(`/api/vault/pages/${targetEventId}`);
                toast.success(isSeries ? t('calendar.series_deleted') : t('calendar.event_deleted'));
            }

            setSelectedEventId(null);
            setSelectedEvent(null);
            setEventPanel(null);
            setIsConfirmDeleteOpen(false);
            setIsRecurrenceChoiceOpen(false);
            setPendingDeleteId(null);
            await fetchPages();
        } catch (err) {
            console.error('Error deleting event:', err);
            toast.error(t('calendar.error_deleting_event'));
        }
    };

    const executeModify = async ( isInstanceOnly = false, isFollowing = false) => {
        const { id, patchData, instanceStart } = pendingModify;
        if (!id || !patchData) return;

        const eventData = pages.find(p => p.id === id) || selectedEvent;
        if (!eventData) return;

        try {
            if (isInstanceOnly) {
                // 1. Add the current instance to EXDATE
                const occurrenceKey = buildOccurrenceKey(
                    instanceStart,
                    null,
                    eventData.metadata?.all_day,
                    eventData.metadata || {}
                );

                const existingExdates = Array.isArray(eventData.metadata?.exdates)
                    ? eventData.metadata.exdates
                    : (typeof eventData.metadata?.exdates === 'string'
                        ? eventData.metadata.exdates.split(',').filter(Boolean)
                        : []);

                await axios.patch(`/api/vault/pages/${id}`, {
                    metadata: {
                        exdates: [...new Set([...existingExdates, occurrenceKey])],
                    }
                });

                // 2. Create a new single appointment with the new data
                const newMetadata = {
                    ...(eventData.metadata || {}),
                    ...patchData,
                    rrule: null,
                    exdates: [],
                };
                delete newMetadata.id;

                await axios.post('/api/vault/pages', {
                    title: eventData.title,
                    content: eventData.content || '',
                    metadata: newMetadata,
                });

                toast.success(t('calendar.instance_updated', "Instance updated!"));
            } else if (isFollowing) {
                // 1. Truncate the old master's rrule
                const newRruleOldMaster = truncateRruleBefore(eventData.metadata?.rrule, instanceStart);
                await axios.patch(`/api/vault/pages/${id}`, {
                    metadata: { rrule: newRruleOldMaster }
                });

                // 2. Create a new master that starts on the new date
                const newMetadata = {
                    ...(eventData.metadata || {}),
                    ...patchData, // Includes the new date and end_date
                    exdates: [],
                    // rrule stays the same (without the truncation)
                };
                delete newMetadata.id;

                await axios.post('/api/vault/pages', {
                    title: eventData.title,
                    content: eventData.content || '',
                    metadata: newMetadata,
                });

                toast.success(t('calendar.series_split_updated', "Series split and updated!"));
            } else {
                // Modify the whole series (the master)
                await axios.patch(`/api/vault/pages/${id}`, {
                    metadata: patchData
                });
                toast.success(t('calendar.series_updated', "Series updated!"));
            }

            setIsRecurrenceModifyOpen(false);
            setPendingModify(null);
            await fetchPages();
        } catch (err) {
            console.error('Error modifying recurrent event:', err);
            toast.error(t('calendar.event_save_error'));
        }
    };

    // Callback for when an event is saved - update only that event in the local state
    const handleEventSaved = useCallback((updatedEvent) => {
        if (updatedEvent) {
            const m = updatedEvent.metadata || {};
            const isGoogle = (m._provider === 'google' || !!m._account) && !m._vault_path;
            if (isGoogle) {
                // Optimistic update of an external event (Google): updates ONLY this
                // event, without refetching, so as not to reload the whole calendar on every keystroke.
                setExternalEvents(prev => prev.map(ev =>
                    ev.id === updatedEvent.id
                        ? { ...ev, ...updatedEvent, metadata: { ...ev.metadata, ...(updatedEvent.metadata || {}) } }
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
                                    metadata: updatedEvent.metadata || page.metadata,
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
                    metadata: updatedEvent.metadata || prevEvent?.metadata,
                }));
            }
        } else {
            // If no event is passed, refresh everything: Vault and also the events from
            // Google (operations on Google call onSaved() without an argument).
            fetchPages();
            if (dateRange) fetchExternalEvents(dateRange.start, dateRange.end, searchQuery);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedEventId, dateRange, searchQuery]);

    // RSVP: accept/decline/maybe a Google Calendar invitation
    const handleRsvp = useCallback(async (rsvpStatus) => {
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
                if (!prev) return prev;
                const updatedAttendees = (prev.data?.metadata?.attendees || []).map(a =>
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
        } catch (err) {
            console.error('handleRsvp error:', err);
            toast.error(t('calendar.rsvp_error', "Error updating the response."));
        }
    }, [eventPanel, t]);

    const handlePrev = () => {
        calendarRef.current?.getApi().prev();
    };

    const handleNext = () => {
        calendarRef.current?.getApi().next();
    };

    const handleToday = () => {
        calendarRef.current?.getApi().today();
    };

    const handleViewChange = (view) => {
        calendarRef.current?.getApi().changeView(view);
        setActiveView(view);
    };

    // ── Meeting reminders (AI notifier) ──────────────────────────
    useEffect(() => {
        const settings = reminderSettingsQuery.data;
        if (!aiMeetingsEnabled || !settings) return;
        setRemindersEnabled(!!settings.enabled);
        if (settings.lead_minutes) setRemindersLead(Number(settings.lead_minutes));
    }, [aiMeetingsEnabled, reminderSettingsQuery.data]);

    const saveReminderSettings = useCallback(async (patch) => {
        const next = {
            enabled: patch.enabled ?? remindersEnabled,
            lead_minutes: patch.lead_minutes ?? remindersLead,
        };
        setRemindersEnabled(next.enabled);
        setRemindersLead(next.lead_minutes);
        try {
            await updateReminderSettingsMutation.mutateAsync(next);
            toast.success(next.enabled
                ? t('calendar.reminders_on', "Meeting reminders enabled")
                : t('calendar.reminders_off', "Meeting reminders disabled"));
        } catch {
            toast.error(t('calendar.reminders_error', "Couldn't save the reminder settings"));
        }
    }, [remindersEnabled, remindersLead, t, updateReminderSettingsMutation]);

    const btnClass = "flex items-center justify-center h-7 px-3 rounded-md text-[11px] font-bold tracking-tight uppercase transition-all border";

    return (
        <div className="h-full bg-[var(--bg-primary)] overflow-hidden flex flex-col">
            <AppHeader icon={Calendar} title={`${t('calendar.title')} ${currentTitle ? `- ${currentTitle}` : ''}`}>
                <div className="flex items-center gap-4">
                    {/* Side Panel Toggles */}
                    <div className="flex items-center gap-1 bg-[var(--bg-secondary)] p-0.5 rounded-lg border border-[var(--border-primary)] shadow-sm">
                        <button 
                            onClick={() => {
                                const next = !showLeftSidebar;
                                setShowLeftSidebar(next);
                                if (next && isCompact) setShowRightSidebar(false);
                                setTimeout(() => calendarRef.current?.getApi().updateSize(), 350);
                            }}
                            className={`p-1.5 rounded transition-all ${showLeftSidebar ? 'text-[var(--gnosi-primary)] bg-[var(--gnosi-primary)]/10' : 'text-[var(--text-tertiary)] hover:bg-[var(--bg-tertiary)]'}`}
                            title={showLeftSidebar ? t('calendar.hide_left_sidebar', "Hide left sidebar") : t('calendar.show_left_sidebar', "Show left sidebar")}
                            aria-label={showLeftSidebar ? t('calendar.hide_left_sidebar', "Hide left sidebar") : t('calendar.show_left_sidebar', "Show left sidebar")}
                            aria-expanded={showLeftSidebar}
                        >
                            <PanelLeft size={16} strokeWidth={2.5} />
                        </button>
                        <div className="w-px h-3 bg-[var(--border-primary)] mx-0.5" />
                        <button 
                            onClick={() => {
                                const next = !showRightSidebar;
                                setShowRightSidebar(next);
                                if (next && isCompact) setShowLeftSidebar(false);
                                setTimeout(() => calendarRef.current?.getApi().updateSize(), 350);
                            }}
                            className={`p-1.5 rounded transition-all ${showRightSidebar ? 'text-[var(--gnosi-primary)] bg-[var(--gnosi-primary)]/10' : 'text-[var(--text-tertiary)] hover:bg-[var(--bg-tertiary)]'}`}
                            title={showRightSidebar ? t('calendar.hide_right_sidebar', "Hide right sidebar") : t('calendar.show_right_sidebar', "Show right sidebar")}
                            aria-label={showRightSidebar ? t('calendar.hide_right_sidebar', "Hide right sidebar") : t('calendar.show_right_sidebar', "Show right sidebar")}
                            aria-expanded={showRightSidebar}
                        >
                            <PanelRight size={16} strokeWidth={2.5} />
                        </button>
                    </div>

                    {/* AI meeting notifier */}
                    {aiMeetingsEnabled && <div className="flex items-center gap-1 bg-[var(--bg-secondary)] p-0.5 rounded-lg border border-[var(--border-primary)] shadow-sm">
                        <button
                            onClick={() => saveReminderSettings({ enabled: !remindersEnabled })}
                            className={`flex items-center gap-1 p-1.5 rounded transition-all ${remindersEnabled ? 'text-[var(--gnosi-primary)] bg-[var(--gnosi-primary)]/10' : 'text-[var(--text-tertiary)] hover:bg-[var(--bg-tertiary)]'}`}
                            title={remindersEnabled ? t('calendar.ai_reminders_active', "AI meeting reminders enabled") : t('calendar.ai_reminders_activate', "Enable AI meeting reminders")}
                        >
                            <Bell size={16} strokeWidth={2.5} />
                        </button>
                        {remindersEnabled && (
                            <select
                                value={remindersLead}
                                onChange={(e) => saveReminderSettings({ lead_minutes: Number(e.target.value) })}
                                className="bg-transparent text-[11px] font-bold uppercase text-[var(--text-secondary)] outline-none cursor-pointer pr-1"
                                title={t('calendar.reminder_lead_time', "Reminder lead time")}
                            >
                                <option value={5}>{t('calendar.minutes_abbrev', '{{count}} min', { count: 5 })}</option>
                                <option value={10}>{t('calendar.minutes_abbrev', '{{count}} min', { count: 10 })}</option>
                                <option value={15}>{t('calendar.minutes_abbrev', '{{count}} min', { count: 15 })}</option>
                                <option value={30}>{t('calendar.minutes_abbrev', '{{count}} min', { count: 30 })}</option>
                            </select>
                        )}
                    </div>}

                    <div className="w-px h-6 bg-[var(--border-primary)]" />

                    {/* Navigation Controls */}
                    <div className="flex items-center gap-1 bg-[var(--bg-secondary)] p-0.5 rounded-lg border border-[var(--border-primary)] shadow-sm">
                        <button onClick={handlePrev} className="p-1 text-[var(--text-secondary)] hover:text-[var(--gnosi-primary)] hover:bg-[var(--bg-tertiary)] rounded transition-colors" title={t('common.previous')}>
                            <ChevronLeft size={16} strokeWidth={2.5} />
                        </button>
                        <button onClick={handleToday} className="px-3 text-[11px] font-bold uppercase tracking-tight text-[var(--text-primary)] hover:text-[var(--gnosi-primary)] hover:bg-[var(--bg-tertiary)] rounded transition-colors">
                            {t('calendar.today')}
                        </button>
                        <button onClick={handleNext} className="p-1 text-[var(--text-secondary)] hover:text-[var(--gnosi-primary)] hover:bg-[var(--bg-tertiary)] rounded transition-colors" title={t('common.next')}>
                            <ChevronRight size={16} strokeWidth={2.5} />
                        </button>
                    </div>

                    {/* View Toggles */}
                    <div className="flex items-center gap-1 bg-[var(--bg-secondary)] p-1 rounded-lg border border-[var(--border-primary)] shadow-sm">
                        {[
                            { id: 'multiMonthYear', label: t('calendar.view_year', "Year") },
                            { id: 'dayGridMonth', label: t('calendar.view_month') },
                            { id: 'timeGridWeek', label: t('calendar.view_week') },
                            { id: 'timeGridDay', label: t('calendar.view_day') }
                        ].map((view) => (
                            <button
                                key={view.id}
                                onClick={() => handleViewChange(view.id)}
                                aria-pressed={activeView === view.id}
                                className={`${btnClass} ${activeView === view.id
                                    ? 'bg-[var(--bg-primary)] text-[var(--sidebar-item-active-text)] border-[var(--border-primary)] shadow-sm'
                                    : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--gnosi-primary)] hover:bg-[var(--bg-tertiary)]'
                                    }`}
                            >
                                {view.label}
                            </button>
                        ))}
                    </div>
                </div>
            </AppHeader>

            <div className="calendar-workspace">
                {isCompact && (showLeftSidebar || showRightSidebar) && (
                    <button
                        type="button"
                        className="calendar-workspace__backdrop"
                        onClick={() => {
                            setShowLeftSidebar(false);
                            setShowRightSidebar(false);
                        }}
                        aria-label={t('common.close', 'Close')}
                    />
                )}
                {/* Barra Esquerra Col·lapsable */}
                <div className={`calendar-workspace__sidebar calendar-workspace__sidebar--left ${showLeftSidebar ? 'is-open' : ''}`}>
                    <div className="calendar-workspace__sidebar-content calendar-workspace__sidebar-content--left">
<CalendarSidebarLeft
                            calendarRef={calendarRef}
                            availableCalendars={calendarConfigs.map(c => c.source)}
                            selectedCalendars={selectedCalendars}
                            onToggleCalendar={(source) => {
                                const next = new Set(selectedCalendars);
                                if (next.has(source)) next.delete(source);
                                else next.add(source);
                                setSelectedCalendars(next);
                                // Sync the ref to prevent the effect from resetting hidden calendars
                                savedCalendarSelectionRef.current = new Set(next);
                                updateCalendarSelection({
                                    selection: Array.from(next)
                                }).catch(err => console.error('Error saving calendar selection:', err));
                            }}
                            onRenameCalendar={handleRenameCalendar}
                            onUpdateColor={handleUpdateCalendarColor}
                            onToggleSidebar={() => setShowLeftSidebar(false)}
                            onSetDefaultCalendar={async (source) => {
                                try {
                                    await updateDefaultCalendar(source);
                                    setIntegrations(prev => ({ ...prev, default_calendar: source }));
                                } catch (err) {
                                    console.error('Error saving default calendar:', err);
                                }
                            }}
                            defaultCalendar={integrations?.default_calendar}
                            calendarConfigs={calendarConfigs}
                            undatedNotes={undatedNotes}
                            onNoteClick={handleEventClick}
                        />
                    </div>
                </div>

                <div className="calendar-workspace__canvas">
                    {loading ? (
                        <div className="flex items-center justify-center h-full text-[var(--text-secondary)]" role="status" aria-live="polite">
                            {t('calendar.loading_events')}
                        </div>
                    ) : (
                        <div className="h-full">
                            <DigitalBrainCalendar
                                allNotes={[...pages, ...externalEvents]}
                                searchQuery={searchQuery}
                                selectedCalendars={selectedCalendars}
                                selectedEventId={selectedEventId}
                                onEventEdit={handleEventClick}
                                onContextMenu={handleContextMenu}
                                onRefresh={fetchPages}
                                calendarRef={calendarRef}
                                onTitleChange={setCurrentTitle}
                                onDatesSet={(range) => setDateRange(prev =>
                                    prev?.start === range.start && prev?.end === range.end ? prev : range
                                )}
                                onDateClick={(date) => {
                                    handleCreateEventAtDate(date);
                                }}
                                calendarConfigs={calendarConfigs}
                                colorMap={colorMap}
                            />
                        </div>
                    )}
                </div>

                {/* Barra Dreta Col·lapsable */}
                <div className={`calendar-workspace__sidebar calendar-workspace__sidebar--right ${showRightSidebar ? 'is-open' : ''}`}>
                    <div className="calendar-workspace__sidebar-content calendar-workspace__sidebar-content--right">
                        <CalendarSidebarRight
                            searchQuery={searchQuery}
                            onSearchChange={setSearchQuery}
                            eventPanel={eventPanel}
                            onClosePanel={() => {
                                const wasEditing = eventPanel?.mode === 'edit';
                                setEventPanel(null);
                                setSelectedEventId(null);
                                setSelectedEvent(null);
                                setIsEditingEvent(false);
                                // After editing, refresh ONCE on close so the calendar
                                // reflects the saved changes. During editing we do an optimistic
                                // optimistic (without refetching) to avoid flickering on every keystroke.
                                if (wasEditing && dateRange) {
                                    setTimeout(() => {
                                        fetchExternalEvents(dateRange.start, dateRange.end, searchQuery);
                                        fetchPages();
                                    }, 700);
                                }
                            }}
                            onSaved={handleEventSaved}
                            onRsvp={handleRsvp}
                            calendars={calendarConfigs}
                            onToggleSidebar={() => setShowRightSidebar(false)}
                            onOpenSearch={() => setIsGlobalSearchOpen(true)}
                            allNotes={pages}
                            onEventEdit={handleEventClick}
                            userEmail={integrations?.calendars?.[0]?.email || ''}
                            defaultCalendarId={defaultCalendarId}
                        />
                    </div>
                </div>
            </div>

            {/* Context menu (right click) */}
            <CalendarContextMenu
                isOpen={contextMenu.open}
                position={{ x: contextMenu.x, y: contextMenu.y }}
                onClose={closeContextMenu}
                onNewEvent={handleNewEventFromContext}
                onDeleteEvent={contextMenu.eventId ? handleDeleteFromContext : null}
            />

            <ConfirmModal 
                isOpen={isConfirmDeleteOpen}
                onClose={() => setIsConfirmDeleteOpen(false)}
                onConfirm={() => executeDelete()}
                title={t('calendar.confirm_delete_event_title', "Delete event")}
                message={t('calendar.confirm_delete_event', "Are you sure you want to delete this appointment?")}
                confirmText={t('common.delete', "Delete")}
                isDestructive={true}
            />

            <RecurrenceChoiceModal 
                isOpen={isRecurrenceChoiceOpen}
                onClose={() => setIsRecurrenceChoiceOpen(false)}
                onConfirm={executeDelete}
                title={t('calendar.recurrent_delete_title', "Delete recurring event")}
                message={t('calendar.recurrent_delete_msg', "This is a recurring event. What do you want to delete?")}
                actionType="delete"
            />

            <RecurrenceChoiceModal 
                isOpen={isRecurrenceModifyOpen}
                onClose={() => setIsRecurrenceModifyOpen(false)}
                onConfirm={executeModify}
                title={t('calendar.recurrent_modify_title', "Modify recurring event")}
                message={t('calendar.recurrent_modify_msg', "This is a recurring event. How do you want to apply the changes?")}
                actionType="modify"
            />
            <GlobalSearchModal 
                isOpen={isGlobalSearchOpen}
                onClose={() => setIsGlobalSearchOpen(false)}
                allNotes={pages}
                onNoteSelect={(id) => {
                    navigate(vaultPath('knowledge', `page/${encodeURIComponent(id)}`));
                    setIsGlobalSearchOpen(false);
                }}
            />
        </div>
    );
}
