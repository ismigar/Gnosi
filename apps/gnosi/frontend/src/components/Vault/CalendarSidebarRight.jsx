import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Search, X, CalendarPlus, Clock, MapPin, Bell, AlignLeft, Trash2, Sun, Users, UserPlus, Loader2, Check, Navigation } from 'lucide-react';
import axios from 'axios';
import { toast } from '../../lib/toast';
import { useTranslation } from 'react-i18next';
import { ConfirmModal } from '../ConfirmModal';
import { RecurrenceChoiceModal } from '../Vault/RecurrenceChoiceModal';
import { buildOccurrenceKey, truncateRruleBefore } from '../../utils/calendarUtils';

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
                    {t('calendar.shortcuts_tab', 'Shortcuts')}
                </button>
                <button
                    onClick={() => setActiveTab('availability')}
                    className={`flex-1 py-3 text-[11px] font-bold uppercase tracking-wider transition-colors ${activeTab === 'availability' ? 'text-[var(--gnosi-primary)] border-b-2 border-[var(--gnosi-primary)]' : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]'}`}
                >
                    {t('mail.availability', "Availability")}
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

/* ─── Default content (search + shortcuts) ─── */
const DefaultContent = ({ searchQuery, onSearchChange, onToggleSidebar, onOpenSearch, allNotes, onEventEdit }) => {
    const { t } = useTranslation();

    // We filter notes based on the search to show them here
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
                    placeholder={t('calendar.search_events', "Search events")}
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

            {/* Quick search results */}
            {searchQuery && (
                <div className="mt-4 space-y-2">
                    <h4 className="text-[11px] font-bold text-[var(--text-tertiary)] uppercase tracking-wider px-1">{t('calendar.search_results_heading', "Results")}</h4>
                    {filteredResults.length > 0 ? (
                        filteredResults.map(res => (
                            <button
                                key={res.id}
                                onClick={() => onEventEdit?.(res.id)}
                                className="w-full text-left p-2 rounded-lg hover:bg-[var(--bg-tertiary)] transition-colors border border-transparent hover:border-[var(--border-primary)]"
                            >
                                <div className="text-[12px] font-semibold text-[var(--text-primary)] truncate">{res.title || res.metadata?.title || t('common.untitled', "Untitled")}</div>
                                <div className="text-[10px] text-[var(--text-tertiary)]">{res.metadata?.date?.split('T')[0] || t('calendar.no_date', "No date")}</div>
                            </button>
                        ))
                    ) : (
                        <div className="text-[11px] text-[var(--text-tertiary)] px-1 italic">{t('calendar.no_matches', "No matches")}</div>
                    )}
                </div>
            )}

            <div className="mt-8">
                <h3 className="text-[13px] font-bold text-[var(--text-primary)] flex items-center justify-between mb-5">
                    {t('calendar.useful_shortcuts', "Useful shortcuts")}
                </h3>

                <div className="flex flex-col gap-2">
                    <button
                        onClick={onOpenSearch}
                        className="flex items-center justify-between w-full p-2 rounded-lg hover:bg-[var(--bg-tertiary)] transition-all group text-[12px] text-[var(--text-secondary)] font-medium"
                    >
                        <span>{t('calendar.command_menu', "Command menu")}</span>
                        <div className="flex gap-1 opacity-60 group-hover:opacity-100">
                            <kbd className="border border-[var(--border-primary)] rounded px-1.5 py-[1px] bg-[var(--bg-secondary)] text-[var(--text-tertiary)] shadow-sm">⌘</kbd>
                            <kbd className="border border-[var(--border-primary)] rounded px-1.5 py-[1px] bg-[var(--bg-secondary)] text-[var(--text-tertiary)] shadow-sm">K</kbd>
                        </div>
                    </button>

                    <button
                        onClick={onToggleSidebar}
                        className="flex items-center justify-between w-full p-2 rounded-lg hover:bg-[var(--bg-tertiary)] transition-all group text-[12px] text-[var(--text-secondary)] font-medium"
                    >
                        <span>{t('calendar.toggle_sidebar', "Hide sidebar")}</span>
                        <kbd className="opacity-60 group-hover:opacity-100 border border-[var(--border-primary)] rounded px-2 py-[1px] bg-[var(--bg-secondary)] text-[var(--text-tertiary)] shadow-sm">.</kbd>
                    </button>

                    <button
                        onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: ',' }))}
                        className="flex items-center justify-between w-full p-2 rounded-lg hover:bg-[var(--bg-tertiary)] transition-all group text-[12px] text-[var(--text-secondary)] font-medium"
                    >
                        <span>{t('calendar.go_to_today', "Go to today")}</span>
                        <kbd className="opacity-60 group-hover:opacity-100 border border-[var(--border-primary)] rounded px-2 py-[1px] bg-[var(--bg-secondary)] text-[var(--text-tertiary)] shadow-sm">,</kbd>
                    </button>

                </div>
            </div>
        </div>
    );
};

/* ─── Events form (create/edit) ─── */
const EventForm = ({ mode, eventData, initialDate, calendars, onClose, onSaved, onRsvp, userEmail = '', defaultCalendarId = '' }) => {
    const { t } = useTranslation();
    const titleRef = useRef(null);

    const RSVP_META = {
        accepted:    { label: t('calendar.rsvp_accepted', "✓ Accepted"),  dot: 'bg-green-500',  btn: 'border-green-500 text-green-600 hover:bg-green-50 dark:hover:bg-green-950',  activeCls: 'bg-green-500 text-white border-green-500' },
        declined:    { label: t('calendar.rsvp_declined', "✗ Declined"),  dot: 'bg-red-500',    btn: 'border-red-500 text-red-600 hover:bg-red-50 dark:hover:bg-red-950',          activeCls: 'bg-red-500 text-white border-red-500' },
        tentative:   { label: t('calendar.rsvp_maybe', "? Maybe"),      dot: 'bg-amber-400',  btn: 'border-amber-400 text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950',  activeCls: 'bg-amber-400 text-white border-amber-400' },
        needsAction: { label: t('calendar.rsvp_pending', "Pending"),     dot: 'bg-gray-400',   btn: '', activeCls: '' },
    };

    const REMINDER_OPTIONS = [
        { value: '', label: t('calendar.option_none', "None") },
        { value: '5', label: t('calendar.reminder_5min', "5 minutes before") },
        { value: '15', label: t('calendar.reminder_15min', "15 minutes before") },
        { value: '30', label: t('calendar.reminder_30min', "30 minutes before") },
        { value: '60', label: t('calendar.reminder_1h', "1 hour before") },
        { value: '1440', label: t('calendar.reminder_1d', "1 day before") },
    ];

    const TRAVEL_TIME_OPTIONS = [
        { value: '', label: t('calendar.option_none', "None") },
        { value: '5', label: t('calendar.travel_5min', '5 min') },
        { value: '10', label: t('calendar.travel_10min', '10 min') },
        { value: '15', label: t('calendar.travel_15min', '15 min') },
        { value: '30', label: t('calendar.travel_30min', '30 min') },
        { value: '45', label: t('calendar.travel_45min', '45 min') },
        { value: '60', label: t('calendar.travel_1h', "1 hour") },
        { value: '90', label: t('calendar.travel_1h30', '1 h 30 min') },
        { value: '120', label: t('calendar.travel_2h', "2 hours") },
    ];

    const RECURRENCE_OPTIONS = [
        { value: '', label: t('calendar.recurrence_none', "Does not repeat") },
        { value: 'DAILY', label: t('calendar.recurrence_daily', "Every day") },
        { value: 'WEEKLY', label: t('calendar.recurrence_weekly', "Every week") },
        { value: 'MONTHLY', label: t('calendar.recurrence_monthly', "Every month") },
        { value: 'YEARLY', label: t('calendar.recurrence_yearly', "Every year") },
    ];

    const DAYS_OF_WEEK = [
        { value: 'MO', label: t('calendar.day_mo', "Mon") },
        { value: 'TU', label: t('calendar.day_tu', "Tue") },
        { value: 'WE', label: t('calendar.day_we', "Wed") },
        { value: 'TH', label: t('calendar.day_th', "Thu") },
        { value: 'FR', label: t('calendar.day_fr', "Fri") },
        { value: 'SA', label: t('calendar.day_sa', "Sat") },
        { value: 'SU', label: t('calendar.day_su', "Sun") },
    ];

    // Function to normalize times to the HH:mm format
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
    // In 'create' mode the appointment is NOT created until there's a title. createdIdRef stores
    // the id once created so that subsequent autosaves do a PATCH (not duplicate it).
    // createdId is the reactive equivalent for the UI (header and Delete button).
    const createdIdRef = useRef(null);
    const isCreatingRef = useRef(false);
    const [createdId, setCreatedId] = useState(null);
    // When the appointment is created in a Google calendar, we store the Google event id
    // (+ account and calendar_id) so that subsequent changes PATCH Google, not the Vault.
    const googleRef = useRef(null);
    const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
    const [isRecurrenceDeleteOpen, setIsRecurrenceDeleteOpen] = useState(false);
    const [isRecurrenceModifyOpen, setIsRecurrenceModifyOpen] = useState(false);

    // Populate fields
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
            // initialDate can come as "YYYY-MM-DD" (all day) or with a time
            // ("YYYY-MM-DDTHH:mm[:ss]") if a time slot was clicked.
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

            // Default calendar (configured by the user or the first available one)
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

    // Autosave on every modification (debounced). When editing, it saves the existing appointment; when
    // creating, it creates it (only once there's a valid title) and continues editing it.
    useEffect(() => {
        if (saving || deleting) return;
        if (mode === 'view') return; // external events (Google) in read mode are not autosaved
        if (!title.trim() || !startDate) return; // without a title, nothing is created (avoids drafts)

        const currentData = {
            title, allDay, startDate, endDate, startTime, endTime,
            calendarId, location, locationLat, locationLon, reminder, recurrence, selectedDays,
            endType, endCount, untilDate, description, attendees, travelTime
        };
        const currentStr = JSON.stringify(currentData);

        // Editing an existing appointment: sets the baseline with the data that was just loaded
        // —even while we're initializing— so that the user's FIRST change is already detected
        // and saved. When creating, we leave the baseline as null so the first valid title triggers
        // creation via debounce.
        if (lastSavedData.current === null) {
            if (mode === 'edit' && eventData?.id) {
                lastSavedData.current = currentStr;
                return;
            }
        }

        // Do not autosave during initialization (once the baseline is set in edit mode).
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
                    toast.error(t('calendar.external_event_delete_warning', "External events cannot be deleted from Gnosi."));
                }
            }
        };
        window.addEventListener('keydown', handleKey);
        return () => window.removeEventListener('keydown', handleKey);
    }, [onClose, mode, eventData, createdId]);

    // Flush the pending save when the panel unmounts (event change, navigation...)
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

    // ─── Location geocoding (OpenStreetMap / Photon) ─────────────────────────
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
        // Manual editing invalidates the prior verification (coordinates)
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
            // Closes only the dropdown, not the whole panel
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

    // Builds the event in Google Calendar API format (for Google calendars)
    const buildGoogleEventData = () => {
        const tz = (typeof Intl !== 'undefined' && Intl.DateTimeFormat().resolvedOptions().timeZone) || 'Europe/Madrid';
        const ev = { summary: title.trim() };
        if (allDay) {
            ev.start = { date: startDate };
            // In Google, end.date is EXCLUSIVE → +1 day relative to the last day
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

        // Prevents a second creation (POST) while the first one is still in flight
        if (!eventData?.id && !createdIdRef.current && isCreatingRef.current) return;

        // If it's a manual save (not silent) of a recurring event and we haven't chosen yet
        const isRecurrent = !!(eventData?.metadata?.rrule || eventData?.metadata?.recurrence);
        if (!silent && isRecurrent && !isSeries && !isInstanceOnly && !isFollowing) {
            setIsRecurrenceModifyOpen(true);
            return;
        }

        setSaving(true);
        setSaveError(false);

        const fullStart = buildDatetime(startDate, startTime);
        const fullEnd = buildDatetime(endDate, endTime);

        // ─── Editing a Google event that ALREADY EXISTS (reopened in edit mode) → PATCH to Google ───
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
                if (!silent) toast.success(t('calendar.event_updated', "Appointment updated!"));
                // Optimistic update (without refetch) so as not to reload the whole calendar on
                // every keystroke: we pass the updated event so only this one is refreshed.
                onSaved?.({
                    id: eventData.id,
                    title: title.trim(),
                    content: description.trim() || '',
                    metadata: {
                        ...existGm,
                        date: fullStart,
                        end_date: fullEnd || fullStart,
                        all_day: allDay,
                        location: location.trim(),
                        description: description.trim() || '',
                        attendees,
                    },
                });
                if (!silent) onClose?.();
            } catch (err) {
                console.error('Error updating Google event:', err);
                setSaveError(true);
                if (!silent) toast.error(t('calendar.event_save_error', "Error sending the appointment."));
                if (silent && snapshot) lastSavedData.current = snapshot;
            } finally {
                setSaving(false);
            }
            return;
        }

        // ─── Google Calendar: actually create/edit the event in Google (not in the Vault) ───
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
                    // Updates the event we already created in Google during this session
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
                    // Creates the new event in Google (we store the id to avoid duplicating it)
                    isCreatingRef.current = true;
                    const resp = await axios.post(
                        `/api/calendar/events?email=${encodeURIComponent(selCal.account)}&calendar_id=${encodeURIComponent(selCal.google_calendar_id)}`,
                        buildGoogleEventData()
                    );
                    if (resp.data?.id) {
                        googleRef.current = { id: resp.data.id, account: selCal.account, calendar_id: selCal.google_calendar_id };
                        setCreatedId(resp.data.id);
                        // If the appointment already existed in the Vault (calendar change Tasks→Google),
                        // delete it so it doesn't remain duplicated.
                        if (createdIdRef.current) {
                            try { await axios.delete(`/api/vault/pages/${createdIdRef.current}`); }
                            catch (delErr) { console.error('Error cleaning up duplicate appointment in Vault:', delErr); }
                            createdIdRef.current = null;
                        }
                    }
                }
                lastSavedData.current = formSnap;
                if (!silent) toast.success(t('calendar.event_created', "Appointment created!"));
                onSaved?.();
                if (!silent) onClose?.();
            } catch (err) {
                console.error('Error saving event to Google Calendar:', err);
                setSaveError(true);
                if (!silent) toast.error(t('calendar.event_save_error', "Error sending the appointment."));
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
                // Unverified location (free text/URL): clears old coords (PATCH merges)
                removeMetaKeys.push('location_lat', 'location_lon');
            }
        } else {
            // No location: clears the whole location block
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
                // External calendar (Google): we do NOT change the source to the calendar's email.
                // fetchPages filters out everything that isn't source 'Gnosi', so the appointment
                // would disappear on refresh. Until there's an integration to actually create it
                // in Google, we save it to the first Gnosi table so it remains
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
                    // 1. Add EXDATE to the master
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

                    // 2. Creates a new single appointment
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
                    // 1. Truncate the old master's rrule
                    const newRruleOldMaster = truncateRruleBefore(eventData.metadata?.rrule, eventData.metadata?.date);
                    await axios.patch(`/api/vault/pages/${eventData.id}`, {
                        metadata: { rrule: newRruleOldMaster }
                    });

                    // 2. Create a new master that starts on the new date
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
                    // Normal patch (or the whole series)
                    const response = await axios.patch(`/api/vault/pages/${eventData.id}`, {
                        title: title.trim(),
                        content: description.trim() || undefined,
                        metadata,
                        ...(removeMetaKeys.length ? { remove_metadata_keys: removeMetaKeys } : {}),
                    });
                    
                    if (!silent) toast.success(t('calendar.event_updated', "Appointment updated!"));
                    onSaved?.(response.data);
                    if (!silent) onClose?.();
                }
            } else if (createdIdRef.current) {
                // Appointment already created in this same session: PATCH (we continue editing it)
                const response = await axios.patch(`/api/vault/pages/${createdIdRef.current}`, {
                    title: title.trim(),
                    content: description.trim() || undefined,
                    metadata,
                    ...(removeMetaKeys.length ? { remove_metadata_keys: removeMetaKeys } : {}),
                });
                if (!silent) toast.success(t('calendar.event_updated', "Appointment updated!"));
                onSaved?.(response.data);
                if (!silent) onClose?.();
            } else {
                // First creation: POST. Stores the id so subsequent autosaves do a
                // PATCH (not duplicate) and the UI switches to "edit" mode.
                isCreatingRef.current = true;
                const response = await axios.post('/api/vault/pages', {
                    title: title.trim(),
                    content: description.trim() || '',
                    metadata,
                });
                createdIdRef.current = response.data?.id || null;
                setCreatedId(createdIdRef.current);
                // If the appointment already existed in Google (calendar change Google→table),
                // delete it from Google so it doesn't remain duplicated.
                if (googleRef.current?.id) {
                    try {
                        await axios.delete(`/api/calendar/events/${encodeURIComponent(googleRef.current.id)}?email=${encodeURIComponent(googleRef.current.account)}&calendar_id=${encodeURIComponent(googleRef.current.calendar_id)}`);
                    } catch (delErr) { console.error('Error cleaning up duplicate appointment in Google:', delErr); }
                    googleRef.current = null;
                }
                if (!silent) toast.success(t('calendar.event_created', "Appointment created!"));
                onSaved?.(response.data);
                if (!silent) onClose?.();
            }

            lastSavedData.current = snapshot || JSON.stringify({
                title, allDay, startDate, endDate, startTime, endTime,
                calendarId, location, locationLat, locationLon, reminder, recurrence, selectedDays,
                endType, endCount, untilDate, description, attendees, travelTime
            });
        } catch (err) {
            console.error('Error saving event:', err);
            setSaveError(true);
            if (!silent) toast.error(t('calendar.event_save_error', "Error sending the appointment."));
            if (silent && snapshot) lastSavedData.current = snapshot;
        } finally {
            setSaving(false);
            setIsRecurrenceModifyOpen(false);
            isCreatingRef.current = false;
        }
    };

    const handleDelete = async (isSeries = false, isInstanceOnly = false, isFollowing = false) => {
        // If the appointment was created in a Google calendar during this session, delete it in Google
        if (googleRef.current?.id) {
            setDeleting(true);
            try {
                await axios.delete(`/api/calendar/events/${encodeURIComponent(googleRef.current.id)}?email=${encodeURIComponent(googleRef.current.account)}&calendar_id=${encodeURIComponent(googleRef.current.calendar_id)}`);
                toast.success(t('calendar.event_deleted', "Appointment deleted."));
                googleRef.current = null;
                onSaved?.();
                onClose?.();
            } catch (err) {
                console.error('Error deleting Google event:', err);
                toast.error(t('calendar.event_delete_error', "Error deleting the appointment."));
            } finally {
                setDeleting(false);
                setIsRecurrenceDeleteOpen(false);
            }
            return;
        }

        // Google event that already exists (reopened in read mode): delete it in Google if it's not read-only
        const gmeta = eventData?.metadata || {};
        const gIsGoogle = (gmeta._provider === 'google' || !!gmeta._account) && !gmeta._vault_path;
        if (gIsGoogle && eventData?.id) {
            if (gmeta.readonly) {
                toast.error(t('calendar.external_event_delete_warning', "External events cannot be deleted from Gnosi."));
                return;
            }
            setDeleting(true);
            try {
                await axios.delete(`/api/calendar/events/${encodeURIComponent(eventData.id)}?email=${encodeURIComponent(gmeta._account)}&calendar_id=${encodeURIComponent(gmeta._calendar_id || 'primary')}`);
                toast.success(t('calendar.event_deleted', "Appointment deleted."));
                onSaved?.();
                onClose?.();
            } catch (err) {
                console.error('Error deleting Google event:', err);
                toast.error(t('calendar.event_delete_error', "Error deleting the appointment."));
            } finally {
                setDeleting(false);
                setIsRecurrenceDeleteOpen(false);
            }
            return;
        }

        const deleteId = eventData?.id || createdIdRef.current;
        if (!deleteId) return;

        // If it's recurring and we haven't chosen, open the modal (a new appointment is never recurring)
        const isRecurrent = !!(eventData?.metadata?.rrule || eventData?.metadata?.recurrence);
        if (isRecurrent && !isSeries && !isInstanceOnly && !isFollowing) {
            setIsRecurrenceDeleteOpen(true);
            return;
        }

        setDeleting(true);
        try {
            if (isInstanceOnly) {
                // Instance deletion logic
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
                // Split: Truncate the master's rrule so it ends before today
                const newRrule = truncateRruleBefore(eventData.metadata?.rrule, eventData.metadata?.date);
                await axios.patch(`/api/vault/pages/${eventData.id}`, {
                    metadata: { rrule: newRrule }
                });
                toast.success(t('calendar.following_deleted', "Series truncated from today."));
            } else {
                await axios.delete(`/api/vault/pages/${deleteId}`);
                toast.success(t('calendar.event_deleted', "Appointment deleted."));
            }
            onSaved?.();
            onClose?.();
        } catch (err) {
            console.error('Error deleting event:', err);
            const errorMsg = err.response?.data?.detail || err.message || '';
            toast.error(`${t('calendar.event_delete_error', "Error deleting the appointment.")} ${errorMsg}`);
        } finally {
            setDeleting(false);
            setIsRecurrenceDeleteOpen(false);
        }
    };

    // Saves any pending change before closing/unmounting. Autosave has a debounce
    // of 450ms; without this flush, closing quickly would lose the last change. It's updated
    // on every render so it captures the latest values and handleSubmit.
    flushSaveRef.current = () => {
        if (autoSaveTimeoutRef.current) {
            clearTimeout(autoSaveTimeoutRef.current);
            autoSaveTimeoutRef.current = null;
        }
        if (mode === 'view') return; // external events (Google) are not autosaved
        if (!title.trim() || !startDate) return; // no title: don't create/save (avoids drafts)
        const snap = JSON.stringify({
            title, allDay, startDate, endDate, startTime, endTime,
            calendarId, location, locationLat, locationLon, reminder, recurrence, selectedDays,
            endType, endCount, untilDate, description, attendees, travelTime
        });
        if (lastSavedData.current !== snap) {
            handleSubmit(null, true, snap); // creates (POST) or updates (PATCH) as needed
        }
    };

    const isViewMode = mode === 'view';
    // A Google event that already exists (reopened) can be deleted if it's not read-only
    const _gmeta = eventData?.metadata || {};
    const isDeletableGoogleEvent = !!((_gmeta._provider === 'google' || _gmeta._account) && !_gmeta._vault_path && !_gmeta.readonly && eventData?.id);
    const inputClass = `w-full bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg px-2.5 py-1.5 text-[13px] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--gnosi-primary)]/30 focus:border-[var(--gnosi-primary)] transition-all ${isViewMode ? 'disabled:cursor-not-allowed disabled:opacity-60 disabled:bg-[var(--bg-tertiary)]' : ''}`;
    const labelClass = "flex items-center gap-1.5 text-[11px] font-semibold text-[var(--text-tertiary)] uppercase tracking-wide mb-1";

    return (
        <div className="flex flex-col h-full">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-primary)] bg-[var(--bg-tertiary)]">
                <div className="flex items-center gap-2">
                    <button onClick={() => { flushSaveRef.current(); onClose?.(); }} className="gnosi-close-btn" aria-label={t('calendar.close_panel', "Close panel")}>
                        <X />
                    </button>
                    <span className="text-[13px] font-semibold text-[var(--text-primary)]">
                        {mode === 'create' && !createdId ? t('calendar.new_event', "New appointment") : t('calendar.edit_event', "Edit appointment")}
                    </span>
                </div>
                <div className="flex items-center gap-1" />
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-4 space-y-3">
                {/* Title */}
                <div>
                    <label className={labelClass}>{t('calendar.event_title', "Title")}</label>
                    <input
                        ref={titleRef}
                        type="text"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        onBlur={handleFieldBlur}
                        placeholder={t('calendar.event_title_placeholder', "Meeting, Doctor's appointment...")}
                        className={inputClass}
                        required
                    />
                </div>

                {/* All day */}
                <div className="flex items-center justify-between py-1">
                    <label className="flex items-center gap-1.5 text-[12px] font-medium text-[var(--text-secondary)]">
                        <Sun size={14} className="text-amber-500" />
                        {t('calendar.all_day', "All day")}
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
                            {t('calendar.start', "Start")}
                        </label>
                        <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} onBlur={handleFieldBlur} className={inputClass} required />
                    </div>
                    <div>
                        <label className={labelClass}>
                            <CalendarPlus size={10} />
                            {t('calendar.end', "End")} <span className="text-[var(--text-tertiary)] font-normal normal-case">{t('calendar.opt', "(opt.)")}</span>
                        </label>
                        <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} onBlur={handleFieldBlur} className={inputClass} min={startDate} />
                    </div>
                </div>

                {/* Hours (hidden if "All day") */}
                {!allDay && (
                    <div className="grid grid-cols-2 gap-2">
                        <div>
                            <label className={labelClass}>
                                <Clock size={10} />
                                {t('calendar.start_time', "Start time")}
                            </label>
                            <input type="time" value={startTime} onChange={(e) => setStartTime(padTime(e.target.value))} onBlur={handleFieldBlur} className={inputClass} />
                        </div>
                        <div>
                            <label className={labelClass}>
                                <Clock size={10} />
                                {t('calendar.end_time', "End time")}
                            </label>
                            <input type="time" value={endTime} onChange={(e) => setEndTime(padTime(e.target.value))} onBlur={handleFieldBlur} className={inputClass} />
                        </div>
                    </div>
                )}

                {/* Calendar (Enabled tables and calendars) */}
                <div>
                    <label className={labelClass}>
                        <CalendarPlus size={10} />
                        {t('calendar.label', "Calendar")}
                    </label>
                    <select value={calendarId} onChange={(e) => setCalendarId(e.target.value)} onBlur={handleFieldBlur} className={inputClass}>
                        {calendars.map(cal => (
                            <option key={cal.id} value={cal.id}>{cal.name}</option>
                        ))}
                    </select>
                </div>

                {/* Location */}
                <div>
                    <label className={labelClass}>
                        <MapPin size={10} />
                        {t('calendar.location', "Location / URL")}
                    </label>
                    <div className="relative">
                        <input
                            type="text"
                            value={location}
                            onChange={(e) => handleLocationChange(e.target.value)}
                            onKeyDown={handleLocationKeyDown}
                            onFocus={() => { if (locationBlurTimeoutRef.current) clearTimeout(locationBlurTimeoutRef.current); }}
                            onBlur={() => {
                                // Delay to allow clicking a suggestion before closing
                                locationBlurTimeoutRef.current = setTimeout(() => {
                                    setLocationSuggestions([]);
                                    setLocationHighlight(-1);
                                }, 150);
                            }}
                            placeholder={t('calendar.location_placeholder', "Room 3, https://meet.google...")}
                            className={`${inputClass} ${(locationLoading || locationLat != null) ? 'pr-8' : ''}`}
                            autoComplete="off"
                            title={location || undefined}
                        />
                        {locationLoading ? (
                            <Loader2 size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 animate-spin text-[var(--text-tertiary)]" />
                        ) : locationLat != null ? (
                            <span
                                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--status-success,#22c55e)]"
                                title={t('calendar.location_verified', "Verified location")}
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
                                    title={t('calendar.view_on_map', "View on map")}
                                >
                                    {t('calendar.map', "map")}
                                </a>
                            )}
                        </div>
                    )}
                </div>

                {/* Recordatori */}
                <div>
                    <label className={labelClass}>
                        <Bell size={10} />
                        {t('calendar.reminder', "Reminder")}
                    </label>
                    <select value={reminder} onChange={(e) => setReminder(e.target.value)} onBlur={handleFieldBlur} className={inputClass}>
                        {REMINDER_OPTIONS.map(opt => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                    </select>
                </div>

                {/* Travel time */}
                <div>
                    <label className={labelClass}>
                        <Navigation size={10} />
                        {t('calendar.travel_time', "Travel time")}
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
                        {t('calendar.attendees', "Attendees")}
                    </label>

                    {isViewMode ? (
                        /* ── View (external events) ── */
                        <div className="space-y-1">
                            {attendees.length === 0 ? (
                                <p className="text-[11px] text-[var(--text-tertiary)] italic px-0.5">{t('calendar.no_attendees', "No guests")}</p>
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
                                                    {att.organizer && <span className="text-[9px] bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-300 px-1.5 py-0.5 rounded-full font-bold">{t('calendar.organizer_badge', 'org')}</span>}
                                                    <span className="text-[9px] text-[var(--text-tertiary)]">{meta.label}</span>
                                                </div>
                                            </div>
                                        );
                                    })}

                                    {/* RSVP buttons if the user is invited */}
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
                                                            {rv === 'accepted' ? t('calendar.rsvp_accept_action', "✓ Accept") : rv === 'tentative' ? t('calendar.rsvp_maybe', "? Maybe") : t('calendar.rsvp_decline_action', "✗ Decline")}
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
                        /* ── Edit / Create ── */
                        <div className="space-y-1.5">
                            {/* Existing attendee chips */}
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
                                        placeholder={t('calendar.attendee_input_placeholder', "Add by email or name...")}
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

                {/* Recurrence */}
                <div className="space-y-2">
                    <label className={labelClass}>
                        <CalendarPlus size={10} />
                        {t('calendar.recurrence', "Recurrence")}
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
                            <label className="text-[10px] font-bold text-[var(--text-tertiary)] uppercase tracking-tight">{t('calendar.ends', "Ends")}</label>

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
                                    <span className="text-[12px] text-[var(--text-secondary)] group-hover:text-[var(--text-primary)] transition-colors">{t('calendar.recurrence_end_never', "Never")}</span>
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
                                        <span className="text-[12px] text-[var(--text-secondary)]">{t('calendar.recurrence_end_after', "After")}</span>
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
                                        <span className="text-[12px] text-[var(--text-secondary)]">{t('calendar.recurrence_end_times', "times")}</span>
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
                                        <span className="text-[12px] text-[var(--text-secondary)]">{t('calendar.recurrence_end_until', "On the day")}</span>
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


                {/* Description */}
                <div className="pb-4">
                    <label className={labelClass}>
                        <AlignLeft size={10} />
                        {t('calendar.description', "Description")}
                    </label>
                    <textarea
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        onBlur={handleFieldBlur}
                        placeholder={t('calendar.event_description_placeholder', "Add details...")}
                        rows={2}
                        className={`${inputClass} resize-none`}
                    />
                </div>
            </form>

            {/* Footer */}
            <div className="px-4 py-2 border-t border-[var(--border-primary)] bg-[var(--bg-tertiary)] flex items-center justify-between gap-2">
                <div className={`text-[10px] italic ${saveError ? 'text-red-500' : 'text-[var(--text-tertiary)]'}`}>
                    {saving ? t('calendar.saving', "Saving...") : deleting ? t('calendar.deleting', "Deleting...") : saveError ? '⚠ Error desant' : t('calendar.saved', "Saved")}
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
                            {t('common.delete', "Delete")}
                        </button>
                    )}
                </div>
            </div>

            <ConfirmModal 
                isOpen={isDeleteConfirmOpen}
                onClose={() => setIsDeleteConfirmOpen(false)}
                onConfirm={() => handleDelete(false, false)} // By default deletes everything if confirmed here (if it's not recurring)
                title={t('calendar.confirm_delete_event_title', "Delete event")}
                message={t('calendar.confirm_delete_event', "Are you sure you want to delete this appointment?")}
                confirmText={t('common.delete', "Delete")}
                isDestructive={true}
            />

            <RecurrenceChoiceModal 
                isOpen={isRecurrenceDeleteOpen}
                onClose={() => setIsRecurrenceDeleteOpen(false)}
                onConfirm={handleDelete}
                title={t('calendar.recurrent_delete_title', "Delete recurring event")}
                message={t('calendar.recurrent_delete_msg', "This is a recurring event. What do you want to delete?")}
                actionType="delete"
            />

            <RecurrenceChoiceModal 
                isOpen={isRecurrenceModifyOpen}
                onClose={() => setIsRecurrenceModifyOpen(false)}
                onConfirm={(isSeries, isInstanceOnly, isFollowing) => handleSubmit(null, false, null, isSeries, isInstanceOnly, isFollowing)}
                title={t('calendar.recurrent_modify_title', "Modify recurring event")}
                message={t('calendar.recurrent_modify_msg', "This is a recurring event. How do you want to apply the changes?")}
                actionType="modify"
            />
        </div>
    );
};

/* ─── Availability Tool (Availability Tool) ─── */
const AvailabilityTool = ({ calendars }) => {
    // Without this hook, the `t('calendar.availability....')` literals inside
    // the JSX would throw a ReferenceError when the user opened the sidebar for
    // availability → the whole sidebar would end up broken with an error toast.
    const { t } = useTranslation();
    // Default date: TODAY in local time (not `toISOString`, which is UTC and close
    // at midnight would give the previous day).
    const [date, setDate] = useState(() => {
        const d = new Date();
        const p = (n) => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    });
    const [loading, setLoading] = useState(false);
    const [freeSlots, setFreeSlots] = useState([]);

    const checkAvailability = async () => {
        const email = calendars.find(c => c.kind === 'external')?.account;
        if (!email) {
            toast.error(t('calendar.availability.no_account', "No email account is configured."));
            return;
        }

        setLoading(true);
        try {
            // Window of the chosen LOCAL day (not UTC): by parsing without `Z`, the
            // browser interprets the bounds in local time and `toISOString` converts them
            // converts to the correct UTC instant. With `...Z` the window was the
            // to UTC, shifted relative to the local day for users outside UTC
            // (e.g. UTC+2: "July 6" queried 02:00→01:59 local).
            const timeMin = new Date(`${date}T00:00:00`).toISOString();
            const timeMax = new Date(`${date}T23:59:59`).toISOString();

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
            toast.error(t('calendar.availability.query_error', "Error checking availability."));
        } finally {
            setLoading(false);
        }
    };

    const copySlotsAsText = async () => {
        if (freeSlots.length === 0) return;
        const text = `${t('calendar.availability.share_intro', "Hi! I'm available on {{date}} at these times:", { date })}\n` +
            freeSlots.map(s => `- ${s.start} ${t('calendar.availability.share_time_sep', "to")} ${s.end}`).join('\n') +
            ` \n\n${t('calendar.availability.share_outro', "Which one works best for you?")}`;
        try {
            await navigator.clipboard.writeText(text);
            toast.success(t('calendar.availability.copied_success', "Times copied to clipboard!"));
        } catch {
            toast.error(t('calendar.availability.copy_error', "Couldn't copy to clipboard"));
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
