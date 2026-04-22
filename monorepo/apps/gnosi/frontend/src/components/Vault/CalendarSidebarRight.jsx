import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Search, X, CalendarPlus, Clock, MapPin, Bell, AlignLeft, Trash2, Sun, Users, UserPlus } from 'lucide-react';
import axios from 'axios';
import { toast } from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { ConfirmModal } from '../ConfirmModal';
import { RecurrenceChoiceModal } from '../Vault/RecurrenceChoiceModal';
import { buildOccurrenceKey, truncateRruleBefore } from '../../utils/calendarUtils';

const REMINDER_OPTIONS = [
    { value: '', label: 'Cap' },
    { value: '5', label: '5 minuts abans' },
    { value: '15', label: '15 minuts abans' },
    { value: '30', label: '30 minuts abans' },
    { value: '60', label: '1 hora abans' },
    { value: '1440', label: '1 dia abans' },
];

const RECURRENCE_OPTIONS = [
    { value: '', label: 'No es repeteix' },
    { value: 'DAILY', label: 'Cada dia' },
    { value: 'WEEKLY', label: 'Cada setmana' },
    { value: 'MONTHLY', label: 'Cada mes' },
    { value: 'YEARLY', label: 'Cada any' },
];

const DAYS_OF_WEEK = [
    { value: 'MO', label: 'Dll' },
    { value: 'TU', label: 'Dt' },
    { value: 'WE', label: 'Dc' },
    { value: 'TH', label: 'Dj' },
    { value: 'FR', label: 'Dv' },
    { value: 'SA', label: 'Ds' },
    { value: 'SU', label: 'Dg' },
];


export const CalendarSidebarRight = ({
    searchQuery,
    onSearchChange,
    eventPanel = null,
    onClosePanel,
    onSaved,
    onRsvp,
    calendars = [],
    onToggleSidebar,
    onOpenSearch,
    allNotes = [],
    onEventEdit,
    userEmail = '',
    defaultCalendarId = '',
}) => {
    const { t } = useTranslation();
    const [activeTab, setActiveTab] = React.useState('shortcuts'); // 'shortcuts' | 'availability'

    if (eventPanel) {
        return (
            <div className="w-72 flex-shrink-0 bg-[var(--bg-secondary)] border-l border-[var(--border-primary)] flex flex-col h-full overflow-hidden">
                <EventForm
                    mode={eventPanel.mode}
                    eventData={eventPanel.data}
                    initialDate={eventPanel.date}
                    calendars={calendars}
                    onClose={onClosePanel}
                    onSaved={onSaved}
                    onRsvp={onRsvp}
                    userEmail={userEmail}
                    defaultCalendarId={defaultCalendarId}
                />
            </div>
        );
    }

    return (
        <div className="w-64 flex-shrink-0 bg-[var(--bg-secondary)] border-l border-[var(--border-primary)] flex flex-col h-full overflow-hidden text-sm text-[var(--text-secondary)]">
            {/* Tab Header */}
            <div className="flex border-b border-[var(--border-primary)]">
                <button
                    onClick={() => setActiveTab('shortcuts')}
                    className={`flex-1 py-3 text-[11px] font-bold uppercase tracking-wider transition-colors ${activeTab === 'shortcuts' ? 'text-[var(--gnosi-primary)] border-b-2 border-[var(--gnosi-primary)]' : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]'}`}
                >
                    Shortcuts
                </button>
                <button
                    onClick={() => setActiveTab('availability')}
                    className={`flex-1 py-3 text-[11px] font-bold uppercase tracking-wider transition-colors ${activeTab === 'availability' ? 'text-[var(--gnosi-primary)] border-b-2 border-[var(--gnosi-primary)]' : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]'}`}
                >
                    Disponibilitat
                </button>
            </div>

            <div className="flex-1 overflow-y-auto">
                {activeTab === 'shortcuts' ? (
                    <DefaultContent
                        searchQuery={searchQuery}
                        onSearchChange={onSearchChange}
                        onToggleSidebar={onToggleSidebar}
                        onOpenSearch={onOpenSearch}
                        allNotes={allNotes}
                        onEventEdit={onEventEdit}
                    />
                ) : (
                    <AvailabilityTool calendars={calendars} />
                )}
            </div>
        </div>
    );
};

/* ─── Contingut per defecte (cerca + shortcuts) ─── */
const DefaultContent = ({ searchQuery, onSearchChange, onToggleSidebar, onOpenSearch, allNotes, onEventEdit }) => {
    const { t } = useTranslation();

    // Filtrem notes basant-nos en la cerca per mostrar-les aquí
    const filteredResults = React.useMemo(() => {
        if (!searchQuery.trim()) return [];
        const lower = searchQuery.toLowerCase();
        return allNotes.filter(note => {
            const title = (note.title || note.metadata?.title || '').toLowerCase();
            return title.includes(lower);
        }).slice(0, 5);
    }, [searchQuery, allNotes]);

    return (
        <div className="p-5 flex flex-col h-full">
            {/* Search */}
            <div className="flex items-center gap-2 px-2.5 py-1.5 bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-md text-[var(--text-tertiary)] shadow-sm focus-within:border-[var(--gnosi-primary)]/50 focus-within:ring-1 focus-within:ring-[var(--gnosi-primary)]/20 transition-all">
                <Search size={14} className="text-[var(--text-tertiary)]" />
                <input
                    type="text"
                    placeholder={t('calendar.search_events', 'Buscar eventos')}
                    value={searchQuery}
                    onChange={(e) => onSearchChange(e.target.value)}
                    className="flex-1 bg-transparent border-none outline-none text-[13px] placeholder:text-[var(--text-tertiary)] text-[var(--text-primary)]"
                />
                {searchQuery && (
                    <button onClick={() => onSearchChange('')} className="p-0.5 hover:bg-[var(--bg-tertiary)] rounded">
                        <X size={12} className="text-[var(--text-tertiary)]" />
                    </button>
                )}
            </div>

            {/* Resultats de cerca ràpida */}
            {searchQuery && (
                <div className="mt-4 space-y-2">
                    <h4 className="text-[11px] font-bold text-[var(--text-tertiary)] uppercase tracking-wider px-1">Resultats</h4>
                    {filteredResults.length > 0 ? (
                        filteredResults.map(res => (
                            <button
                                key={res.id}
                                onClick={() => onEventEdit?.(res.id)}
                                className="w-full text-left p-2 rounded-lg hover:bg-[var(--bg-tertiary)] transition-colors border border-transparent hover:border-[var(--border-primary)]"
                            >
                                <div className="text-[12px] font-semibold text-[var(--text-primary)] truncate">{res.title || res.metadata?.title || 'Sense Títol'}</div>
                                <div className="text-[10px] text-[var(--text-tertiary)]">{res.metadata?.date?.split('T')[0] || 'Sense data'}</div>
                            </button>
                        ))
                    ) : (
                        <div className="text-[11px] text-[var(--text-tertiary)] px-1 italic">Cap coincidència</div>
                    )}
                </div>
            )}

            <div className="mt-8">
                <h3 className="text-[13px] font-bold text-[var(--text-primary)] flex items-center justify-between mb-5">
                    {t('calendar.useful_shortcuts', 'Atajos útiles')}
                </h3>

                <div className="flex flex-col gap-2">
                    <button
                        onClick={onOpenSearch}
                        className="flex items-center justify-between w-full p-2 rounded-lg hover:bg-[var(--bg-tertiary)] transition-all group text-[12px] text-[var(--text-secondary)] font-medium"
                    >
                        <span>{t('calendar.command_menu', 'Menú de comandos')}</span>
                        <div className="flex gap-1 opacity-60 group-hover:opacity-100">
                            <kbd className="border border-[var(--border-primary)] rounded px-1.5 py-[1px] bg-[var(--bg-secondary)] text-[var(--text-tertiary)] shadow-sm">⌘</kbd>
                            <kbd className="border border-[var(--border-primary)] rounded px-1.5 py-[1px] bg-[var(--bg-secondary)] text-[var(--text-tertiary)] shadow-sm">K</kbd>
                        </div>
                    </button>

                    <button
                        onClick={onToggleSidebar}
                        className="flex items-center justify-between w-full p-2 rounded-lg hover:bg-[var(--bg-tertiary)] transition-all group text-[12px] text-[var(--text-secondary)] font-medium"
                    >
                        <span>{t('calendar.toggle_sidebar', 'Amagar barra lateral')}</span>
                        <kbd className="opacity-60 group-hover:opacity-100 border border-[var(--border-primary)] rounded px-2 py-[1px] bg-[var(--bg-secondary)] text-[var(--text-tertiary)] shadow-sm">.</kbd>
                    </button>

                    <button
                        onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: ',' }))}
                        className="flex items-center justify-between w-full p-2 rounded-lg hover:bg-[var(--bg-tertiary)] transition-all group text-[12px] text-[var(--text-secondary)] font-medium"
                    >
                        <span>{t('calendar.go_to_today', 'Anar a avui')}</span>
                        <kbd className="opacity-60 group-hover:opacity-100 border border-[var(--border-primary)] rounded px-2 py-[1px] bg-[var(--bg-secondary)] text-[var(--text-tertiary)] shadow-sm">,</kbd>
                    </button>

                </div>
            </div>
        </div>
    );
};

const RSVP_META = {
    accepted:    { label: '✓ Acceptat',  dot: 'bg-green-500',  btn: 'border-green-500 text-green-600 hover:bg-green-50 dark:hover:bg-green-950',  activeCls: 'bg-green-500 text-white border-green-500' },
    declined:    { label: '✗ Rebutjat',  dot: 'bg-red-500',    btn: 'border-red-500 text-red-600 hover:bg-red-50 dark:hover:bg-red-950',          activeCls: 'bg-red-500 text-white border-red-500' },
    tentative:   { label: '? Potser',    dot: 'bg-amber-400',  btn: 'border-amber-400 text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950',  activeCls: 'bg-amber-400 text-white border-amber-400' },
    needsAction: { label: 'Pendent',     dot: 'bg-gray-400',   btn: '', activeCls: '' },
};

/* ─── Formulari d'events (crear/editar) ─── */
const EventForm = ({ mode, eventData, initialDate, calendars, onClose, onSaved, onRsvp, userEmail = '', defaultCalendarId = '' }) => {
    const { t } = useTranslation();
    const titleRef = useRef(null);

    // Funció per normalitzar hores al format HH:mm
    const padTime = (timeStr) => {
        if (!timeStr) return '';
        const parts = timeStr.split(':');
        if (parts.length !== 2) return timeStr;
        const hours = parts[0].padStart(2, '0');
        const minutes = parts[1].padStart(2, '0');
        return `${hours}:${minutes}`;
    };

    const [title, setTitle] = useState('');
    const [allDay, setAllDay] = useState(true);
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');
    const [startTime, setStartTime] = useState('');
    const [endTime, setEndTime] = useState('');
    const [calendarId, setCalendarId] = useState('');
    const [location, setLocation] = useState('');
    const [reminder, setReminder] = useState('');
    const [recurrence, setRecurrence] = useState('');
    const [selectedDays, setSelectedDays] = useState([]);
    const [endType, setEndType] = useState('never');
    const [endCount, setEndCount] = useState(10);
    const [untilDate, setUntilDate] = useState('');
    const [description, setDescription] = useState('');

    const [attendees, setAttendees] = useState([]);
    const [attendeeInput, setAttendeeInput] = useState('');
    const [attendeeSuggestions, setAttendeeSuggestions] = useState([]);
    const attendeeSuggestTimeoutRef = useRef(null);
    const originalAttendeesRef = useRef([]);

    const [saving, setSaving] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [saveError, setSaveError] = useState(false);
    const isInitializing = useRef(true);
    const lastSavedData = useRef(null);
    const autoSaveTimeoutRef = useRef(null);
    const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
    const [isRecurrenceDeleteOpen, setIsRecurrenceDeleteOpen] = useState(false);
    const [isRecurrenceModifyOpen, setIsRecurrenceModifyOpen] = useState(false);

    // Poblar camps
    useEffect(() => {
        isInitializing.current = true;
        lastSavedData.current = null;

        if ((mode === 'edit' || mode === 'view') && eventData) {
            const meta = eventData.metadata || {};
            setTitle(eventData.title || meta.title || '');

            const rawDate = meta.date || meta.start_time || meta.due_date || '';
            if (rawDate.includes('T')) {
                setStartDate(rawDate.split('T')[0]);
                setStartTime(padTime(rawDate.split('T')[1]?.substring(0, 5) || ''));
                setAllDay(false);
            } else {
                setStartDate(rawDate);
                setStartTime('');
                setAllDay(true);
            }

            const rawEnd = meta.end_date || meta.end_time || '';
            if (rawEnd.includes('T')) {
                setEndDate(rawEnd.split('T')[0]);
                setEndTime(padTime(rawEnd.split('T')[1]?.substring(0, 5) || ''));
            } else {
                setEndDate(rawEnd);
                setEndTime('');
            }

            const tableId = eventData?.resolved_table_id || meta.table_id || meta.database_table_id || '';
            const hasCalendarOption = calendars.some(c => c.id === tableId);
            const fallbackCalId = defaultCalendarId || calendars[0]?.id || '';
            setCalendarId(hasCalendarOption ? tableId : fallbackCalId);
            setLocation(meta.location || '');
            setReminder(meta.reminder || '');

            // Re-populate RRULE
            const rawRrule = meta.rrule || meta.recurrence || '';
            if (rawRrule) {
                const parts = rawRrule.split(';');
                const freqPart = parts.find(p => p.startsWith('FREQ='));
                const byDayPart = parts.find(p => p.startsWith('BYDAY='));
                const countPart = parts.find(p => p.startsWith('COUNT='));
                const untilPart = parts.find(p => p.startsWith('UNTIL='));

                setRecurrence(freqPart?.split('=')[1] || '');
                setSelectedDays(byDayPart ? byDayPart.split('=')[1].split(',') : []);

                if (countPart) {
                    setEndType('count');
                    setEndCount(parseInt(countPart.split('=')[1]));
                } else if (untilPart) {
                    setEndType('until');
                    const uVal = untilPart.split('=')[1];
                    // Format YYYYMMDDTHHMMSSZ -> YYYY-MM-DD
                    setUntilDate(`${uVal.substring(0, 4)}-${uVal.substring(4, 6)}-${uVal.substring(6, 8)}`);
                } else {
                    setEndType('never');
                }
            } else {
                setRecurrence('');
                setSelectedDays([]);
                setEndType('never');
            }

            setDescription(eventData.content || '');

            const loadedAttendees = Array.isArray(meta.attendees) ? meta.attendees : [];
            setAttendees(loadedAttendees);
            originalAttendeesRef.current = loadedAttendees.map(a => a.email);
        } else {
            setTitle('');
            setStartDate(initialDate || '');
            setEndDate('');
            setStartTime('');
            setEndTime('');
            setAllDay(true);

            // Calendari predeterminat (configurat per l'usuari o primer disponible)
            const defCalId = defaultCalendarId || calendars.find(c => c.is_default)?.id || calendars[0]?.id || '';
            setCalendarId(defCalId);

            setLocation('');
            setReminder('');
            setRecurrence('');
            setSelectedDays([]);
            setEndType('never');
            setDescription('');
            setAttendees([]);
            originalAttendeesRef.current = [];
        }
        setAttendeeInput('');
        setAttendeeSuggestions([]);


        setTimeout(() => {
            titleRef.current?.focus();
            isInitializing.current = false;
        }, 150);
    }, [mode, eventData, initialDate]);

    // Autosave en cada modificació (debounced) quan l'event ja existeix
    useEffect(() => {
        if (isInitializing.current || saving || deleting) return;
        if (mode !== 'edit' || !eventData?.id) return;
        if (!title.trim() || !startDate) return;

        const currentData = {
            title, allDay, startDate, endDate, startTime, endTime,
            calendarId, location, reminder, recurrence, selectedDays,
            endType, endCount, untilDate, description
        };
        const currentStr = JSON.stringify(currentData);

        // Primer render després de carregar dades: establir baseline sense desar
        if (lastSavedData.current === null) {
            lastSavedData.current = currentStr;
            return;
        }

        if (lastSavedData.current === currentStr) return;

        if (autoSaveTimeoutRef.current) {
            clearTimeout(autoSaveTimeoutRef.current);
        }

        autoSaveTimeoutRef.current = setTimeout(() => {
            handleSubmit(null, true, currentStr);
        }, 450);

        return () => {
            if (autoSaveTimeoutRef.current) {
                clearTimeout(autoSaveTimeoutRef.current);
            }
        };
    }, [
        mode, eventData, title, allDay, startDate, endDate, startTime, endTime,
        calendarId, location, reminder, recurrence, selectedDays,
        endType, endCount, untilDate, description, saving, deleting
    ]);

    // Legacy hook: kept as no-op because autosave now happens on every change
    const handleFieldBlur = () => {};

    // Keyboard Shortcuts: Delete and Escape
    useEffect(() => {
        const handleKey = (e) => {
            // Escape to deselect/close
            if (e.key === 'Escape') {
                onClose?.();
                return;
            }

            // Delete to remove event (only if not focused on input/textarea)
            if (e.key === 'Delete' || e.key === 'Backspace' && (e.metaKey || e.ctrlKey)) {
                const active = document.activeElement;
                const isInput = active.tagName === 'INPUT' || active.tagName === 'TEXTAREA';
                if (!isInput && mode === 'edit' && eventData?.id) {
                    const isGoogleEvent = eventData?.metadata?.source === 'google' || (eventData?.id && eventData.id.length > 20 && !eventData.id.includes('-'));
                    if (isGoogleEvent) {
                        toast.error(t('calendar.external_event_delete_warning', 'No es poden eliminar cites de Google Calendar des de Gnosi.'));
                        return;
                    }
                    setIsDeleteConfirmOpen(true);
                }
            }
        };
        window.addEventListener('keydown', handleKey);
        return () => window.removeEventListener('keydown', handleKey);
    }, [onClose, mode, eventData]);

    // ─── Attendees helpers ────────────────────────────────────────────────────
    const handleAttendeeInputChange = useCallback((val) => {
        setAttendeeInput(val);
        setAttendeeSuggestions([]);
        if (attendeeSuggestTimeoutRef.current) clearTimeout(attendeeSuggestTimeoutRef.current);
        if (val.trim().length < 2) return;
        attendeeSuggestTimeoutRef.current = setTimeout(async () => {
            try {
                const res = await axios.get(`/api/calendar/attendees/search?q=${encodeURIComponent(val.trim())}`);
                setAttendeeSuggestions(res.data || []);
            } catch {
                setAttendeeSuggestions([]);
            }
        }, 300);
    }, []);

    const addAttendee = useCallback((contact) => {
        const email = (contact.email || '').trim().toLowerCase();
        if (!email || !email.includes('@')) return;
        setAttendees(prev => prev.some(a => a.email.toLowerCase() === email)
            ? prev
            : [...prev, { email, name: contact.name || '', rsvp: 'needsAction' }]
        );
        setAttendeeInput('');
        setAttendeeSuggestions([]);
    }, []);

    const addAttendeeFromInput = useCallback(() => {
        addAttendee({ email: attendeeInput, name: '' });
    }, [attendeeInput, addAttendee]);

    const removeAttendee = useCallback((email) => {
        setAttendees(prev => prev.filter(a => a.email !== email));
    }, []);

    // ─────────────────────────────────────────────────────────────────────────

    const buildDatetime = (date, time) => {
        if (!date) return null;
        if (!allDay && time) return `${date}T${time}:00`;
        return date;
    };

    const handleSubmit = async (e, silent = true, snapshot = null, isSeries = false, isInstanceOnly = false, isFollowing = false) => {
        if (e) e.preventDefault();
        if (!title.trim() || !startDate) return;

        // Si és un guardat manual (no silent) d'un event recurrent i no hem triat encara
        const isRecurrent = !!(eventData?.metadata?.rrule || eventData?.metadata?.recurrence);
        if (!silent && isRecurrent && !isSeries && !isInstanceOnly && !isFollowing) {
            setIsRecurrenceModifyOpen(true);
            return;
        }

        setSaving(true);
        setSaveError(false);

        const fullStart = buildDatetime(startDate, startTime);
        const fullEnd = buildDatetime(endDate, endTime);

        const metadata = {
            date: fullStart,
            source: 'Gnosi',
            all_day: allDay,
            exdates: eventData?.metadata?.exdates || [],
        };
        if (fullEnd) metadata.end_date = fullEnd;
        if (location.trim()) metadata.location = location.trim();
        if (reminder) metadata.reminder = reminder;
        if (attendees.length > 0) metadata.attendees = attendees;

        if (recurrence) {
            let rruleParts = [`FREQ=${recurrence}`];
            if (recurrence === 'WEEKLY' && selectedDays.length > 0) {
                rruleParts.push(`BYDAY=${selectedDays.join(',')}`);
            }
            if (endType === 'count') {
                rruleParts.push(`COUNT=${endCount}`);
            } else if (endType === 'until' && untilDate) {
                const compactUntil = untilDate.replace(/-/g, '') + 'T235959Z';
                rruleParts.push(`UNTIL=${compactUntil}`);
            }
            metadata.rrule = rruleParts.join(';');
        } else {
            metadata.rrule = null;
        }

        if (calendarId) {
            const cal = calendars.find(c => c.id === calendarId);
            if (cal?.kind === 'table') {
                metadata.table_id = calendarId;
                metadata.database_table_id = calendarId;
                metadata.table_name = cal.name;
                metadata.database_table_name = cal.name;
            } else if (cal?.source) {
                metadata.source = cal.source;
            }
        }

        try {
            if (mode === 'edit' && eventData?.id) {
                if (isInstanceOnly) {
                    // 1. Afegeix EXDATE al master
                    const instanceDate = eventData.metadata?.date;
                    const occurrenceKey = buildOccurrenceKey(instanceDate, null, eventData.metadata?.all_day, eventData.metadata || {});
                    
                    const existingExdates = Array.isArray(eventData.metadata?.exdates)
                        ? eventData.metadata.exdates
                        : (typeof eventData.metadata?.exdates === 'string'
                            ? eventData.metadata.exdates.split(',').filter(Boolean)
                            : []);
                    
                    await axios.patch(`/api/vault/pages/${eventData.id}`, {
                        metadata: {
                            exdates: [...new Set([...existingExdates, occurrenceKey])],
                        }
                    });

                    // 2. Crea nova cita única
                    const newMetadata = { ...metadata, rrule: null, exdates: [] };
                    const response = await axios.post('/api/vault/pages', {
                        title: title.trim(),
                        content: description.trim() || '',
                        metadata: newMetadata,
                    });
                    onSaved?.(response.data);
                    onClose?.();
                    toast.success(t('calendar.instance_updated'));
                } else if (isFollowing) {
                    // 1. Truncar la rrule del mestre antic
                    const newRruleOldMaster = truncateRruleBefore(eventData.metadata?.rrule, eventData.metadata?.date);
                    await axios.patch(`/api/vault/pages/${eventData.id}`, {
                        metadata: { rrule: newRruleOldMaster }
                    });

                    // 2. Crear un nou mestre que comenci en la nova data
                    const newMetadata = {
                        ...(eventData.metadata || {}),
                        ...metadata,
                        exdates: [],
                    };
                    delete newMetadata.id;

                    const response = await axios.post('/api/vault/pages', {
                        title: title.trim(),
                        content: description.trim() || '',
                        metadata: newMetadata,
                    });
                    onSaved?.(response.data);
                    onClose?.();
                    toast.success(t('calendar.series_split_updated'));
                } else {
                    // Patch normal (o tota la sèrie)
                    const response = await axios.patch(`/api/vault/pages/${eventData.id}`, {
                        title: title.trim(),
                        content: description.trim() || undefined,
                        metadata,
                    });
                    
                    if (!silent) toast.success(t('calendar.event_updated', 'Cita actualitzada!'));
                    onSaved?.(response.data);
                    if (!silent) onClose?.();
                }
            } else {
                // Create logic
                const response = await axios.post('/api/vault/pages', {
                    title: title.trim(),
                    content: description.trim() || '',
                    metadata,
                });
                if (!silent) toast.success(t('calendar.event_created', 'Cita creada!'));
                onSaved?.(response.data);
                if (!silent) onClose?.();
            }
            
            lastSavedData.current = snapshot || JSON.stringify({
                title, allDay, startDate, endDate, startTime, endTime,
                calendarId, location, reminder, recurrence, selectedDays,
                endType, endCount, untilDate, description
            });
        } catch (err) {
            console.error('Error desant event:', err);
            setSaveError(true);
            if (!silent) toast.error(t('calendar.event_save_error', 'Error desant la cita.'));
            if (silent && snapshot) lastSavedData.current = snapshot;
        } finally {
            setSaving(false);
            setIsRecurrenceModifyOpen(false);
        }
    };

    const handleDelete = async (isSeries = false, isInstanceOnly = false, isFollowing = false) => {
        if (!eventData?.id) return;

        // Si és recurrent i no hem triat, obrim el modal
        const isRecurrent = !!(eventData.metadata?.rrule || eventData.metadata?.recurrence);
        if (isRecurrent && !isSeries && !isInstanceOnly && !isFollowing) {
            setIsRecurrenceDeleteOpen(true);
            return;
        }

        setDeleting(true);
        try {
            if (isInstanceOnly) {
                // Lògica d'esborrat d'instància
                const occurrenceKey = buildOccurrenceKey(
                    eventData.metadata?.date,
                    null,
                    eventData.metadata?.all_day,
                    eventData.metadata || {}
                );

                const existingExdates = Array.isArray(eventData.metadata?.exdates)
                    ? eventData.metadata.exdates
                    : (typeof eventData.metadata?.exdates === 'string'
                        ? eventData.metadata.exdates.split(',').filter(Boolean)
                        : []);

                await axios.patch(`/api/vault/pages/${eventData.id}`, {
                    metadata: {
                        exdates: [...new Set([...existingExdates, occurrenceKey])],
                    }
                });
                toast.success(t('calendar.instance_deleted'));
            } else if (isFollowing) {
                // Split: Truncar la rrule del mestre perquè acabi abans d'avui
                const newRrule = truncateRruleBefore(eventData.metadata?.rrule, eventData.metadata?.date);
                await axios.patch(`/api/vault/pages/${eventData.id}`, {
                    metadata: { rrule: newRrule }
                });
                toast.success(t('calendar.following_deleted', 'Sèrie truncada des d\'avui.'));
            } else {
                await axios.delete(`/api/vault/pages/${eventData.id}`);
                toast.success(t('calendar.event_deleted', 'Cita eliminada.'));
            }
            onSaved?.();
            onClose?.();
        } catch (err) {
            console.error('Error eliminant event:', err);
            const errorMsg = err.response?.data?.detail || err.message || '';
            toast.error(`${t('calendar.event_delete_error', 'Error eliminant la cita.')} ${errorMsg}`);
        } finally {
            setDeleting(false);
            setIsRecurrenceDeleteOpen(false);
        }
    };

    const isViewMode = mode === 'view';
    const inputClass = `w-full bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg px-2.5 py-1.5 text-[13px] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--gnosi-primary)]/30 focus:border-[var(--gnosi-primary)] transition-all ${isViewMode ? 'disabled:cursor-not-allowed disabled:opacity-60 disabled:bg-[var(--bg-tertiary)]' : ''}`;
    const labelClass = "flex items-center gap-1.5 text-[11px] font-semibold text-[var(--text-tertiary)] uppercase tracking-wide mb-1";

    return (
        <div className="flex flex-col h-full">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-primary)] bg-[var(--bg-tertiary)]">
                <div className="flex items-center gap-2">
                    <button onClick={onClose} className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] p-1 rounded-lg transition-colors">
                        <X size={16} />
                    </button>
                    <span className="text-[13px] font-semibold text-[var(--text-primary)]">
                        {mode === 'create' ? t('calendar.new_event', 'Nova cita') : t('calendar.edit_event', 'Editar cita')}
                    </span>
                </div>
                <div className="flex items-center gap-1" />
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-4 space-y-3">
                {/* Títol */}
                <div>
                    <label className={labelClass}>{t('calendar.event_title', 'Títol')}</label>
                    <input
                        ref={titleRef}
                        type="text"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        onBlur={handleFieldBlur}
                        placeholder={t('calendar.event_title_placeholder', "Reunió, Cita mèdica...")}
                        className={inputClass}
                        required
                    />
                </div>

                {/* Tot el dia */}
                <div className="flex items-center justify-between py-1">
                    <label className="flex items-center gap-1.5 text-[12px] font-medium text-[var(--text-secondary)]">
                        <Sun size={14} className="text-amber-500" />
                        {t('calendar.all_day', 'Tot el dia')}
                    </label>
                    <button
                        type="button"
                        onClick={() => {
                            setAllDay(!allDay);
                            setTimeout(() => handleFieldBlur(), 100);
                        }}
                        className={`relative w-9 h-5 rounded-full transition-colors ${allDay ? 'bg-[var(--gnosi-primary)]' : 'bg-[var(--bg-tertiary)] border border-[var(--border-primary)]'}`}
                    >
                        <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${allDay ? 'left-[18px]' : 'left-0.5'}`} />
                    </button>
                </div>

                {/* Dates */}
                <div className="grid grid-cols-2 gap-2">
                    <div>
                        <label className={labelClass}>
                            <CalendarPlus size={10} />
                            {t('calendar.start', 'Inici')}
                        </label>
                        <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} onBlur={handleFieldBlur} className={inputClass} required />
                    </div>
                    <div>
                        <label className={labelClass}>
                            <CalendarPlus size={10} />
                            {t('calendar.end', 'Fi')} <span className="text-[var(--text-tertiary)] font-normal normal-case">{t('calendar.opt', '(opc.)')}</span>
                        </label>
                        <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} onBlur={handleFieldBlur} className={inputClass} min={startDate} />
                    </div>
                </div>

                {/* Hores (ocult si "Tot el dia") */}
                {!allDay && (
                    <div className="grid grid-cols-2 gap-2">
                        <div>
                            <label className={labelClass}>
                                <Clock size={10} />
                                {t('calendar.start_time', 'Hora inici')}
                            </label>
                            <input type="time" value={startTime} onChange={(e) => setStartTime(padTime(e.target.value))} onBlur={handleFieldBlur} className={inputClass} />
                        </div>
                        <div>
                            <label className={labelClass}>
                                <Clock size={10} />
                                {t('calendar.end_time', 'Hora fi')}
                            </label>
                            <input type="time" value={endTime} onChange={(e) => setEndTime(padTime(e.target.value))} onBlur={handleFieldBlur} className={inputClass} />
                        </div>
                    </div>
                )}

                {/* Calendari (Taules habilitades i calendaris) */}
                <div>
                    <label className={labelClass}>
                        <CalendarPlus size={10} />
                        {t('calendar.label', 'Calendari')}
                    </label>
                    <select value={calendarId} onChange={(e) => setCalendarId(e.target.value)} onBlur={handleFieldBlur} className={inputClass}>
                        {calendars.map(cal => (
                            <option key={cal.id} value={cal.id}>{cal.name}</option>
                        ))}
                    </select>
                </div>

                {/* Ubicació */}
                <div>
                    <label className={labelClass}>
                        <MapPin size={10} />
                        {t('calendar.location', 'Ubicació / URL')}
                    </label>
                    <input
                        type="text"
                        value={location}
                        onChange={(e) => setLocation(e.target.value)}
                        onBlur={handleFieldBlur}
                        placeholder={t('calendar.location_placeholder', "Sala 3, https://meet.google...")}
                        className={inputClass}
                    />
                </div>

                {/* Recordatori */}
                <div>
                    <label className={labelClass}>
                        <Bell size={10} />
                        {t('calendar.reminder', 'Recordatori')}
                    </label>
                    <select value={reminder} onChange={(e) => setReminder(e.target.value)} onBlur={handleFieldBlur} className={inputClass}>
                        {REMINDER_OPTIONS.map(opt => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                    </select>
                </div>

                {/* Convidats */}
                <div className="space-y-1.5">
                    <label className={labelClass}>
                        <Users size={10} />
                        {t('calendar.attendees', 'Convidats')}
                    </label>

                    {isViewMode ? (
                        /* ── Visualització (events externs) ── */
                        <div className="space-y-1">
                            {attendees.length === 0 ? (
                                <p className="text-[11px] text-[var(--text-tertiary)] italic px-0.5">Sense convidats</p>
                            ) : (
                                <>
                                    {attendees.map((att, i) => {
                                        const meta = RSVP_META[att.rsvp] || RSVP_META.needsAction;
                                        return (
                                            <div key={i} className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-primary)]">
                                                <div className="flex items-center gap-1.5 min-w-0">
                                                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${meta.dot}`} />
                                                    <div className="min-w-0">
                                                        <div className="text-[11px] font-semibold text-[var(--text-primary)] truncate">{att.name || att.email}</div>
                                                        {att.name && <div className="text-[10px] text-[var(--text-tertiary)] truncate">{att.email}</div>}
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-1 flex-shrink-0">
                                                    {att.organizer && <span className="text-[9px] bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-300 px-1.5 py-0.5 rounded-full font-bold">org</span>}
                                                    <span className="text-[9px] text-[var(--text-tertiary)]">{meta.label}</span>
                                                </div>
                                            </div>
                                        );
                                    })}

                                    {/* Botons RSVP si l'usuari és convidat */}
                                    {attendees.some(a => a.self) && (() => {
                                        const self = attendees.find(a => a.self);
                                        return (
                                            <div className="flex gap-1 mt-1.5">
                                                {['accepted', 'tentative', 'declined'].map(rv => {
                                                    const m = RSVP_META[rv];
                                                    const isActive = self.rsvp === rv;
                                                    return (
                                                        <button
                                                            key={rv}
                                                            type="button"
                                                            onClick={() => onRsvp?.(rv)}
                                                            className={`flex-1 py-1 text-[10px] font-bold rounded border transition-colors ${isActive ? m.activeCls : m.btn}`}
                                                        >
                                                            {rv === 'accepted' ? '✓ Acceptar' : rv === 'tentative' ? '? Potser' : '✗ Rebutjar'}
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        );
                                    })()}
                                </>
                            )}
                        </div>
                    ) : (
                        /* ── Edició / Creació ── */
                        <div className="space-y-1.5">
                            {/* Chips d'attendees existents */}
                            {attendees.length > 0 && (
                                <div className="flex flex-wrap gap-1">
                                    {attendees.map((att, i) => (
                                        <div key={i} className="flex items-center gap-1 pl-2 pr-1 py-0.5 bg-[var(--gnosi-primary)]/10 border border-[var(--gnosi-primary)]/25 rounded-full">
                                            <span className="text-[11px] text-[var(--gnosi-primary)] font-medium truncate max-w-[110px]" title={att.email}>
                                                {att.name || att.email}
                                            </span>
                                            <button type="button" onClick={() => removeAttendee(att.email)}
                                                className="text-[var(--gnosi-primary)]/60 hover:text-red-500 transition-colors flex-shrink-0">
                                                <X size={10} />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}

                            {/* Input + autocomplete */}
                            <div className="relative">
                                <div className="flex gap-1">
                                    <input
                                        type="text"
                                        value={attendeeInput}
                                        onChange={e => handleAttendeeInputChange(e.target.value)}
                                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addAttendeeFromInput(); } if (e.key === 'Escape') setAttendeeSuggestions([]); }}
                                        placeholder="Afegir per email o nom..."
                                        className={`${inputClass} flex-1`}
                                    />
                                    <button type="button" onClick={addAttendeeFromInput}
                                        disabled={!attendeeInput.includes('@')}
                                        className="px-2 py-1 bg-[var(--gnosi-primary)]/10 hover:bg-[var(--gnosi-primary)]/20 text-[var(--gnosi-primary)] rounded-lg border border-[var(--gnosi-primary)]/25 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
                                        <UserPlus size={13} />
                                    </button>
                                </div>

                                {attendeeSuggestions.length > 0 && (
                                    <div className="absolute top-full left-0 right-0 z-50 bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg shadow-xl mt-0.5 overflow-hidden">
                                        {attendeeSuggestions.map((s, i) => (
                                            <button key={i} type="button" onMouseDown={e => { e.preventDefault(); addAttendee(s); }}
                                                className="w-full text-left px-3 py-1.5 hover:bg-[var(--bg-secondary)] transition-colors border-b border-[var(--border-primary)] last:border-none">
                                                <div className="text-[12px] font-semibold text-[var(--text-primary)] truncate">{s.name || s.email}</div>
                                                {s.name && <div className="text-[10px] text-[var(--text-tertiary)] truncate">{s.email}</div>}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>

                {/* Repetició */}
                <div className="space-y-2">
                    <label className={labelClass}>
                        <CalendarPlus size={10} />
                        {t('calendar.recurrence', 'Repetició')}
                    </label>
                    <select value={recurrence} onChange={(e) => {
                        setRecurrence(e.target.value);
                        setTimeout(() => handleFieldBlur(), 100);
                    }} className={inputClass}>
                        {RECURRENCE_OPTIONS.map(opt => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                    </select>

                    {recurrence === 'WEEKLY' && (
                        <div className="flex flex-wrap gap-1 mt-2">
                            {DAYS_OF_WEEK.map(day => (
                                <button
                                    key={day.value}
                                    type="button"
                                    onClick={() => {
                                        setSelectedDays(prev =>
                                            prev.includes(day.value)
                                                ? prev.filter(d => d !== day.value)
                                                : [...prev, day.value]
                                        );
                                    }}
                                    className={`w-7 h-7 text-[10px] font-bold rounded-md border transition-all ${selectedDays.includes(day.value)
                                        ? 'bg-[var(--gnosi-primary)] text-white border-[var(--gnosi-primary)]'
                                        : 'bg-[var(--bg-primary)] text-[var(--text-secondary)] border-[var(--border-primary)]'
                                        }`}
                                >
                                    {day.label}
                                </button>
                            ))}
                        </div>
                    )}

                    {recurrence && (
                        <div className="mt-2 p-2.5 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-primary)] space-y-2">
                            <label className="text-[10px] font-bold text-[var(--text-tertiary)] uppercase tracking-tight">{t('calendar.ends', 'Finalitza')}</label>

                            <div className="flex flex-col gap-1.5">
                                <label className="flex items-center gap-2 cursor-pointer group">
                                    <input
                                        type="radio"
                                        name="endType"
                                        checked={endType === 'never'}
                                        onChange={() => {
                                            setEndType('never');
                                            setTimeout(() => handleFieldBlur(), 100);
                                        }}
                                        className="w-3 h-3 accent-[var(--gnosi-primary)]"
                                    />
                                    <span className="text-[12px] text-[var(--text-secondary)] group-hover:text-[var(--text-primary)] transition-colors">Mai</span>
                                </label>

                                <label className="flex items-center gap-2 cursor-pointer group">
                                    <input
                                        type="radio"
                                        name="endType"
                                        checked={endType === 'count'}
                                        onChange={() => {
                                            setEndType('count');
                                            setTimeout(() => handleFieldBlur(), 100);
                                        }}
                                        className="w-3 h-3 accent-[var(--gnosi-primary)]"
                                    />
                                    <div className="flex items-center gap-1.5 flex-1">
                                        <span className="text-[12px] text-[var(--text-secondary)]">Després de</span>
                                        <input
                                            type="number"
                                            min="1"
                                            value={endCount}
                                            onChange={(e) => {
                                                setEndCount(e.target.value);
                                                setEndType('count');
                                            }}
                                            onBlur={handleFieldBlur}
                                            className="w-12 h-6 bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded text-[11px] px-1 text-center focus:outline-none focus:ring-1 focus:ring-[var(--gnosi-primary)]"
                                        />
                                        <span className="text-[12px] text-[var(--text-secondary)]">vegades</span>
                                    </div>
                                </label>

                                <label className="flex items-center gap-2 cursor-pointer group">
                                    <input
                                        type="radio"
                                        name="endType"
                                        checked={endType === 'until'}
                                        onChange={() => {
                                            setEndType('until');
                                            setTimeout(() => handleFieldBlur(), 100);
                                        }}
                                        className="w-3 h-3 accent-[var(--gnosi-primary)]"
                                    />
                                    <div className="flex items-center gap-1.5 flex-1">
                                        <span className="text-[12px] text-[var(--text-secondary)]">El dia</span>
                                        <input
                                            type="date"
                                            value={untilDate}
                                            onChange={(e) => {
                                                setUntilDate(e.target.value);
                                                setEndType('until');
                                            }}
                                            onBlur={handleFieldBlur}
                                            className="flex-1 h-6 bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded text-[10px] px-1.5 focus:outline-none focus:ring-1 focus:ring-[var(--gnosi-primary)]"
                                        />
                                    </div>
                                </label>
                            </div>
                        </div>
                    )}
                </div>


                {/* Descripció */}
                <div className="pb-4">
                    <label className={labelClass}>
                        <AlignLeft size={10} />
                        {t('calendar.description', 'Descripció')}
                    </label>
                    <textarea
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        onBlur={handleFieldBlur}
                        placeholder={t('calendar.event_description_placeholder', "Afegeix detalls...")}
                        rows={2}
                        className={`${inputClass} resize-none`}
                    />
                </div>
            </form>

            {/* Footer */}
            <div className="px-4 py-2 border-t border-[var(--border-primary)] bg-[var(--bg-tertiary)] flex items-center justify-between gap-2">
                <div className={`text-[10px] italic ${saveError ? 'text-red-500' : 'text-[var(--text-tertiary)]'}`}>
                    {saving ? t('calendar.saving', 'Desant...') : deleting ? t('calendar.deleting', 'Eliminant...') : saveError ? '⚠ Error desant' : t('calendar.saved', 'Guardat')}
                </div>
                <div className="flex gap-1.5">
                    {mode === 'edit' && eventData?.id && (
                        <button
                            type="button"
                            onClick={() => setIsDeleteConfirmOpen(true)}
                            disabled={deleting || saving}
                            className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold rounded-lg border border-red-500/40 text-red-500 hover:bg-red-500/10 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                        >
                            <Trash2 size={12} />
                            {t('common.delete', 'Eliminar')}
                        </button>
                    )}
                    <button
                        type="submit"
                        onClick={(e) => handleSubmit(e, false)}
                        disabled={saving || deleting}
                        className="flex items-center gap-1 px-3 py-1.5 text-[11px] font-bold rounded-lg bg-[var(--gnosi-primary)] text-white hover:bg-[var(--gnosi-primary-hover)] disabled:opacity-50 transition-all shadow-sm"
                    >
                        {saving ? t('calendar.saving', 'Desant...') : t('common.save', 'Guardar')}
                    </button>
                </div>
            </div>

            <ConfirmModal 
                isOpen={isDeleteConfirmOpen}
                onClose={() => setIsDeleteConfirmOpen(false)}
                onConfirm={() => handleDelete(false, false)} // Per defecte esborra tot si es confirma aquí (si no és recurrent)
                title={t('calendar.confirm_delete_event_title', 'Eliminar cita')}
                message={t('calendar.confirm_delete_event', 'Segur que vols eliminar aquesta cita?')}
                confirmText={t('common.delete', 'Eliminar')}
                isDestructive={true}
            />

            <RecurrenceChoiceModal 
                isOpen={isRecurrenceDeleteOpen}
                onClose={() => setIsRecurrenceDeleteOpen(false)}
                onConfirm={handleDelete}
                title={t('calendar.recurrent_delete_title', 'Esborrar cita recurrent')}
                message={t('calendar.recurrent_delete_msg', 'Aquesta és una cita repetitiva. Què vols eliminar?')}
                actionType="delete"
            />

            <RecurrenceChoiceModal 
                isOpen={isRecurrenceModifyOpen}
                onClose={() => setIsRecurrenceModifyOpen(false)}
                onConfirm={(isSeries, isInstanceOnly, isFollowing) => handleSubmit(null, false, null, isSeries, isInstanceOnly, isFollowing)}
                title={t('calendar.recurrent_modify_title', 'Modificar cita recurrent')}
                message={t('calendar.recurrent_modify_msg', 'Aquesta és una cita repetitiva. Com vols aplicar els canvis?')}
                actionType="modify"
            />
        </div>
    );
};

/* ─── Eina de Disponibilitat (Availability Tool) ─── */
const AvailabilityTool = ({ calendars }) => {
    const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
    const [loading, setLoading] = useState(false);
    const [freeSlots, setFreeSlots] = useState([]);

    const checkAvailability = async () => {
        const email = calendars.find(c => c.type === 'external')?.name;
        if (!email) {
            toast.error("No hi ha cap compte de correu configurat.");
            return;
        }

        setLoading(true);
        try {
            const timeMin = `${date}T00:00:00Z`;
            const timeMax = `${date}T23:59:59Z`;

            const res = await axios.post(`/api/calendar/freebusy?email=${encodeURIComponent(email)}`, {
                time_min: timeMin,
                time_max: timeMax,
                calendar_ids: ['primary']
            });

            const busy = res.data.calendars.primary.busy || [];

            const slots = [];
            let current = new Date(`${date}T09:00:00`);
            const end = new Date(`${date}T18:00:00`);

            while (current < end) {
                const slotEnd = new Date(current.getTime() + 30 * 60000);
                const isBusy = busy.some(b => {
                    const bStart = new Date(b.start);
                    const bEnd = new Date(b.end);
                    return (current < bEnd && slotEnd > bStart);
                });

                if (!isBusy) {
                    slots.push({
                        start: current.toTimeString().substring(0, 5),
                        end: slotEnd.toTimeString().substring(0, 5)
                    });
                }
                current = slotEnd;
            }
            setFreeSlots(slots);
        } catch (err) {
            console.error(err);
            toast.error("Error consultant disponibilitat.");
        } finally {
            setLoading(false);
        }
    };

    const copySlotsAsText = () => {
        if (freeSlots.length === 0) return;
        const text = `Hola! Estic disponible el dia ${date} en aquests horaris:\n` +
            freeSlots.map(s => `- ${s.start} a ${s.end}`).join('\n') +
            ` \n\nQuin et va millor?`;
        navigator.clipboard.writeText(text);
        toast.success("Horaris copiats al porta-retalls!");
    };

    return (
        <div className="p-5 space-y-6">
            <div className="space-y-4">
                <div>
                    <label className="text-[11px] font-bold text-[var(--text-tertiary)] uppercase tracking-wider mb-2 block">{t('calendar.availability.date_label')}</label>
                    <input
                        type="date"
                        value={date}
                        onChange={(e) => setDate(e.target.value)}
                        className="w-full bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] focus:ring-2 focus:ring-[var(--gnosi-primary)]/20 outline-none transition-all"
                    />
                </div>

                <div className="pt-2">
                    <button
                        onClick={checkAvailability}
                        disabled={loading}
                        className="btn btn-gnosi-primary w-full"
                    >
                        {loading ? t('calendar.availability.searching') : t('calendar.availability.search_btn')}
                    </button>
                </div>
            </div>

            {freeSlots.length > 0 && (
                <div className="space-y-4 animate-in fade-in slide-in-from-top-2">
                    <div className="flex items-center justify-between">
                        <h4 className="text-[11px] font-bold text-[var(--text-tertiary)] uppercase tracking-wider">{t('calendar.availability.free_slots')}</h4>
                        <button onClick={copySlotsAsText} className="text-[10px] text-[var(--gnosi-primary)] hover:underline font-bold uppercase transition-all">{t('calendar.availability.copy_text')}</button>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                        {freeSlots.map((s, i) => (
                            <div key={i} className="px-2 py-1.5 bg-[var(--bg-tertiary)] border border-[var(--border-primary)] rounded text-[11px] text-[var(--text-primary)] font-medium text-center shadow-sm">
                                {s.start} - {s.end}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            <div className="pt-4 border-t border-[var(--border-primary)]">
                <p className="text-[10px] text-[var(--text-tertiary)] italic">{t('calendar.availability.sync_info')}</p>
            </div>
        </div>
    );
};
