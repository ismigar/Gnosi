import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import axios from 'axios';
import { toast } from 'react-hot-toast';
import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react';
import { AppHeader } from '../components/AppHeader';
import { DigitalBrainCalendar } from '../components/Vault/DigitalBrainCalendar';
import { CalendarSidebarLeft } from '../components/Vault/CalendarSidebarLeft';
import { CalendarSidebarRight } from '../components/Vault/CalendarSidebarRight';
import { CalendarContextMenu } from '../components/Vault/CalendarContextMenu';
import { useTranslation } from 'react-i18next';
import { GlobalSearchModal } from '../components/Vault/GlobalSearchModal';

export default function CalendarPage() {
    const { t } = useTranslation();
    const [pages, setPages] = useState([]);
    const [loading, setLoading] = useState(true);
    const [currentTitle, setCurrentTitle] = useState('');
    const [activeView, setActiveView] = useState('dayGridMonth');
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedCalendars, setSelectedCalendars] = useState(new Set());
    const [enabledTables, setEnabledTables] = useState([]); // Taules habilitades com a calendaris
    const [integrations, setIntegrations] = useState({});
    const calendarRef = useRef(null);
    const [showRightSidebar, setShowRightSidebar] = useState(true);
    const [isGlobalSearchOpen, setIsGlobalSearchOpen] = useState(false);

    // Estado de selección y edición de eventos
    const [selectedEventId, setSelectedEventId] = useState(null); // ID del evento seleccionado
    const [isEditingEvent, setIsEditingEvent] = useState(false); // Si está en modo edición
    const [selectedEvent, setSelectedEvent] = useState(null); // Event complet seleccionat

    // Panel lateral (substitueix popup modal)
    const [eventPanel, setEventPanel] = useState(null); // null | { mode, data, date, isEditing }
    // Menú contextual
    const [contextMenu, setContextMenu] = useState({
        open: false,
        x: 0,
        y: 0,
        date: '',
        eventId: null,
        instanceStart: '',
        allDay: false,
    });

    const availableCalendars = useMemo(() => {
        const sources = new Set();
        // Només afegim les taules habilitades com a fonts
        enabledTables.forEach(t => sources.add(t.name));

        // Afegim calendaris externs configurats (tot i que estiguin buits)
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

        return availableCalendars.map((s, index) => {
            const isGnosi = s === 'Gnosi' || s === 'Gnosi Vault';
            const table = enabledTables.find(t => t.name === s);
            const isTable = !!table;

            const customName = integrations?.calendar_aliases?.[s] || (table ? integrations?.calendar_aliases?.[table.id] : null);

            const integration = (isGnosi || isTable)
                ? { color: integrations?.vault_calendar?.color || (table?.color) || 'var(--gnosi-primary)' }
                : (integrations?.calendars || []).find(c =>
                    c.url === s || c.name === s || c.email === s || s.includes(c.email)
                );
            return {
                id: table?.id || s,
                source: s,
                kind: isTable ? 'table' : 'external',
                name: customName || integration?.name || null,
                color: integration?.color || (isGnosi ? 'var(--gnosi-primary)' : fallbackColors[index % fallbackColors.length])
            };
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
        if (availableCalendars.length > 0 && selectedCalendars.size === 0) {
            setSelectedCalendars(new Set(availableCalendars));
        }
    }, [availableCalendars]);

    const fetchPages = async () => {
        setLoading(true);
        try {
            const pagesTimeoutMs = 30000;
            const auxTimeoutMs = 8000;
            const [pagesRes, integrationsRes, tablesRes] = await Promise.allSettled([
                axios.get('/api/vault/pages', { timeout: pagesTimeoutMs }),
                axios.get('/api/integrations', { timeout: auxTimeoutMs }),
                axios.get('/api/vault/tables', { timeout: auxTimeoutMs }),
            ]);

            if (pagesRes.status !== 'fulfilled') {
                throw pagesRes.reason;
            }

            const integrationsData = integrationsRes.status === 'fulfilled'
                ? (integrationsRes.value.data || {})
                : {};
            setIntegrations(integrationsData);

            const enabledTableIds = integrationsData.vault_calendar?.enabled_tables || [];
            const allTables = tablesRes.status === 'fulfilled' ? (tablesRes.value.data || []) : [];

            const tables = allTables
                .filter(tbl => enabledTableIds.includes(tbl.id))
                .map(tbl => ({ id: tbl.id, name: tbl.name, type: 'table' }));
            setEnabledTables(tables);

            let data = pagesRes.value.data || [];

            data = data.filter(page => {
                const tableId = page.resolved_table_id || page.metadata?.table_id || page.metadata?.database_table_id;

                if (tableId) {
                    return enabledTableIds.includes(tableId);
                }

                const hasDate = page.metadata?.date;
                if (hasDate) {
                    return true;
                }

                const source = page.metadata?.source?.trim();
                if (source && source !== 'Gnosi' && source !== 'Gnosi Vault') {
                    return true;
                }

                return false;
            });

            setPages(data);

            if (integrationsRes.status !== 'fulfilled' || tablesRes.status !== 'fulfilled') {
                toast.error('Algunes dades auxiliars no han carregat, però el calendari està disponible.');
            }
        } catch (err) {
            console.error(err);
            toast.error("Error carregant les pàgines del calendari.");
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
                title: t('new_event', 'Nova cita'),
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
                        title: response.data.title || t('new_event', 'Nova cita'),
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
            console.error('Error creant event:', err);
            toast.error(t('event_save_error', 'Error desant la cita.'));
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
            toast.success(t('calendar_renamed_success', 'Calendari reanomenat'));
        } catch (err) {
            console.error('Error renaming calendar:', err);
            toast.error(t('calendar_rename_error', 'Error al reanomenar el calendari'));
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
            console.error('Error carregant event:', err);
            toast.error("Error carregant les dades de l'event.");
        }
    }, [selectedEventId]);

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

    // Eliminar evento desde context menu
    const handleDeleteFromContext = useCallback(async () => {
        const targetEventId = contextMenu.eventId || selectedEventId;
        if (!targetEventId) {
            toast.error('No hi ha cap event seleccionat.');
            return;
        }

        const eventData = pages.find(p => p.id === targetEventId) || selectedEvent;
        if (!eventData) {
            toast.error('No s\'ha pogut carregar l\'event.');
            return;
        }

        const isRecurrent = !!(eventData.metadata?.rrule || eventData.metadata?.recurrence);

        try {
            if (isRecurrent) {
                const choice = window.prompt(
                    "Aquest event és recurrent.\n1) Esborrar només aquesta\n2) Esborrar totes\n\nEscriu 1 o 2 (cancel per anul·lar)."
                );

                if (!choice) return;

                if (choice.trim() === '1') {
                    const occurrenceKey = buildOccurrenceKey(
                        contextMenu.instanceStart,
                        contextMenu.date,
                        contextMenu.allDay,
                        eventData.metadata || {}
                    );
                    if (!occurrenceKey) {
                        toast.error('No s\'ha pogut identificar la instància a eliminar.');
                        return;
                    }

                    const existingExdates = Array.isArray(eventData.metadata?.exdates)
                        ? eventData.metadata.exdates
                        : (typeof eventData.metadata?.exdates === 'string'
                            ? eventData.metadata.exdates.split(',').filter(Boolean)
                            : []);

                    if (!existingExdates.includes(occurrenceKey)) {
                        const patchedMetadata = {
                            ...(eventData.metadata || {}),
                            exdates: [...existingExdates, occurrenceKey],
                        };
                        await axios.patch(`/api/vault/pages/${targetEventId}`, {
                            metadata: patchedMetadata,
                        });
                    }
                    toast.success('Instància eliminada.');
                } else if (choice.trim() === '2') {
                    if (!window.confirm('Segur que vols eliminar tota la sèrie recurrent?')) return;
                    await axios.delete(`/api/vault/pages/${targetEventId}`);
                    toast.success('Sèrie recurrent eliminada.');
                } else {
                    return;
                }
            } else {
                if (!window.confirm('Segur que vols eliminar aquesta cita?')) return;
                await axios.delete(`/api/vault/pages/${targetEventId}`);
                toast.success('Cita eliminada.');
            }

            setSelectedEventId(null);
            setSelectedEvent(null);
            setEventPanel(null);
            closeContextMenu();
            await fetchPages();
        } catch (err) {
            console.error('Error eliminant event:', err);
            toast.error('Error eliminant la cita.');
        }
    }, [selectedEventId, selectedEvent, contextMenu, pages, buildOccurrenceKey, closeContextMenu]);

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
        <div className="h-full bg-slate-50 overflow-hidden flex flex-col">
            <AppHeader icon={Calendar} title={`Calendari ${currentTitle ? `- ${currentTitle}` : ''}`}>
                <div className="flex items-center gap-4">
                    {/* Navigation Controls */}
                    <div className="flex items-center gap-1 bg-surface p-0.5 rounded-lg border border-slate-200 dark:border-slate-700 shadow-sm">
                        <button onClick={handlePrev} className="p-1 text-slate-400 hover:text-gnosi hover:bg-slate-50 dark:hover:bg-slate-800 rounded transition-colors" title="Anterior">
                            <ChevronLeft size={16} strokeWidth={2.5} />
                        </button>
                        <button onClick={handleToday} className="px-3 text-[11px] font-bold uppercase tracking-tight text-slate-500 dark:text-slate-400 hover:text-gnosi hover:bg-slate-50 dark:hover:bg-slate-800 rounded transition-colors">
                            {t('today', 'Avui')}
                        </button>
                        <button onClick={handleNext} className="p-1 text-slate-400 hover:text-gnosi hover:bg-slate-50 dark:hover:bg-slate-800 rounded transition-colors" title="Següent">
                            <ChevronRight size={16} strokeWidth={2.5} />
                        </button>
                    </div>

                    {/* View Toggles */}
                    <div className="flex items-center gap-1 bg-surface p-1 rounded-lg border border-slate-200 dark:border-slate-700 shadow-sm">
                        {[
                            { id: 'dayGridMonth', label: t('month', 'Mes') },
                            { id: 'timeGridWeek', label: t('week', 'Set') },
                            { id: 'timeGridDay', label: t('day', 'Dia') }
                        ].map((view) => (
                            <button
                                key={view.id}
                                onClick={() => handleViewChange(view.id)}
                                className={`${btnClass} ${activeView === view.id
                                    ? 'bg-slate-100 dark:bg-slate-800 text-gnosi border-slate-200/60 dark:border-slate-700 shadow-sm'
                                    : 'border-transparent text-slate-400 hover:text-gnosi hover:bg-slate-50 dark:hover:bg-slate-800'
                                    }`}
                            >
                                {view.label}
                            </button>
                        ))}
                    </div>
                </div>
            </AppHeader>

            <div className="flex-1 overflow-hidden flex flex-row bg-surface">
                <CalendarSidebarLeft
                    calendarRef={calendarRef}
                    availableCalendars={availableCalendars}
                    selectedCalendars={selectedCalendars}
                    onToggleCalendar={(source) => {
                        const newSet = new Set(selectedCalendars);
                        if (newSet.has(source)) newSet.delete(source);
                        else newSet.add(source);
                        setSelectedCalendars(newSet);
                    }}
                    onRenameCalendar={handleRenameCalendar}
                    calendarConfigs={calendarConfigs}
                />
                <div className="flex-1 p-4 lg:p-5 overflow-auto">
                    {loading ? (
                        <div className="flex items-center justify-center h-full text-slate-500">
                            Cargando eventos...
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
                                onSelection={(selection) => {
                                    if (selection?.start) {
                                        handleCreateEventAtDate(selection.start);
                                    }
                                }}
                                calendarConfigs={calendarConfigs}
                                colorMap={colorMap}
                            />
                        </div>
                    )}
                </div>
                {showRightSidebar && (
                    <CalendarSidebarRight
                        searchQuery={searchQuery}
                        onSearchChange={setSearchQuery}
                        eventPanel={eventPanel}
                        onClosePanel={() => {
                            setEventPanel(null);
                            setSelectedEventId(null);
                            setSelectedEvent(null);
                            setIsEditingEvent(false);
                            // Refrescar después de cerrar el panel para mostrar cambios
                            fetchPages();
                        }}
                        onSaved={handleEventSaved}
                        calendars={calendarConfigs}
                        onToggleSidebar={() => setShowRightSidebar(false)}
                        onOpenSearch={() => setIsGlobalSearchOpen(true)}
                        allNotes={pages}
                        onEventEdit={handleEventClick}
                    />
                )}
            </div>

            {/* Menú contextual (clic dret) */}
            <CalendarContextMenu
                isOpen={contextMenu.open}
                position={{ x: contextMenu.x, y: contextMenu.y }}
                onClose={closeContextMenu}
                onNewEvent={handleNewEventFromContext}
                onDeleteEvent={contextMenu.eventId ? handleDeleteFromContext : null}
            />

            <GlobalSearchModal
                isOpen={isGlobalSearchOpen}
                onClose={() => setIsGlobalSearchOpen(false)}
                allNotes={pages}
                onNoteSelect={(id) => handleEventEdit(id)}
            />
        </div>
    );
}
