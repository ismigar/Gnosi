import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Search, X, CalendarPlus, Clock, MapPin, Bell, AlignLeft, Trash2, Sun, Users, UserPlus, Loader2, Check, Navigation } from 'lucide-react';
import axios from 'axios';
import { toast } from '../../lib/toast';
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

const TRAVEL_TIME_OPTIONS = [
    { value: '', label: 'Cap' },
    { value: '5', label: '5 min' },
    { value: '10', label: '10 min' },
    { value: '15', label: '15 min' },
    { value: '30', label: '30 min' },
    { value: '45', label: '45 min' },
    { value: '60', label: '1 hora' },
    { value: '90', label: '1 h 30 min' },
    { value: '120', label: '2 hores' },
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
    const [locationLat, setLocationLat] = useState(null);
    const [locationLon, setLocationLon] = useState(null);
    const [locationSuggestions, setLocationSuggestions] = useState([]);
    const [locationLoading, setLocationLoading] = useState(false);
    const [locationHighlight, setLocationHighlight] = useState(-1);
    const locationSuggestTimeoutRef = useRef(null);
    const locationBlurTimeoutRef = useRef(null);
    const [reminder, setReminder] = useState('');
    const [travelTime, setTravelTime] = useState('');
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
    const flushSaveRef = useRef(() => {});
    // En mode 'create' la cita NO es crea fins que hi ha títol. createdIdRef guarda
    // l'id un cop creada perquè els autosaves següents facin PATCH (no dupliquin).
    // createdId és l'equivalent reactiu per a la UI (capçalera i botó Eliminar).
    const createdIdRef = useRef(null);
    const isCreatingRef = useRef(false);
    const [createdId, setCreatedId] = useState(null);
    // Quan la cita es crea en un calendari de Google, guardem l'id de l'event de Google
    // (+ compte i calendar_id) perquè els canvis següents facin PATCH a Google, no al Vault.
    const googleRef = useRef(null);
    const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
    const [isRecurrenceDeleteOpen, setIsRecurrenceDeleteOpen] = useState(false);
    const [isRecurrenceModifyOpen, setIsRecurrenceModifyOpen] = useState(false);

    // Poblar camps
    useEffect(() => {
        isInitializing.current = true;
        lastSavedData.current = null;
        createdIdRef.current = null;
        isCreatingRef.current = false;
        googleRef.current = null;
        setCreatedId(null);

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
            setLocationLat(meta.location_lat ?? null);
            setLocationLon(meta.location_lon ?? null);
            setReminder(meta.reminder || '');
            setTravelTime(meta.travel_time != null ? String(meta.travel_time) : '');

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
            // initialDate pot venir com a "YYYY-MM-DD" (tot el dia) o amb hora
            // ("YYYY-MM-DDTHH:mm[:ss]") si s'ha clicat una franja horària.
            const rawInit = initialDate || '';
            if (rawInit.includes('T')) {
                setStartDate(rawInit.split('T')[0]);
                setStartTime(padTime(rawInit.split('T')[1]?.substring(0, 5) || ''));
                setAllDay(false);
            } else {
                setStartDate(rawInit);
                setStartTime('');
                setAllDay(true);
            }
            setEndDate('');
            setEndTime('');

            // Calendari predeterminat (configurat per l'usuari o primer disponible)
            const defCalId = defaultCalendarId || calendars.find(c => c.is_default)?.id || calendars[0]?.id || '';
            setCalendarId(defCalId);

            setLocation('');
            setLocationLat(null);
            setLocationLon(null);
            setReminder('');
            setTravelTime('');
            setRecurrence('');
            setSelectedDays([]);
            setEndType('never');
            setDescription('');
            setAttendees([]);
            originalAttendeesRef.current = [];
        }
        setAttendeeInput('');
        setAttendeeSuggestions([]);
        setLocationSuggestions([]);
        setLocationHighlight(-1);


        setTimeout(() => {
            titleRef.current?.focus();
            isInitializing.current = false;
        }, 150);
    }, [mode, eventData, initialDate]);

    // Autosave en cada modificació (debounced). En edició desa la cita existent; en
    // creació la crea (només quan hi ha títol vàlid) i continua editant-la.
    useEffect(() => {
        if (saving || deleting) return;
        if (mode === 'view') return; // els events externs (Google) en mode lectura no s'autodesen
        if (!title.trim() || !startDate) return; // sense títol no es crea res (evita esborranys)

        const currentData = {
            title, allDay, startDate, endDate, startTime, endTime,
            calendarId, location, locationLat, locationLon, reminder, recurrence, selectedDays,
            endType, endCount, untilDate, description, attendees, travelTime
        };
        const currentStr = JSON.stringify(currentData);

        // Edició d'una cita existent: fixa la línia base amb les dades acabades de carregar
        // —encara que estiguem inicialitzant— perquè el PRIMER canvi de l'usuari ja es detecti
        // i es desi. En creació deixem la base a null perquè el primer títol vàlid dispari la
        // creació via debounce.
        if (lastSavedData.current === null) {
            if (mode === 'edit' && eventData?.id) {
                lastSavedData.current = currentStr;
                return;
            }
        }

        // No autodesar durant la inicialització (un cop fixada la línia base en edició).
        if (isInitializing.current) return;
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
        calendarId, location, locationLat, locationLon, reminder, recurrence, selectedDays,
        endType, endCount, untilDate, description, attendees, travelTime, saving, deleting
    ]);

    // Legacy hook: kept as no-op because autosave now happens on every change
    const handleFieldBlur = () => {};

    // Keyboard Shortcuts: Delete and Escape
    useEffect(() => {
        const handleKey = (e) => {
            // Escape to deselect/close
            if (e.key === 'Escape') {
                flushSaveRef.current();
                onClose?.();
                return;
            }

            // Delete to remove event (only if not focused on input/textarea)
            if (e.key === 'Delete' || (e.key === 'Backspace' && (e.metaKey || e.ctrlKey))) {
                const active = document.activeElement;
                const isInput = active.tagName === 'INPUT' || active.tagName === 'TEXTAREA';
                if (isInput) return;
                const gmeta = eventData?.metadata || {};
                const isGoogle = (gmeta._provider === 'google' || !!gmeta._account) && !gmeta._vault_path && eventData?.id;
                const canDelete = (mode === 'edit' && eventData?.id) || createdId || (isGoogle && !gmeta.readonly);
                if (canDelete) {
                    setIsDeleteConfirmOpen(true);
                } else if (isGoogle && gmeta.readonly) {
                    toast.error(t('calendar.external_event_delete_warning', 'No es pot eliminar: és una cita de només lectura.'));
                }
            }
        };
        window.addEventListener('keydown', handleKey);
        return () => window.removeEventListener('keydown', handleKey);
    }, [onClose, mode, eventData, createdId]);

    // Flush del desament pendent quan el panell es desmunta (canvi d'event, navegació...)
    useEffect(() => {
        return () => { flushSaveRef.current?.(); };
    }, []);

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

    // ─── Geocoding d'ubicació (OpenStreetMap / Photon) ─────────────────────────
    const fetchLocationSuggestions = useCallback((val) => {
        const query = (val || '').trim();
        // No geocodifiquem URLs ni consultes massa curtes
        if (query.length < 3 || /^(https?:\/\/|www\.)/i.test(query)) {
            setLocationSuggestions([]);
            setLocationLoading(false);
            return;
        }
        setLocationLoading(true);
        locationSuggestTimeoutRef.current = setTimeout(async () => {
            try {
                const res = await axios.get(`/api/calendar/geocode?q=${encodeURIComponent(query)}`);
                setLocationSuggestions(Array.isArray(res.data) ? res.data : []);
                setLocationHighlight(-1);
            } catch {
                setLocationSuggestions([]);
            } finally {
                setLocationLoading(false);
            }
        }, 350);
    }, []);

    const handleLocationChange = useCallback((val) => {
        setLocation(val);
        // L'edició manual invalida la verificació prèvia (coordenades)
        setLocationLat(null);
        setLocationLon(null);
        if (locationSuggestTimeoutRef.current) clearTimeout(locationSuggestTimeoutRef.current);
        fetchLocationSuggestions(val);
    }, [fetchLocationSuggestions]);

    const selectLocationSuggestion = useCallback((sug) => {
        if (!sug) return;
        setLocation(sug.label);
        setLocationLat(typeof sug.lat === 'number' ? sug.lat : null);
        setLocationLon(typeof sug.lon === 'number' ? sug.lon : null);
        setLocationSuggestions([]);
        setLocationHighlight(-1);
        if (locationSuggestTimeoutRef.current) clearTimeout(locationSuggestTimeoutRef.current);
    }, []);

    const handleLocationKeyDown = useCallback((e) => {
        if (locationSuggestions.length === 0) return;
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setLocationHighlight((i) => Math.min(i + 1, locationSuggestions.length - 1));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setLocationHighlight((i) => Math.max(i - 1, 0));
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (locationHighlight >= 0) selectLocationSuggestion(locationSuggestions[locationHighlight]);
        } else if (e.key === 'Escape') {
            // Tanca només el desplegable, no el panell sencer
            e.preventDefault();
            e.stopPropagation();
            setLocationSuggestions([]);
            setLocationHighlight(-1);
        }
    }, [locationSuggestions, locationHighlight, selectLocationSuggestion]);

    // ─────────────────────────────────────────────────────────────────────────

    const buildDatetime = (date, time) => {
        if (!date) return null;
        if (!allDay && time) return `${date}T${time}:00`;
        return date;
    };

    // Construeix l'event en format Google Calendar API (per a calendaris de Google)
    const buildGoogleEventData = () => {
        const tz = (typeof Intl !== 'undefined' && Intl.DateTimeFormat().resolvedOptions().timeZone) || 'Europe/Madrid';
        const ev = { summary: title.trim() };
        if (allDay) {
            ev.start = { date: startDate };
            // A Google, end.date és EXCLUSIU → +1 dia respecte l'últim dia
            const base = endDate || startDate;
            const d = new Date(`${base}T00:00:00`);
            d.setDate(d.getDate() + 1);
            const pad = (n) => String(n).padStart(2, '0');
            ev.end = { date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` };
        } else {
            const st = `${startDate}T${startTime || '00:00'}:00`;
            const en = (endDate && endTime) ? `${endDate}T${endTime}:00`
                : (endTime ? `${startDate}T${endTime}:00` : `${startDate}T${startTime || '00:00'}:00`);
            ev.start = { dateTime: st, timeZone: tz };
            ev.end = { dateTime: en, timeZone: tz };
        }
        if (location.trim()) ev.location = location.trim();
        if (description.trim()) ev.description = description.trim();
        if (attendees.length > 0) ev.attendees = attendees.map(a => ({ email: a.email, displayName: a.name || undefined }));
        if (recurrence) {
            const parts = [`FREQ=${recurrence}`];
            if (recurrence === 'WEEKLY' && selectedDays.length > 0) parts.push(`BYDAY=${selectedDays.join(',')}`);
            if (endType === 'count') parts.push(`COUNT=${endCount}`);
            else if (endType === 'until' && untilDate) parts.push(`UNTIL=${untilDate.replace(/-/g, '')}T235959Z`);
            ev.recurrence = [`RRULE:${parts.join(';')}`];
        }
        return ev;
    };

    const handleSubmit = async (e, silent = true, snapshot = null, isSeries = false, isInstanceOnly = false, isFollowing = false) => {
        if (e) e.preventDefault();
        if (!title.trim() || !startDate) return;

        // Evita una segona creació (POST) mentre la primera encara està en vol
        if (!eventData?.id && !createdIdRef.current && isCreatingRef.current) return;

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

        // ─── Editar un event de Google JA EXISTENT (reobert en mode edició) → PATCH a Google ───
        const existGm = eventData?.metadata || {};
        const isExistingGoogle = mode === 'edit' && eventData?.id && (existGm._provider === 'google' || existGm._account) && !existGm._vault_path;
        if (isExistingGoogle) {
            const formSnap = snapshot || JSON.stringify({
                title, allDay, startDate, endDate, startTime, endTime,
                calendarId, location, locationLat, locationLon, reminder, recurrence, selectedDays,
                endType, endCount, untilDate, description, attendees, travelTime
            });
            try {
                await axios.patch(
                    `/api/calendar/events/${encodeURIComponent(eventData.id)}?email=${encodeURIComponent(existGm._account)}&calendar_id=${encodeURIComponent(existGm._calendar_id || 'primary')}`,
                    {
                        summary: title.trim(),
                        location: location.trim(),
                        description: description.trim() || '',
                        start: fullStart,
                        end: fullEnd || fullStart,
                        calendar_id: existGm._calendar_id || 'primary',
                        attendees,
                    }
                );
                lastSavedData.current = formSnap;
                if (!silent) toast.success(t('calendar.event_updated', 'Cita actualitzada!'));
                onSaved?.();
                if (!silent) onClose?.();
            } catch (err) {
                console.error('Error actualitzant event de Google:', err);
                setSaveError(true);
                if (!silent) toast.error(t('calendar.event_save_error', 'Error desant la cita.'));
                if (silent && snapshot) lastSavedData.current = snapshot;
            } finally {
                setSaving(false);
            }
            return;
        }

        // ─── Calendari de Google: crear/editar l'event DE DEBÒ a Google (no al Vault) ───
        const selCal = calendars.find(c => c.id === calendarId);
        const isGoogleCal = !!(selCal && selCal.kind === 'external' && selCal.google_calendar_id && selCal.account);
        if (isGoogleCal && mode !== 'edit') {
            const formSnap = snapshot || JSON.stringify({
                title, allDay, startDate, endDate, startTime, endTime,
                calendarId, location, locationLat, locationLon, reminder, recurrence, selectedDays,
                endType, endCount, untilDate, description, attendees, travelTime
            });
            try {
                if (googleRef.current?.id) {
                    // Actualitza l'event que ja hem creat a Google en aquesta sessió
                    await axios.patch(
                        `/api/calendar/events/${encodeURIComponent(googleRef.current.id)}?email=${encodeURIComponent(googleRef.current.account)}&calendar_id=${encodeURIComponent(googleRef.current.calendar_id)}`,
                        {
                            summary: title.trim(),
                            location: location.trim(),
                            description: description.trim() || '',
                            start: fullStart,
                            end: fullEnd || fullStart,
                            calendar_id: googleRef.current.calendar_id,
                            attendees,
                        }
                    );
                } else if (!isCreatingRef.current) {
                    // Crea l'event nou a Google (guardem l'id per no duplicar-lo)
                    isCreatingRef.current = true;
                    const resp = await axios.post(
                        `/api/calendar/events?email=${encodeURIComponent(selCal.account)}&calendar_id=${encodeURIComponent(selCal.google_calendar_id)}`,
                        buildGoogleEventData()
                    );
                    if (resp.data?.id) {
                        googleRef.current = { id: resp.data.id, account: selCal.account, calendar_id: selCal.google_calendar_id };
                        setCreatedId(resp.data.id);
                        // Si la cita ja existia al Vault (canvi de calendari Tasques→Google),
                        // esborra-la perquè no quedi duplicada.
                        if (createdIdRef.current) {
                            try { await axios.delete(`/api/vault/pages/${createdIdRef.current}`); }
                            catch (delErr) { console.error('Error netejant cita duplicada al Vault:', delErr); }
                            createdIdRef.current = null;
                        }
                    }
                }
                lastSavedData.current = formSnap;
                if (!silent) toast.success(t('calendar.event_created', 'Cita creada!'));
                onSaved?.();
                if (!silent) onClose?.();
            } catch (err) {
                console.error('Error desant event a Google Calendar:', err);
                setSaveError(true);
                if (!silent) toast.error(t('calendar.event_save_error', 'Error desant la cita.'));
                if (silent && snapshot) lastSavedData.current = snapshot;
            } finally {
                setSaving(false);
                isCreatingRef.current = false;
            }
            return;
        }

        const metadata = {
            date: fullStart,
            source: 'Gnosi',
            all_day: allDay,
            exdates: eventData?.metadata?.exdates || [],
        };
        if (fullEnd) metadata.end_date = fullEnd;
        const removeMetaKeys = [];
        if (location.trim()) {
            metadata.location = location.trim();
            if (locationLat != null && locationLon != null) {
                metadata.location_lat = locationLat;
                metadata.location_lon = locationLon;
            } else {
                // Ubicació no verificada (text lliure/URL): neteja coords antigues (PATCH fa merge)
                removeMetaKeys.push('location_lat', 'location_lon');
            }
        } else {
            // Sense ubicació: neteja tot el bloc d'ubicació
            removeMetaKeys.push('location', 'location_lat', 'location_lon');
        }
        if (reminder) metadata.reminder = reminder;
        if (travelTime) metadata.travel_time = parseInt(travelTime, 10);
        else removeMetaKeys.push('travel_time');
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
            } else {
                // Calendari extern (Google): NO canviem el source a l'email del calendari.
                // fetchPages filtra tot el que no és source 'Gnosi', així que la cita
                // desapareixeria en refrescar. Mentre no hi hagi la integració per crear-la
                // realment a Google, la desem a la primera taula de Gnosi perquè romangui
                // visible i no es perdi.
                const fallbackTable = calendars.find(c => c.kind === 'table');
                if (fallbackTable) {
                    metadata.table_id = fallbackTable.id;
                    metadata.database_table_id = fallbackTable.id;
                    metadata.table_name = fallbackTable.name;
                    metadata.database_table_name = fallbackTable.name;
                }
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
                        ...(removeMetaKeys.length ? { remove_metadata_keys: removeMetaKeys } : {}),
                    });
                    
                    if (!silent) toast.success(t('calendar.event_updated', 'Cita actualitzada!'));
                    onSaved?.(response.data);
                    if (!silent) onClose?.();
                }
            } else if (createdIdRef.current) {
                // Cita ja creada en aquesta mateixa sessió: PATCH (continuem editant-la)
                const response = await axios.patch(`/api/vault/pages/${createdIdRef.current}`, {
                    title: title.trim(),
                    content: description.trim() || undefined,
                    metadata,
                    ...(removeMetaKeys.length ? { remove_metadata_keys: removeMetaKeys } : {}),
                });
                if (!silent) toast.success(t('calendar.event_updated', 'Cita actualitzada!'));
                onSaved?.(response.data);
                if (!silent) onClose?.();
            } else {
                // Primera creació: POST. Guarda l'id perquè els autosaves següents facin
                // PATCH (no dupliquin) i la UI passi a mode "edició".
                isCreatingRef.current = true;
                const response = await axios.post('/api/vault/pages', {
                    title: title.trim(),
                    content: description.trim() || '',
                    metadata,
                });
                createdIdRef.current = response.data?.id || null;
                setCreatedId(createdIdRef.current);
                // Si la cita ja existia a Google (canvi de calendari Google→taula),
                // esborra-la de Google perquè no quedi duplicada.
                if (googleRef.current?.id) {
                    try {
                        await axios.delete(`/api/calendar/events/${encodeURIComponent(googleRef.current.id)}?email=${encodeURIComponent(googleRef.current.account)}&calendar_id=${encodeURIComponent(googleRef.current.calendar_id)}`);
                    } catch (delErr) { console.error('Error netejant cita duplicada a Google:', delErr); }
                    googleRef.current = null;
                }
                if (!silent) toast.success(t('calendar.event_created', 'Cita creada!'));
                onSaved?.(response.data);
                if (!silent) onClose?.();
            }

            lastSavedData.current = snapshot || JSON.stringify({
                title, allDay, startDate, endDate, startTime, endTime,
                calendarId, location, locationLat, locationLon, reminder, recurrence, selectedDays,
                endType, endCount, untilDate, description, attendees, travelTime
            });
        } catch (err) {
            console.error('Error desant event:', err);
            setSaveError(true);
            if (!silent) toast.error(t('calendar.event_save_error', 'Error desant la cita.'));
            if (silent && snapshot) lastSavedData.current = snapshot;
        } finally {
            setSaving(false);
            setIsRecurrenceModifyOpen(false);
            isCreatingRef.current = false;
        }
    };

    const handleDelete = async (isSeries = false, isInstanceOnly = false, isFollowing = false) => {
        // Si la cita s'ha creat en un calendari de Google en aquesta sessió, esborra-la a Google
        if (googleRef.current?.id) {
            setDeleting(true);
            try {
                await axios.delete(`/api/calendar/events/${encodeURIComponent(googleRef.current.id)}?email=${encodeURIComponent(googleRef.current.account)}&calendar_id=${encodeURIComponent(googleRef.current.calendar_id)}`);
                toast.success(t('calendar.event_deleted', 'Cita eliminada.'));
                googleRef.current = null;
                onSaved?.();
                onClose?.();
            } catch (err) {
                console.error('Error eliminant event de Google:', err);
                toast.error(t('calendar.event_delete_error', 'Error eliminant la cita.'));
            } finally {
                setDeleting(false);
                setIsRecurrenceDeleteOpen(false);
            }
            return;
        }

        // Event de Google ja existent (reobert en mode lectura): esborra'l a Google si no és de només lectura
        const gmeta = eventData?.metadata || {};
        const gIsGoogle = (gmeta._provider === 'google' || !!gmeta._account) && !gmeta._vault_path;
        if (gIsGoogle && eventData?.id) {
            if (gmeta.readonly) {
                toast.error(t('calendar.external_event_delete_warning', 'No es pot eliminar: és una cita de només lectura.'));
                return;
            }
            setDeleting(true);
            try {
                await axios.delete(`/api/calendar/events/${encodeURIComponent(eventData.id)}?email=${encodeURIComponent(gmeta._account)}&calendar_id=${encodeURIComponent(gmeta._calendar_id || 'primary')}`);
                toast.success(t('calendar.event_deleted', 'Cita eliminada.'));
                onSaved?.();
                onClose?.();
            } catch (err) {
                console.error('Error eliminant event de Google:', err);
                toast.error(t('calendar.event_delete_error', 'Error eliminant la cita.'));
            } finally {
                setDeleting(false);
                setIsRecurrenceDeleteOpen(false);
            }
            return;
        }

        const deleteId = eventData?.id || createdIdRef.current;
        if (!deleteId) return;

        // Si és recurrent i no hem triat, obrim el modal (una cita nova mai és recurrent)
        const isRecurrent = !!(eventData?.metadata?.rrule || eventData?.metadata?.recurrence);
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
                await axios.delete(`/api/vault/pages/${deleteId}`);
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

    // Desa qualsevol canvi pendent abans de tancar/desmuntar. L'autosave té un debounce
    // de 450ms; sense aquest flush, tancar de pressa perdria l'últim canvi. S'actualitza
    // cada render perquè capturi els valors i el handleSubmit més recents.
    flushSaveRef.current = () => {
        if (autoSaveTimeoutRef.current) {
            clearTimeout(autoSaveTimeoutRef.current);
            autoSaveTimeoutRef.current = null;
        }
        if (mode === 'view') return; // els events externs (Google) no s'autodesen
        if (!title.trim() || !startDate) return; // sense títol: no crear/desar (evita esborranys)
        const snap = JSON.stringify({
            title, allDay, startDate, endDate, startTime, endTime,
            calendarId, location, locationLat, locationLon, reminder, recurrence, selectedDays,
            endType, endCount, untilDate, description, attendees, travelTime
        });
        if (lastSavedData.current !== snap) {
            handleSubmit(null, true, snap); // crea (POST) o actualitza (PATCH) segons calgui
        }
    };

    const isViewMode = mode === 'view';
    // Un event de Google ja existent (reobert) es pot eliminar si no és de només lectura
    const _gmeta = eventData?.metadata || {};
    const isDeletableGoogleEvent = !!((_gmeta._provider === 'google' || _gmeta._account) && !_gmeta._vault_path && !_gmeta.readonly && eventData?.id);
    const inputClass = `w-full bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg px-2.5 py-1.5 text-[13px] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--gnosi-primary)]/30 focus:border-[var(--gnosi-primary)] transition-all ${isViewMode ? 'disabled:cursor-not-allowed disabled:opacity-60 disabled:bg-[var(--bg-tertiary)]' : ''}`;
    const labelClass = "flex items-center gap-1.5 text-[11px] font-semibold text-[var(--text-tertiary)] uppercase tracking-wide mb-1";

    return (
        <div className="flex flex-col h-full">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-primary)] bg-[var(--bg-tertiary)]">
                <div className="flex items-center gap-2">
                    <button onClick={() => { flushSaveRef.current(); onClose?.(); }} className="gnosi-close-btn" aria-label="Tancar panell">
                        <X />
                    </button>
                    <span className="text-[13px] font-semibold text-[var(--text-primary)]">
                        {mode === 'create' && !createdId ? t('calendar.new_event', 'Nova cita') : t('calendar.edit_event', 'Editar cita')}
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
                    <div className="relative">
                        <input
                            type="text"
                            value={location}
                            onChange={(e) => handleLocationChange(e.target.value)}
                            onKeyDown={handleLocationKeyDown}
                            onFocus={() => { if (locationBlurTimeoutRef.current) clearTimeout(locationBlurTimeoutRef.current); }}
                            onBlur={() => {
                                // Retard per permetre el clic sobre un suggeriment abans de tancar
                                locationBlurTimeoutRef.current = setTimeout(() => {
                                    setLocationSuggestions([]);
                                    setLocationHighlight(-1);
                                }, 150);
                            }}
                            placeholder={t('calendar.location_placeholder', "Sala 3, https://meet.google...")}
                            className={`${inputClass} ${(locationLoading || locationLat != null) ? 'pr-8' : ''}`}
                            autoComplete="off"
                            title={location || undefined}
                        />
                        {locationLoading ? (
                            <Loader2 size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 animate-spin text-[var(--text-tertiary)]" />
                        ) : locationLat != null ? (
                            <span
                                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--status-success,#22c55e)]"
                                title={t('calendar.location_verified', 'Ubicació verificada')}
                            >
                                <Check size={14} strokeWidth={3} />
                            </span>
                        ) : null}

                        {locationSuggestions.length > 0 && (
                            <div className="absolute top-full left-0 right-0 z-50 bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg shadow-xl mt-0.5 overflow-hidden max-h-56 overflow-y-auto">
                                {locationSuggestions.map((s, i) => (
                                    <button
                                        key={`${s.label}-${i}`}
                                        type="button"
                                        onMouseDown={(e) => { e.preventDefault(); selectLocationSuggestion(s); }}
                                        onMouseEnter={() => setLocationHighlight(i)}
                                        className={`w-full text-left px-3 py-1.5 transition-colors border-b border-[var(--border-primary)] last:border-none flex items-start gap-2 ${i === locationHighlight ? 'bg-[var(--bg-secondary)]' : 'hover:bg-[var(--bg-secondary)]'}`}
                                    >
                                        <MapPin size={12} className="mt-0.5 flex-shrink-0 text-[var(--text-tertiary)]" />
                                        <span className="text-[12px] text-[var(--text-primary)] leading-tight">{s.label}</span>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                    {location && (location.length > 36 || locationLat != null) && (
                        <div className="mt-1 flex items-start gap-1.5 px-0.5">
                            <span className="text-[11px] text-[var(--text-tertiary)] leading-snug break-words flex-1" title={location}>
                                {location}
                            </span>
                            {locationLat != null && locationLon != null && (
                                <a
                                    href={`https://www.openstreetmap.org/?mlat=${locationLat}&mlon=${locationLon}#map=17/${locationLat}/${locationLon}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-[10px] text-[var(--gnosi-primary)] hover:underline shrink-0 whitespace-nowrap"
                                    title={t('calendar.view_on_map', 'Veure al mapa')}
                                >
                                    {t('calendar.map', 'mapa')}
                                </a>
                            )}
                        </div>
                    )}
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

                {/* Temps de desplaçament */}
                <div>
                    <label className={labelClass}>
                        <Navigation size={10} />
                        {t('calendar.travel_time', 'Temps de desplaçament')}
                    </label>
                    <select value={travelTime} onChange={(e) => setTravelTime(e.target.value)} className={inputClass}>
                        {TRAVEL_TIME_OPTIONS.map(opt => (
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
                    {((mode === 'edit' && eventData?.id) || createdId || isDeletableGoogleEvent) && (
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
    // Sense aquest hook, els literals `t('calendar.availability....')` dins
    // el JSX llançaven ReferenceError quan l'usuari obria el sidebar de
    // disponibilitat → tot el sidebar quedava trencat amb un toast d'error.
    const { t } = useTranslation();
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

    const copySlotsAsText = async () => {
        if (freeSlots.length === 0) return;
        const text = `Hola! Estic disponible el dia ${date} en aquests horaris:\n` +
            freeSlots.map(s => `- ${s.start} a ${s.end}`).join('\n') +
            ` \n\nQuin et va millor?`;
        try {
            await navigator.clipboard.writeText(text);
            toast.success("Horaris copiats al porta-retalls!");
        } catch {
            toast.error("No s'ha pogut copiar al porta-retalls");
        }
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
