import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import axios from 'axios';
import { toast } from 'react-hot-toast';
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

export default function CalendarPage() {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const [pages, setPages] = useState([]);
    const [undatedNotes, setUndatedNotes] = useState([]);
    const [loading, setLoading] = useState(true);
    const [currentTitle, setCurrentTitle] = useState('');
    const [activeView, setActiveView] = useState('dayGridMonth');
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedCalendars, setSelectedCalendars] = useState(new Set());
    const [enabledTables, setEnabledTables] = useState([]); // Enabled tables as calendars
    const [integrations, setIntegrations] = useState({});
    const calendarRef = useRef(null);
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
    const [pendingDeleteId, setPendingDeleteId] = useState(null);

    const availableCalendars = useMemo(() => {
        const sources = new Set();
        // Només afegim les taules habilitades com a fonts
        enabledTables.forEach(t => sources.add(t.name));

        (integrations?.calendars || []).forEach(c => {
            const src = c.email || c.name || c.url;
            if (src) sources.add(src);
        });

        pages.forEach(p => {
            let s = p.metadata?.source?.trim();
            if (!s || s === 'Gnosi' || s === 'Gnosi Vault') return;

            if (s !== 'es_es' && !s.includes('holidays')) {
                sources.add(s);
            }
        });
        return Array.from(sources);
    }, [pages, enabledTables, integrations]);

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

            return {
                id: table?.id || s,
                source: s,
                kind: isTable ? 'table' : 'external',
                name: customName || subName || integration?.name || s,
                account: account,
                color: customColor || integration?.color || (isGnosi ? 'var(--gnosi-primary)' : fallbackColors[index % fallbackColors.length])
            };
        });

        // Filter out "Base" sources if a more specific "Account - Summary" source exists for the same account
        const specificAccounts = new Set(configs.filter(c => c.source.includes(' - ')).map(c => c.account));
        return configs.filter(c => {
            if (specificAccounts.has(c.source) && !c.source.includes(' - ')) {
                return false; // Skip the generic email entry if we have specific sub-calendars
            }
            return true;
        });
    }, [availableCalendars, integrations, enabledTables]);

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

    // Initial selection
    useEffect(() => {
        if (calendarConfigs.length > 0 && selectedCalendars.size === 0) {
            // Prioritzar la selecció guardada al backend
            const savedSelection = integrations?.calendar_selection;
            
            // Suportar tant llista directa com {selection: [...]}
            let finalSelection = null;
            if (Array.isArray(savedSelection)) {
                finalSelection = savedSelection;
            } else if (savedSelection && typeof savedSelection === 'object' && Array.isArray(savedSelection.selection)) {
                finalSelection = savedSelection.selection;
            }

            if (finalSelection && finalSelection.length > 0) {
                // Filtrar per assegurar que les fonts encara són vàlides a les dades actuals
                const validSelection = finalSelection.filter(s => 
                    calendarConfigs.some(c => c.source === s)
                );
                if (validSelection.length > 0) {
                    setSelectedCalendars(new Set(validSelection));
                    return;
                }
            }
            // Fallback: seleccionar-los tots
            setSelectedCalendars(new Set(calendarConfigs.map(c => c.source)));
        }
    }, [calendarConfigs, integrations]);

    const fetchPages = async () => {
        setLoading(true);
        try {
            const pagesTimeoutMs = 120000; // Increased to 120s for slow OneDrive scans
            const auxTimeoutMs = 120000;   // Increased to 120s to match pages timeout during heavy sync
            const [pagesRes, integrationsRes, tablesRes] = await Promise.allSettled([
                axios.get('/api/vault/pages', { params: { only_calendar: true }, timeout: pagesTimeoutMs }),
                axios.get('/api/integrations', { timeout: auxTimeoutMs }),
                axios.get('/api/vault/tables', { timeout: auxTimeoutMs }),
            ]);

            if (pagesRes.status !== 'fulfilled') {
                throw pagesRes.reason;
            }

            const integrationsData = integrationsRes.status === 'fulfilled'
                ? (integrationsRes.value.data || {})
                : null; // Use null to detect failure
            
            const hasIntegrations = integrationsData !== null;
            const safeIntegrations = integrationsData || {};
            setIntegrations(safeIntegrations);

            const enabledTableIds = safeIntegrations.vault_calendar?.enabled_tables || [];
            const allTables = tablesRes.status === 'fulfilled' ? (tablesRes.value.data || []) : [];

            const tables = allTables
                .filter(tbl => !hasIntegrations || enabledTableIds.includes(tbl.id))
                .map(tbl => ({ id: tbl.id, name: tbl.name, type: 'table' }));
            setEnabledTables(tables);

            let allData = pagesRes.value.data || [];
            
            // Separate Dated vs Undated
            const dated = [];
            const undated = [];

            allData.forEach(page => {
                const tableId = page.resolved_table_id || page.metadata?.table_id || page.metadata?.database_table_id;
                
                // Filtering by enabled tables
                if (tableId && hasIntegrations && !enabledTableIds.includes(tableId)) {
                    return;
                }

                const hasDate = page.metadata?.date;
                const source = page.metadata?.source?.trim();
                const isExternal = source && source !== 'Gnosi' && source !== 'Gnosi Vault';

                if (hasDate || isExternal) {
                    dated.push(page);
                } else {
                    // Only keep in undated if it's explicitly in the Calendar folder
                    // or has some calendar metadata but missed the date
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

    const handleCreateEventAtDate = useCallback(async (clickedDate) => {
        try {
            const hasTime = clickedDate instanceof Date && (clickedDate.getHours() !== 0 || clickedDate.getMinutes() !== 0);
            const metadata = {
                date: hasTime ? formatLocalDateTime(clickedDate) : formatLocalDate(clickedDate),
                source: 'Gnosi',
                all_day: !hasTime,
            };

            const response = await axios.post('/api/vault/pages', {
                title: t('calendar.new_event'),
                content: '',
                metadata,
            });

            let createdEvent = response.data;
            if (response.data?.id) {
                try {
                    const fullRes = await axios.get(`/api/vault/pages/${response.data.id}`);
                    createdEvent = fullRes.data;
                } catch (loadErr) {
                    // Fallback: mantenim una forma mínima compatible fins que arribi un refresh
                    createdEvent = {
                        id: response.data.id,
                        title: response.data.title || t('calendar.new_event'),
                        content: '',
                        metadata,
                    };
                }
            }

            setPages(prevPages => [...prevPages, createdEvent]);
            setSelectedEventId(createdEvent.id);
            setSelectedEvent(createdEvent);
            setIsEditingEvent(true);
            setEventPanel({ mode: 'edit', data: createdEvent, date: '', isEditing: true });
        } catch (err) {
            console.error('Error creating event:', err);
            toast.error(t('calendar.event_save_error'));
        }
    }, [t]);

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

    // Clic en evento → abre directamente en modo edición
    const handleEventClick = useCallback(async (pageId) => {
        try {
            // toggle selection when clicking same event
            if (selectedEventId === pageId) {
                setSelectedEventId(null);
                setSelectedEvent(null);
                setIsEditingEvent(false);
                setEventPanel(null);
                return;
            }
            const res = await axios.get(`/api/vault/pages/${pageId}`);
            setSelectedEventId(pageId);
            setSelectedEvent(res.data);
            setIsEditingEvent(true);
            setEventPanel({ mode: 'edit', data: res.data, date: '', isEditing: true });
        } catch (err) {
            console.error('Error loading event:', err);
            toast.error(t('calendar.error_loading_event_data'));
        }
    }, [selectedEventId, t]);

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

    const buildOccurrenceKey = useCallback((instanceStart, dateOnly, allDay, eventMeta) => {
        const eventIsAllDay = allDay || !!eventMeta?.all_day || !(eventMeta?.date || '').includes('T');
        const sourceValue = instanceStart || dateOnly || '';
        if (!sourceValue) return '';
        if (eventIsAllDay) {
            return sourceValue.split('T')[0];
        }
        const dt = new Date(sourceValue);
        if (Number.isNaN(dt.getTime())) {
            // Fallback robust si startStr ja és local sense timezone
            const base = sourceValue.split('+')[0].split('Z')[0];
            const hhmm = base.includes('T') ? base.split('T')[1]?.slice(0, 5) : '00:00';
            const day = base.split('T')[0];
            return `${day}T${hhmm}:00`;
        }
        const y = dt.getFullYear();
        const m = String(dt.getMonth() + 1).padStart(2, '0');
        const d = String(dt.getDate()).padStart(2, '0');
        const h = String(dt.getHours()).padStart(2, '0');
        const min = String(dt.getMinutes()).padStart(2, '0');
        return `${y}-${m}-${d}T${h}:${min}:00`;
    }, []);

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

    const executeDelete = async (isSeries = false, isInstanceOnly = false) => {
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
            } else {
                // Delete event or full series
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

    // Callback quan es desa un event - actualizar solo ese evento en el estado local
    const handleEventSaved = useCallback((updatedEvent) => {
        if (updatedEvent) {
            // Actualització optimista
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
            
            // Si l'event actualitzat és el seleccionat, actualitzar selectedEvent també
            if (selectedEventId === updatedEvent.id) {
                setSelectedEvent(prevEvent => ({
                    ...prevEvent,
                    ...updatedEvent,
                    metadata: updatedEvent.metadata || prevEvent?.metadata,
                }));
            }
        } else {
            // Si no se pasa evento, refrescar todo
            fetchPages();
        }
    }, [selectedEventId]);

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
                            onToggleCalendar={async (source) => {
                                setSelectedCalendars(prev => {
                                    const next = new Set(prev);
                                    if (next.has(source)) next.delete(source);
                                    else next.add(source);
                                    
                                    // Persistir al backend en format objecte 
                                    axios.put('/api/integrations/calendar_selection', { 
                                        selection: Array.from(next) 
                                    })
                                        .catch(err => console.error('Error desant la selecció de calendaris:', err));
                                    
                                    return next;
                                });
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
                                allNotes={pages}
                                searchQuery={searchQuery}
                                selectedCalendars={selectedCalendars}
                                selectedEventId={selectedEventId}
                                onEventEdit={handleEventClick}
                                onContextMenu={handleContextMenu}
                                onRefresh={fetchPages}
                                calendarRef={calendarRef}
                                onTitleChange={setCurrentTitle}
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
                                setEventPanel(null);
                                setSelectedEventId(null);
                                setSelectedEvent(null);
                                setIsEditingEvent(false);
                            }}
                            onSaved={handleEventSaved}
                            calendars={calendarConfigs}
                            onToggleSidebar={() => setShowRightSidebar(false)}
                            onOpenSearch={() => setIsGlobalSearchOpen(true)}
                            allNotes={pages}
                            onEventEdit={handleEventClick}
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

            {/* MODAL DE TRIA DE RECURRÈNCIA */}
            {isRecurrenceChoiceOpen && (
                <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-md" onClick={() => setIsRecurrenceChoiceOpen(false)} />
                    <div className="relative bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-3xl p-8 max-w-md w-full shadow-2xl animate-in zoom-in-95 duration-200">
                        <div className="flex items-center gap-4 mb-6 text-red-500">
                            <div className="p-3 bg-red-500/10 rounded-2xl"><Trash2 size={24} /></div>
                            <h3 className="text-xl font-black tracking-tight">{t('calendar.recurrent_delete_title', 'Esborrar cita recurrent')}</h3>
                        </div>
                        <p className="text-[var(--text-secondary)] mb-8 leading-relaxed">
                            {t('calendar.recurrent_delete_msg', 'Aquesta és una cita repetitiva. Què vols eliminar?')}
                        </p>
                        <div className="flex flex-col gap-3">
                            <button 
                                onClick={() => executeDelete(false, true)}
                                className="w-full p-4 rounded-2xl bg-[var(--bg-secondary)] border border-[var(--border-primary)] hover:border-[var(--gnosi-primary)] text-left transition-all group"
                            >
                                <div className="font-bold text-[var(--text-primary)] group-hover:text-[var(--gnosi-primary)]">{t('calendar.delete_instance', 'Només aquesta instància')}</div>
                                <div className="text-xs text-[var(--text-tertiary)] mt-1">{t('calendar.delete_instance_desc', 'Elimina només la cita d\'avui de la sèrie.')}</div>
                            </button>
                            <button 
                                onClick={() => executeDelete(true, false)}
                                className="w-full p-4 rounded-2xl bg-red-500/5 border border-red-500/20 hover:bg-red-500/10 text-left transition-all"
                            >
                                <div className="font-bold text-red-500">{t('calendar.delete_series', 'Tota la sèrie')}</div>
                                <div className="text-xs text-red-500/60 mt-1">{t('calendar.delete_series_desc', 'Elimina permanentment totes les repeticions.')}</div>
                            </button>
                        </div>
                        <button 
                            onClick={() => setIsRecurrenceChoiceOpen(false)}
                            className="w-full mt-6 p-4 rounded-2xl font-bold text-[var(--text-tertiary)] hover:bg-[var(--bg-secondary)] transition-all"
                        >
                            {t('common.cancel', 'Cancel·lar')}
                        </button>
                    </div>
                </div>
            )}
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
