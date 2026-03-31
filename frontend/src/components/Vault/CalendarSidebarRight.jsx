import React, { useState, useEffect, useRef } from 'react';
import { Search, X, CalendarPlus, Clock, MapPin, Bell, AlignLeft, Trash2, Sun } from 'lucide-react';
import axios from 'axios';
import { toast } from 'react-hot-toast';
import { useTranslation } from 'react-i18next';

const REMINDER_OPTIONS = [
    { value: '', label: 'None' },
    { value: '5', label: '5 minutes before' },
    { value: '15', label: '15 minutes before' },
    { value: '30', label: '30 minutes before' },
    { value: '60', label: '1 hour before' },
    { value: '1440', label: '1 day before' },
];

const RECURRENCE_OPTIONS = [
    { value: '', label: 'Does not repeat' },
    { value: 'DAILY', label: 'Daily' },
    { value: 'WEEKLY', label: 'Weekly' },
    { value: 'MONTHLY', label: 'Monthly' },
    { value: 'YEARLY', label: 'Yearly' },
];

const DAYS_OF_WEEK = [
    { value: 'MO', label: 'Mo' },
    { value: 'TU', label: 'Tu' },
    { value: 'WE', label: 'We' },
    { value: 'TH', label: 'Th' },
    { value: 'FR', label: 'Fr' },
    { value: 'SA', label: 'Sa' },
    { value: 'SU', label: 'Su' },
];


export const CalendarSidebarRight = ({
    searchQuery,
    onSearchChange,
    eventPanel = null,
    onClosePanel,
    onSaved,
    calendars = [],
    onToggleSidebar,
    onOpenSearch,
    allNotes = [],
    onEventEdit,
}) => {
    const { t } = useTranslation();
    const [activeTab, setActiveTab] = React.useState('shortcuts'); // 'shortcuts' | 'availability'

    if (eventPanel) {
        return (
            <div className="w-72 flex-shrink-0 bg-[var(--bg-secondary)] border-l border-[var(--border-primary)] flex flex-col h-full overflow-hidden hidden lg:flex">
                <EventForm
                    mode={eventPanel.mode}
                    eventData={eventPanel.data}
                    initialDate={eventPanel.date}
                    calendars={calendars}
                    onClose={onClosePanel}
                    onSaved={onSaved}
                />
            </div>
        );
    }

    return (
        <div className="w-64 flex-shrink-0 bg-[var(--bg-secondary)] border-l border-[var(--border-primary)] flex flex-col h-full overflow-hidden hidden lg:flex text-sm text-[var(--text-secondary)]">
            {/* Tab Header */}
            <div className="flex border-b border-[var(--border-primary)]">
                <button
                    onClick={() => setActiveTab('shortcuts')}
                    className={`flex-1 py-3 text-[11px] font-bold uppercase tracking-wider transition-colors ${activeTab === 'shortcuts' ? 'text-[var(--gnosi-primary)] border-b-2 border-[var(--gnosi-primary)]' : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]'}`}
                >
                    {t('Shortcuts', 'Shortcuts')}
                </button>
                <button
                    onClick={() => setActiveTab('availability')}
                    className={`flex-1 py-3 text-[11px] font-bold uppercase tracking-wider transition-colors ${activeTab === 'availability' ? 'text-[var(--gnosi-primary)] border-b-2 border-[var(--gnosi-primary)]' : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]'}`}
                >
                    {t('Availability', 'Availability')}
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
                    placeholder={t('Search...', 'Search...')}
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
                    <h4 className="text-[11px] font-bold text-[var(--text-tertiary)] uppercase tracking-wider px-1">{t('Results', 'Results')}</h4>
                    {filteredResults.length > 0 ? (
                        filteredResults.map(res => (
                            <button
                                key={res.id}
                                onClick={() => onEventEdit?.(res.id)}
                                className="w-full text-left p-2 rounded-lg hover:bg-[var(--bg-tertiary)] transition-colors border border-transparent hover:border-[var(--border-primary)]"
                            >
                                <div className="text-[12px] font-semibold text-[var(--text-primary)] truncate">{res.title || res.metadata?.title || t('No Title', 'No Title')}</div>
                                <div className="text-[10px] text-[var(--text-tertiary)]">{res.metadata?.date?.split('T')[0] || t('None', 'None')}</div>
                            </button>
                        ))
                    ) : (
                        <div className="text-[11px] text-[var(--text-tertiary)] px-1 italic">{t('No matches', 'No matches')}</div>
                    )}
                </div>
            )}

            <div className="mt-8">
                <h3 className="text-[13px] font-bold text-[var(--text-primary)] flex items-center justify-between mb-5">
                    {t('Useful Shortcuts', 'Useful Shortcuts')}
                </h3>

                <div className="flex flex-col gap-2">
                    <button
                        onClick={onOpenSearch}
                        className="flex items-center justify-between w-full p-2 rounded-lg hover:bg-[var(--bg-tertiary)] transition-all group text-[12px] text-[var(--text-secondary)] font-medium"
                    >
                        <span>{t('Command Menu', 'Command Menu')}</span>
                        <div className="flex gap-1 opacity-60 group-hover:opacity-100">
                            <kbd className="border border-[var(--border-primary)] rounded px-1.5 py-[1px] bg-[var(--bg-secondary)] text-[var(--text-tertiary)] shadow-sm">⌘</kbd>
                            <kbd className="border border-[var(--border-primary)] rounded px-1.5 py-[1px] bg-[var(--bg-secondary)] text-[var(--text-tertiary)] shadow-sm">K</kbd>
                        </div>
                    </button>

                    <button
                        onClick={onToggleSidebar}
                        className="flex items-center justify-between w-full p-2 rounded-lg hover:bg-[var(--bg-tertiary)] transition-all group text-[12px] text-[var(--text-secondary)] font-medium"
                    >
                        <span>{t('Hide Sidebar', 'Hide Sidebar')}</span>
                        <kbd className="opacity-60 group-hover:opacity-100 border border-[var(--border-primary)] rounded px-2 py-[1px] bg-[var(--bg-secondary)] text-[var(--text-tertiary)] shadow-sm">.</kbd>
                    </button>

                    <button
                        onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: ',' }))}
                        className="flex items-center justify-between w-full p-2 rounded-lg hover:bg-[var(--bg-tertiary)] transition-all group text-[12px] text-[var(--text-secondary)] font-medium"
                    >
                        <span>{t('Go to Today', 'Go to Today')}</span>
                        <kbd className="opacity-60 group-hover:opacity-100 border border-[var(--border-primary)] rounded px-2 py-[1px] bg-[var(--bg-secondary)] text-[var(--text-tertiary)] shadow-sm">,</kbd>
                    </button>

                </div>
            </div>
        </div>
    );
};

/* ─── Formulari d'events (crear/editar) ─── */
const EventForm = ({ mode, eventData, initialDate, calendars, onClose, onSaved }) => {
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

    const [saving, setSaving] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const isInitializing = useRef(true);
    const lastSavedData = useRef(null);
    const autoSaveTimeoutRef = useRef(null);

    // Poblar camps
    useEffect(() => {
        isInitializing.current = true;
        lastSavedData.current = null;

        if (mode === 'edit' && eventData) {
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
            setCalendarId(hasCalendarOption ? tableId : '');
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
        } else {
            setTitle('');
            setStartDate(initialDate || '');
            setEndDate('');
            setStartTime('');
            setEndTime('');
            setAllDay(true);

            // Trobar el calendari predeterminat
            const defaultCal = calendars.find(c => c.is_default) || calendars[0];
            setCalendarId(defaultCal ? defaultCal.id : '');

            setLocation('');
            setReminder('');
            setRecurrence('');
            setSelectedDays([]);
            setEndType('never');
            setDescription('');
        }


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
                    if (window.confirm(t('Are you sure you want to delete this appointment?', 'Are you sure you want to delete this appointment?'))) {
                        handleDelete();
                    }
                }
            }
        };
        window.addEventListener('keydown', handleKey);
        return () => window.removeEventListener('keydown', handleKey);
    }, [onClose, mode, eventData]);

    const buildDatetime = (date, time) => {
        if (!date) return null;
        if (!allDay && time) return `${date}T${time}:00`;
        return date;
    };

    const handleSubmit = async (e, silent = true, snapshot = null) => {
        if (e) e.preventDefault();
        if (!title.trim() || !startDate) return;
        setSaving(true);

        const fullStart = buildDatetime(startDate, startTime);
        const fullEnd = buildDatetime(endDate, endTime);

        const metadata = {
            date: fullStart,
            source: 'Gnosi',
            all_day: allDay,
        };
        if (fullEnd) metadata.end_date = fullEnd;
        if (location.trim()) metadata.location = location.trim();
        if (reminder) metadata.reminder = reminder;

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
                metadata.database_table_id = calendarId; // Backwards compatibility
                metadata.table_name = cal.name;
                metadata.database_table_name = cal.name; // Backwards compatibility
            } else if (cal?.source) {
                metadata.source = cal.source;
            }
        }

        try {
            if (mode === 'edit' && eventData?.id) {
                const response = await axios.patch(`/api/vault/pages/${eventData.id}`, {
                    title: title.trim(),
                    content: description.trim() || undefined,
                    metadata,
                });
                let updatedEvent = response.data;
                if (eventData?.id) {
                    try {
                        const fullRes = await axios.get(`/api/vault/pages/${eventData.id}`);
                        updatedEvent = fullRes.data;
                    } catch (_) {
                        updatedEvent = {
                            id: eventData.id,
                            title: title.trim(),
                            content: description.trim() || '',
                            metadata,
                        };
                    }
                }
                
                if (!silent) {
                    toast.success(t('Event updated!', 'Event updated!'));
                    onSaved?.(updatedEvent);
                    onClose?.();
                } else {
                    // Guardado silencioso - actualizar estado local sin cerrar
                    onSaved?.(updatedEvent);
                }
                lastSavedData.current = snapshot || JSON.stringify({
                    title, allDay, startDate, endDate, startTime, endTime,
                    calendarId, location, reminder, recurrence, selectedDays,
                    endType, endCount, untilDate, description
                });
            } else {
                const response = await axios.post('/api/vault/pages', {
                    title: title.trim(),
                    content: description.trim() || '',
                    metadata,
                });
                let createdEvent = response.data;
                if (response.data?.id) {
                    try {
                        const fullRes = await axios.get(`/api/vault/pages/${response.data.id}`);
                        createdEvent = fullRes.data;
                    } catch (_) {
                        createdEvent = {
                            id: response.data.id,
                            title: response.data.title || title.trim(),
                            content: description.trim() || '',
                            metadata,
                        };
                    }
                }
                if (!silent) toast.success(t('Event created!', 'Event created!'));
                onSaved?.(createdEvent);
                if (!silent) onClose?.();
                lastSavedData.current = snapshot || JSON.stringify({
                    title, allDay, startDate, endDate, startTime, endTime,
                    calendarId, location, reminder, recurrence, selectedDays,
                    endType, endCount, untilDate, description
                });
            }
        } catch (err) {
            console.error('Error desant event:', err);
            toast.error(t('Error saving event.', 'Error saving event.'));
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async () => {
        if (!eventData?.id) return;
        setDeleting(true);
        try {
            await axios.delete(`/api/vault/pages/${eventData.id}`);
            toast.success(t('Event deleted.', 'Event deleted.'));
            onSaved?.();
            onClose?.();
        } catch (err) {
            console.error('Error eliminant event:', err);
            toast.error(t('Error deleting event.', 'Error deleting event.'));
        } finally {
            setDeleting(false);
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
                    <CalendarPlus size={16} className="text-[var(--gnosi-primary)]" />
                    <span className="text-[13px] font-semibold text-[var(--text-primary)]">
                        {mode === 'create' ? t('New Event', 'New Event') : t('Edit Event', 'Edit Event')}
                    </span>
                </div>
                <button onClick={onClose} className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] p-1 rounded-lg transition-colors">
                    <X size={16} />
                </button>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-4 space-y-3">
                {/* Títol */}
                <div>
                    <label className={labelClass}>{t('Title', 'Title')}</label>
                    <input
                        ref={titleRef}
                        type="text"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        onBlur={handleFieldBlur}
                        placeholder={t('Meeting, Medical appointment...', 'Meeting, Medical appointment...')}
                        className={inputClass}
                        required
                    />
                </div>

                {/* Tot el dia */}
                <div className="flex items-center justify-between py-1">
                    <label className="flex items-center gap-1.5 text-[12px] font-medium text-[var(--text-secondary)]">
                        <Sun size={14} className="text-amber-500" />
                        {t('All Day', 'All Day')}
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
                            {t('Start', 'Start')}
                        </label>
                        <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} onBlur={handleFieldBlur} className={inputClass} required />
                    </div>
                    <div>
                        <label className={labelClass}>
                            <CalendarPlus size={10} />
                            {t('End', 'End')} <span className="text-[var(--text-tertiary)] font-normal normal-case">{t('opt', '(opt.)')}</span>
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
                                {t('Start Time', 'Start Time')}
                            </label>
                            <input type="time" value={startTime} onChange={(e) => setStartTime(padTime(e.target.value))} onBlur={handleFieldBlur} className={inputClass} />
                        </div>
                        <div>
                            <label className={labelClass}>
                                <Clock size={10} />
                                {t('End Time', 'End Time')}
                            </label>
                            <input type="time" value={endTime} onChange={(e) => setEndTime(padTime(e.target.value))} onBlur={handleFieldBlur} className={inputClass} />
                        </div>
                    </div>
                )}

                {/* Calendari (Taules habilitades i calendaris) */}
                <div>
                    <label className={labelClass}>
                        <CalendarPlus size={10} />
                        {t('Calendar', 'Calendar')}
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
                        {t('Location / URL', 'Location / URL')}
                    </label>
                    <input
                        type="text"
                        value={location}
                        onChange={(e) => setLocation(e.target.value)}
                        onBlur={handleFieldBlur}
                        placeholder={t('Room 3, https://meet.google...', 'Room 3, https://meet.google...')}
                        className={inputClass}
                    />
                </div>

                {/* Recordatori */}
                <div>
                    <label className={labelClass}>
                        <Bell size={10} />
                        {t('Reminder', 'Reminder')}
                    </label>
                    <select value={reminder} onChange={(e) => setReminder(e.target.value)} onBlur={handleFieldBlur} className={inputClass}>
                        {REMINDER_OPTIONS.map(opt => (
                            <option key={opt.value} value={opt.value}>{t(opt.label, opt.label)}</option>
                        ))}
                    </select>
                </div>

                {/* Repetició */}
                <div className="space-y-2">
                    <label className={labelClass}>
                        <CalendarPlus size={10} />
                        {t('Recurrence', 'Recurrence')}
                    </label>
                    <select value={recurrence} onChange={(e) => {
                        setRecurrence(e.target.value);
                        setTimeout(() => handleFieldBlur(), 100);
                    }} className={inputClass}>
                        {RECURRENCE_OPTIONS.map(opt => (
                            <option key={opt.value} value={opt.value}>{t(opt.label, opt.label)}</option>
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
                                    {t(day.label, day.label)}
                                </button>
                            ))}
                        </div>
                    )}

                    {recurrence && (
                        <div className="mt-2 p-2.5 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-primary)] space-y-2">
                            <label className="text-[10px] font-bold text-[var(--text-tertiary)] uppercase tracking-tight">{t('Ends', 'Ends')}</label>

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
                                    <span className="text-[12px] text-[var(--text-secondary)] group-hover:text-[var(--text-primary)] transition-colors">{t('Never', 'Never')}</span>
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
                                        <span className="text-[12px] text-[var(--text-secondary)]">{t('After', 'After')}</span>
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
                                        <span className="text-[12px] text-[var(--text-secondary)]">{t('times', 'times')}</span>
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
                                        <span className="text-[12px] text-[var(--text-secondary)]">{t('On date', 'On date')}</span>
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
                        {t('Description', 'Description')}
                    </label>
                    <textarea
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        onBlur={handleFieldBlur}
                        placeholder={t('Add details...', 'Add details...')}
                        rows={2}
                        className={`${inputClass} resize-none`}
                    />
                </div>
            </form>

            {/* Footer Status Indicators */}
            <div className="px-4 py-2 border-t border-[var(--border-primary)] bg-[var(--bg-tertiary)] flex items-center justify-between">
                <div className="text-[10px] text-[var(--text-tertiary)] italic">
                    {saving ? t('Saving...', 'Saving...') : (deleting ? t('Deleting...', 'Deleting...') : t('Saved', 'Saved'))}
                </div>
                <div className="flex gap-2">
                    <span className="text-[10px] text-slate-300 font-mono">{t('ESC: Deselect', 'ESC: Deselect')}</span>
                </div>
            </div>
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
            toast.error(t('No email account configured.', 'No email account configured.'));
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
            toast.error(t('Error checking availability.', 'Error checking availability.'));
        } finally {
            setLoading(false);
        }
    };

    const copySlotsAsText = () => {
        if (freeSlots.length === 0) return;
        const text = `${t("Hi! I'm available on {{date}} at these times:", { date })}\n` +
            freeSlots.map(s => `- ${s.start} a ${s.end}`).join('\n') +
            ` \n\n${t('Which one works best for you?', 'Which one works best for you?')}`;
        navigator.clipboard.writeText(text);
        toast.success(t('Schedules copied to clipboard!', 'Schedules copied to clipboard!'));
    };

    return (
        <div className="p-5 space-y-6">
            <div className="space-y-4">
                <div>
                    <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2 block">{t('Day', 'Day')}</label>
                    <input
                        type="date"
                        value={date}
                        onChange={(e) => setDate(e.target.value)}
                        className="w-full bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500/20 outline-none"
                    />
                </div>

                <div className="pt-2">
                    <button
                        onClick={checkAvailability}
                        disabled={loading}
                        className="w-full py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold uppercase tracking-wider shadow-sm transition-all flex items-center justify-center gap-2"
                    >
                        {loading ? t('Searching...', 'Searching...') : t('Search Free Slots', 'Search Free Slots')}
                    </button>
                </div>
            </div>

            {freeSlots.length > 0 && (
                <div className="space-y-4 animate-in fade-in slide-in-from-top-2">
                    <div className="flex items-center justify-between">
                        <h4 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">{t('Free slots', 'Free slots')}</h4>
                        <button onClick={copySlotsAsText} className="text-[10px] text-indigo-600 hover:underline font-bold uppercase">{t('Copy text', 'Copy text')}</button>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                        {freeSlots.map((s, i) => (
                            <div key={i} className="px-2 py-1.5 bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-100 dark:border-indigo-800/50 rounded text-[11px] text-indigo-700 dark:text-indigo-300 font-medium text-center">
                                {s.start} - {s.end}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            <div className="pt-4 border-t border-slate-100 dark:border-slate-800">
                <p className="text-[10px] text-slate-400 italic">{t('The tool syncs in real time with your external calendars and Gnosi tables.', 'The tool syncs in real time with your external calendars and Gnosi tables.')}</p>
            </div>
        </div>
    );
};
