import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import axios from 'axios';
import { toast } from '../lib/toast';
import { Calendar, ChevronLeft, ChevronRight, PanelLeft, PanelRight, Circle, Trash2 } from 'lucide-react';
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

// Keyboard handler removed in favor of RecurrenceChoiceModal component

export default function CalendarPage() {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const [pages, setPages] = useState([]);           // notes vault locals (source=Gnosi)
    const [externalEvents, setExternalEvents] = useState([]); // events de Google/CalDAV
    const [googleCalendars, setGoogleCalendars] = useState([]); // calendaris reals de Google (id, name, account)
    const [undatedNotes, setUndatedNotes] = useState([]);
    const [dateRange, setDateRange] = useState(null);  // { start, end } del rang visible
    const [loading, setLoading] = useState(true);
    const [currentTitle, setCurrentTitle] = useState('');
    const [activeView, setActiveView] = useState('dayGridMonth');
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedCalendars, setSelectedCalendars] = useState(new Set());
    const [enabledTables, setEnabledTables] = useState([]); // Enabled tables as calendars
    const [integrations, setIntegrations] = useState({});
    const calendarRef = useRef(null);
    // Ref que guarda la selecció original del servidor (per restaurar fonts async com sub-calendaris)
    const savedCalendarSelectionRef = useRef(undefined);
    const [showLeftSidebar, setShowLeftSidebar] = useState(true);
    const [showRightSidebar, setShowRightSidebar] = useState(true);
    const [isGlobalSearchOpen, setIsGlobalSearchOpen] = useState(false);
    const [partialData, setPartialData] = useState(false);

    // Estado de selección y edición de eventos
    const [selectedEventId, setSelectedEventId] = useState(null); // ID del evento seleccionado
    const [isEditingEvent, setIsEditingEvent] = useState(false); // Si está en modo edición
    const [selectedEvent, setSelectedEvent] = useState(null); // Event complet seleccionat

    // Side panel (replaces popup modal)
    const [eventPanel, setEventPanel] = useState(null); // null | { mode, data, date, isEditing }

    // Menú contextual
    const [contextMenu, setContextMenu] = useState({
        open: false,
        x: 0,
        y: 0,
        date: '',
        eventId: null,
        instanceStart: '',
        allDay: false
    });

    // Estats de supressió
    const [isConfirmDeleteOpen, setIsConfirmDeleteOpen] = useState(false);
    const [isRecurrenceChoiceOpen, setIsRecurrenceChoiceOpen] = useState(false);
    const [isRecurrenceModifyOpen, setIsRecurrenceModifyOpen] = useState(false);
    const [pendingDeleteId, setPendingDeleteId] = useState(null);
    const [pendingModify, setPendingModify] = useState(null); // { id, patchData, action, instanceStart }

    const availableCalendars = useMemo(() => {
        const sources = new Set();
        enabledTables.forEach(t => sources.add(t.name));

        (integrations?.calendars || []).forEach(c => {
            const src = c.email || c.name || c.url;
            if (src) sources.add(src);
        });

        // Fonts de les notes vault locals
        pages.forEach(p => {
            const s = (p.metadata?.source || '').trim();
            if (!s || s === 'Gnosi' || s === 'Gnosi Vault') return;
            if (s !== 'es_es' && !s.includes('holidays')) sources.add(s);
        });

        // Fonts dels events externs híbrids
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

            // Resol el calendari real de Google (calendar_id + provider) per crear-hi events de debò
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
        // Fallbacks clau per notes locals
        const vaultColor = integrations?.vault_calendar?.color || 'var(--gnosi-primary)';
        if (!map['Gnosi']) map['Gnosi'] = vaultColor;
        if (!map['Gnosi Vault']) map['Gnosi Vault'] = vaultColor;
        return map;
    }, [calendarConfigs, integrations]);

    // Initial selection: restaura la visibilitat guardada, inclús per fonts async (sub-calendaris)
    useEffect(() => {
        if (calendarConfigs.length === 0) return;

        // Inicialitzar la ref amb la selecció guardada (només la primera vegada que integrations té dades)
        if (savedCalendarSelectionRef.current === undefined && Object.keys(integrations).length > 0) {
            const raw = integrations?.calendar_selection;
            if (Array.isArray(raw) && raw.length > 0) {
                savedCalendarSelectionRef.current = new Set(raw);
            } else if (raw?.selection && Array.isArray(raw.selection) && raw.selection.length > 0) {
                savedCalendarSelectionRef.current = new Set(raw.selection);
            } else {
                savedCalendarSelectionRef.current = null; // null = cap selecció guardada → mostrar tot
            }
        }

        const savedSet = savedCalendarSelectionRef.current;

        // Afegir fonts que hagin d'estar seleccionades però encara no ho estan
        setSelectedCalendars(prev => {
            const next = new Set(prev);
            let changed = false;
            calendarConfigs.forEach(cfg => {
                if (!next.has(cfg.source)) {
                    // Afegir si: no hi ha selecció guardada (mostrar tot) o estava a la selecció guardada
                    if (savedSet === null || savedSet === undefined || savedSet.has(cfg.source)) {
                        next.add(cfg.source);
                        changed = true;
                    }
                    // Si estava explícitament amagat (no és a savedSet) → no afegir
                }
            });
            return changed ? next : prev;
        });
    }, [calendarConfigs, integrations]);

    // Converteix un event híbrid (Google/CalDAV) al format allNotes que espera DigitalBrainCalendar
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
            // camps interns per distingir vault vs extern
            _provider: ev.provider,
            _account: ev.account,
            _calendar_id: ev.calendar_id,
            _calendar_name: ev.calendar_name,
            _vault_path: ev.vault_path || null,
            recurring_event_id: ev.recurring_event_id || null,
        },
    });

    // Fetch d'events externs (Google Calendar / CalDAV) pel rang visible.
    // Si canvia el rang/cerca mentre una request està en vol, s'avorta la
    // anterior per evitar que setExternalEvents rebi dades obsoletes (race).
    const externalEventsAbortRef = useRef(null);
    const fetchExternalEvents = async (timeMin, timeMax, search = '') => {
        if (externalEventsAbortRef.current) {
            externalEventsAbortRef.current.abort();
        }
        const controller = new AbortController();
        externalEventsAbortRef.current = controller;
        try {
            const params = { include_vault: false };
            if (timeMin) params.time_min = timeMin;
            if (timeMax) params.time_max = timeMax;
            if (search) params.search = search;
            const res = await axios.get('/api/calendar/events', {
                params,
                timeout: 30000,
                signal: controller.signal,
            });
            if (controller.signal.aborted) return;
            const converted = (res.data || []).map(convertHybridEvent);
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
            const [pagesRes, integrationsRes, tablesRes] = await Promise.allSettled([
                axios.get('/api/vault/pages', { params: { only_calendar: true }, timeout }),
                axios.get('/api/integrations', { timeout }),
                axios.get('/api/vault/tables', { timeout }),
            ]);

            if (pagesRes.status !== 'fulfilled') throw pagesRes.reason;

            const integrationsData = integrationsRes.status === 'fulfilled'
                ? (integrationsRes.value.data || {}) : null;
            const hasIntegrations = integrationsData !== null;
            const safeIntegrations = integrationsData || {};
            setIntegrations(safeIntegrations);

            const enabledTableIds = safeIntegrations.vault_calendar?.enabled_tables || [];
            const allTables = tablesRes.status === 'fulfilled' ? (tablesRes.value.data || []) : [];
            const tables = allTables
                .filter(tbl => !hasIntegrations || enabledTableIds.includes(tbl.id))
                .map(tbl => ({ id: tbl.id, name: tbl.name, type: 'table' }));
            setEnabledTables(tables);

            const allData = pagesRes.value.data || [];
            const dated = [];
            const undated = [];

            allData.forEach(page => {
                const tableId = page.resolved_table_id || page.metadata?.table_id || page.metadata?.database_table_id;
                if (tableId && hasIntegrations && !enabledTableIds.includes(tableId)) return;

                const hasDate = page.metadata?.date;
                const source = (page.metadata?.source || '').trim();
                // Excloure events de proveïdors externs (ara venen de l'API híbrida)
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

    // Carrega els calendaris reals de Google (id/account) per poder crear-hi events de debò
    useEffect(() => {
        let cancelled = false;
        axios.get('/api/calendar/calendars')
            .then(res => { if (!cancelled) setGoogleCalendars(Array.isArray(res.data) ? res.data : []); })
            .catch(() => { if (!cancelled) setGoogleCalendars([]); });
        return () => { cancelled = true; };
    }, []);

    // Avortar la request d'events externs si el component es desmunta.
    useEffect(() => {
        return () => {
            if (externalEventsAbortRef.current) {
                externalEventsAbortRef.current.abort();
                externalEventsAbortRef.current = null;
            }
        };
    }, []);

    // Re-fetch events externs quan canvia el rang de dates o la cerca
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
        // Obre el formulari en mode creació SENSE crear encara la cita: només es desa
        // quan l'usuari hi posa un títol (l'autosave del formulari ho gestiona). Així
        // s'eviten els esborranys "Nova cita" buits si es tanca sense escriure res.
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

            await axios.put('/api/integrations/calendar_aliases', updatedAliases);
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

            await axios.put('/api/integrations/calendar_colors', updatedColors);
            setIntegrations(updatedIntegrations);
            toast.success(t('calendar.calendar_color_updated_success'));
        } catch (err) {
            console.error('Error updating calendar color:', err);
            toast.error(t('calendar.calendar_color_update_error'));
        }
    };

    // Shortcuts de teclat
    useEffect(() => {
        const handleKeyDown = (e) => {
            // Cmd+K -> Cerca global
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

    // Clic en evento → obre panel d'edició (vault) o de detall (extern)
    const handleEventClick = useCallback(async (pageId, patchData = null, action = null) => {
        // Si ens passen patchData i action, és una modificació directa (drag/resize)
        if (patchData && action) {
            const event = pages.find(p => p.id === pageId) || externalEvents.find(ev => ev.id === pageId);
            if (!event) return;

            const isRecurrent = !!(event.metadata?.rrule || event.metadata?.recurrence);
            if (isRecurrent) {
                setPendingModify({ id: pageId, patchData, action, instanceStart: patchData.instanceStart });
                setIsRecurrenceModifyOpen(true);
                return;
            }

            // Si no és recurrent, apliquem el patch directament
            try {
                await axios.patch(`/api/vault/pages/${pageId}`, { metadata: patchData });
                toast.success(t('calendar.event_updated', 'Cita actualitzada!'));
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

        // Comprovar si és un event extern (Google/CalDAV)
        const externalEv = externalEvents.find(ev => ev.id === pageId);
        if (externalEv) {
            // Les cites de Google pròpies (no de només lectura) s'obren en mode edició perquè
            // es puguin editar (es desen amb PATCH a Google); les compartides/read-only i la
            // resta d'externs, en mode lectura.
            const m = externalEv.metadata || {};
            const isEditableGoogle = (m._provider === 'google' || !!m._account) && !m._vault_path && !m.readonly;
            setSelectedEventId(pageId);
            setSelectedEvent(externalEv);
            setIsEditingEvent(isEditableGoogle);
            setShowRightSidebar(true);
            setEventPanel({ mode: isEditableGoogle ? 'edit' : 'view', data: externalEv, date: '', isEditing: isEditableGoogle, isExternal: true });
            return;
        }

        // Event de vault → carrega pàgina completa per editar
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

    // Menú contextual (clic dret)
    const handleContextMenu = useCallback(({ x, y, date, eventId = null, instanceStart = '', allDay = false }) => {
        // Si s'ha fet clic sobre un event, seleccionar-lo i buscar les seves dades
        if (eventId) {
            setSelectedEventId(eventId);
            const event = pages.find(p => p.id === eventId);
            setSelectedEvent(event || null);
        }
        setContextMenu({ open: true, x, y, date, eventId, instanceStart, allDay });
    }, [pages]);

    // Obrir panel en mode crear des del context menu
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

    // Eliminar evento desde context menu (reforçat amb ID directe)
    const handleDeleteFromContext = useCallback((forcedId = null) => {
        const targetEventId = forcedId || contextMenu.eventId || selectedEventId;
        if (!targetEventId) return;

        const eventData = pages.find(p => p.id === targetEventId) || selectedEvent;
        if (!eventData) return;

        // Guàrdia d'origen
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
                // Split: Truncar la rrule del mestre perquè acabi abans d'avui
                const newRrule = truncateRruleBefore(eventData.metadata?.rrule, contextMenu.instanceStart);
                await axios.patch(`/api/vault/pages/${targetEventId}`, {
                    metadata: { rrule: newRrule }
                });
                toast.success(t('calendar.following_deleted', 'Sèrie truncada des d\'avui.'));
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

    const executeModify = async (isSeries = false, isInstanceOnly = false, isFollowing = false) => {
        const { id, patchData, action, instanceStart } = pendingModify;
        if (!id || !patchData) return;

        const eventData = pages.find(p => p.id === id) || selectedEvent;
        if (!eventData) return;

        try {
            if (isInstanceOnly) {
                // 1. Afegir instància actual a EXDATE
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

                // 2. Crear nova cita única amb les noves dades
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

                toast.success(t('calendar.instance_updated', 'Instància actualitzada!'));
            } else if (isFollowing) {
                // 1. Truncar la rrule del mestre antic
                const newRruleOldMaster = truncateRruleBefore(eventData.metadata?.rrule, instanceStart);
                await axios.patch(`/api/vault/pages/${id}`, {
                    metadata: { rrule: newRruleOldMaster }
                });

                // 2. Crear un nou mestre que comenci en la nova data
                const newMetadata = {
                    ...(eventData.metadata || {}),
                    ...patchData, // Inclou la nova date i end_date
                    exdates: [],
                    // rrule es manté el mateix (sense el truncament)
                };
                delete newMetadata.id;

                await axios.post('/api/vault/pages', {
                    title: eventData.title,
                    content: eventData.content || '',
                    metadata: newMetadata,
                });

                toast.success(t('calendar.series_split_updated', 'Sèrie dividida i actualitzada!'));
            } else {
                // Modificar tota la sèrie (el master)
                await axios.patch(`/api/vault/pages/${id}`, {
                    metadata: patchData
                });
                toast.success(t('calendar.series_updated', 'Sèrie actualitzada!'));
            }

            setIsRecurrenceModifyOpen(false);
            setPendingModify(null);
            await fetchPages();
        } catch (err) {
            console.error('Error modifying recurrent event:', err);
            toast.error(t('calendar.event_save_error'));
        }
    };

    // Callback quan es desa un event - actualizar solo ese evento en el estado local
    const handleEventSaved = useCallback((updatedEvent) => {
        if (updatedEvent) {
            const m = updatedEvent.metadata || {};
            const isGoogle = (m._provider === 'google' || !!m._account) && !m._vault_path;
            if (isGoogle) {
                // Actualització optimista d'un event extern (Google): actualitza NOMÉS aquest
                // event, sense refetch, per no recarregar tot el calendari a cada tecla.
                setExternalEvents(prev => prev.map(ev =>
                    ev.id === updatedEvent.id
                        ? { ...ev, ...updatedEvent, metadata: { ...ev.metadata, ...(updatedEvent.metadata || {}) } }
                        : ev
                ));
            } else {
                // Actualització optimista (Vault)
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
                        // Event nou: afegir
                        return [...prevPages, updatedEvent];
                    }
                });
            }

            // Si l'event actualitzat és el seleccionat, actualitzar selectedEvent també
            if (selectedEventId === updatedEvent.id) {
                setSelectedEvent(prevEvent => ({
                    ...prevEvent,
                    ...updatedEvent,
                    metadata: updatedEvent.metadata || prevEvent?.metadata,
                }));
            }
        } else {
            // Si no es passa cap event, refresca-ho tot: Vault i també els events de
            // Google (les operacions a Google criden onSaved() sense argument).
            fetchPages();
            if (dateRange) fetchExternalEvents(dateRange.start, dateRange.end, searchQuery);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedEventId, dateRange, searchQuery]);

    // RSVP: acceptar/rebutjar/potser una invitació de Google Calendar
    const handleRsvp = useCallback(async (rsvpStatus) => {
        if (!eventPanel) return;
        const eventId = eventPanel.data?.id;
        const meta = eventPanel.data?.metadata || {};
        const calId = meta._calendar_id || 'primary';
        const acct = meta._account;
        if (!eventId || !acct) return;

        try {
            await axios.post(`/api/calendar/events/${eventId}/rsvp`, {
                email: acct,
                calendar_id: calId,
                rsvp: rsvpStatus,
            });
            // Actualitzar estat local sense re-fetch
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
            const label = rsvpStatus === 'accepted' ? '✓ Invitació acceptada'
                : rsvpStatus === 'declined' ? '✗ Invitació rebutjada'
                : '? Marcat com a potser';
            toast.success(label);
        } catch (err) {
            console.error('handleRsvp error:', err);
            toast.error(t('calendar.rsvp_error', 'Error actualitzant la resposta.'));
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

    const btnClass = "flex items-center justify-center h-7 px-3 rounded-md text-[11px] font-bold tracking-tight uppercase transition-all border";

    return (
        <div className="h-full bg-[var(--bg-primary)] overflow-hidden flex flex-col">
            <AppHeader icon={Calendar} title={`${t('calendar.title')} ${currentTitle ? `- ${currentTitle}` : ''}`}>
                <div className="flex items-center gap-4">
                    {/* Toggles de Panells Laterals */}
                    <div className="flex items-center gap-1 bg-[var(--bg-secondary)] p-0.5 rounded-lg border border-[var(--border-primary)] shadow-sm">
                        <button 
                            onClick={() => {
                                setShowLeftSidebar(!showLeftSidebar);
                                setTimeout(() => calendarRef.current?.getApi().updateSize(), 350);
                            }}
                            className={`p-1.5 rounded transition-all ${showLeftSidebar ? 'text-[var(--gnosi-primary)] bg-[var(--gnosi-primary)]/10' : 'text-[var(--text-tertiary)] hover:bg-[var(--bg-tertiary)]'}`}
                            title={showLeftSidebar ? "Amagar barra esquerra" : "Mostrar barra esquerra"}
                        >
                            <PanelLeft size={16} strokeWidth={2.5} />
                        </button>
                        <div className="w-px h-3 bg-[var(--border-primary)] mx-0.5" />
                        <button 
                            onClick={() => {
                                setShowRightSidebar(!showRightSidebar);
                                setTimeout(() => calendarRef.current?.getApi().updateSize(), 350);
                            }}
                            className={`p-1.5 rounded transition-all ${showRightSidebar ? 'text-[var(--gnosi-primary)] bg-[var(--gnosi-primary)]/10' : 'text-[var(--text-tertiary)] hover:bg-[var(--bg-tertiary)]'}`}
                            title={showRightSidebar ? "Amagar barra dreta" : "Mostrar barra dreta"}
                        >
                            <PanelRight size={16} strokeWidth={2.5} />
                        </button>
                    </div>

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
                            { id: 'multiMonthYear', label: t('calendar.view_year', 'Any') },
                            { id: 'dayGridMonth', label: t('calendar.view_month') },
                            { id: 'timeGridWeek', label: t('calendar.view_week') },
                            { id: 'timeGridDay', label: t('calendar.view_day') }
                        ].map((view) => (
                            <button
                                key={view.id}
                                onClick={() => handleViewChange(view.id)}
                                className={`${btnClass} ${activeView === view.id
                                    ? 'bg-[var(--bg-primary)] text-[var(--gnosi-primary)] border-[var(--border-primary)] shadow-sm'
                                    : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--gnosi-primary)] hover:bg-[var(--bg-tertiary)]'
                                    }`}
                            >
                                {view.label}
                            </button>
                        ))}
                    </div>
                </div>
            </AppHeader>

            <div className="flex-1 overflow-hidden flex flex-row bg-[var(--bg-primary)]">
                {/* Barra Esquerra Col·lapsable */}
                <div className={`transition-all duration-300 ease-in-out overflow-hidden flex border-r border-[var(--border-primary)] ${showLeftSidebar ? 'w-64 opacity-100' : 'w-0 opacity-0 border-none'}`}>
                    <div className="min-w-[16rem]">
<CalendarSidebarLeft
                            calendarRef={calendarRef}
                            availableCalendars={calendarConfigs.map(c => c.source)}
                            selectedCalendars={selectedCalendars}
                            onToggleCalendar={(source) => {
                                const next = new Set(selectedCalendars);
                                if (next.has(source)) next.delete(source);
                                else next.add(source);
                                setSelectedCalendars(next);
                                // Sincronitzar la ref per evitar que l'efecte reiniciï calendaris amagats
                                savedCalendarSelectionRef.current = new Set(next);
                                axios.put('/api/integrations/calendar_selection', {
                                    selection: Array.from(next)
                                }).catch(err => console.error('Error desant la selecció de calendaris:', err));
                            }}
                            onRenameCalendar={handleRenameCalendar}
                            onUpdateColor={handleUpdateCalendarColor}
                            onToggleSidebar={() => setShowLeftSidebar(false)}
                            onSetDefaultCalendar={async (source) => {
                                try {
                                    await axios.put('/api/integrations/default_calendar', { source });
                                    setIntegrations(prev => ({ ...prev, default_calendar: source }));
                                } catch (err) {
                                    console.error('Error desant calendari predeterminat:', err);
                                }
                            }}
                            defaultCalendar={integrations?.default_calendar}
                            calendarConfigs={calendarConfigs}
                            undatedNotes={undatedNotes}
                            onNoteClick={handleEventClick}
                        />
                    </div>
                </div>

                <div className="flex-1 p-4 lg:p-5 overflow-hidden relative">
                    {loading ? (
                        <div className="flex items-center justify-center h-full text-slate-500">
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
                <div className={`transition-all duration-300 ease-in-out overflow-hidden flex border-l border-[var(--border-primary)] ${showRightSidebar ? 'w-80 opacity-100' : 'w-0 opacity-0 border-none'}`}>
                    <div className="min-w-[20rem]">
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
                                // Després d'editar, refresca UN sol cop en tancar perquè el calendari
                                // reflecteixi els canvis desats. Durant l'edició fem actualització
                                // optimista (sense refetch) per evitar el parpadeig a cada tecla.
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

            {/* Menú contextual (clic dret) */}
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
                title={t('calendar.confirm_delete_event_title', 'Eliminar cita')}
                message={t('calendar.confirm_delete_event', 'Segur que vols eliminar aquesta cita?')}
                confirmText={t('common.delete', 'Eliminar')}
                isDestructive={true}
            />

            <RecurrenceChoiceModal 
                isOpen={isRecurrenceChoiceOpen}
                onClose={() => setIsRecurrenceChoiceOpen(false)}
                onConfirm={executeDelete}
                title={t('calendar.recurrent_delete_title', 'Esborrar cita recurrent')}
                message={t('calendar.recurrent_delete_msg', 'Aquesta és una cita repetitiva. Què vols eliminar?')}
                actionType="delete"
            />

            <RecurrenceChoiceModal 
                isOpen={isRecurrenceModifyOpen}
                onClose={() => setIsRecurrenceModifyOpen(false)}
                onConfirm={executeModify}
                title={t('calendar.recurrent_modify_title', 'Modificar cita recurrent')}
                message={t('calendar.recurrent_modify_msg', 'Aquesta és una cita repetitiva. Com vols aplicar els canvis?')}
                actionType="modify"
            />
            <GlobalSearchModal 
                isOpen={isGlobalSearchOpen}
                onClose={() => setIsGlobalSearchOpen(false)}
                allNotes={pages}
                onNoteSelect={(id) => {
                    navigate(`/vault?id=${id}`);
                    setIsGlobalSearchOpen(false);
                }}
            />
        </div>
    );
}
