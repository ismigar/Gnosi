import React, { useState } from 'react';
import { ChevronLeft, ChevronRight, Plus, Eye, EyeOff, Edit2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export const CalendarSidebarLeft = ({ calendarRef, availableCalendars, selectedCalendars, onToggleCalendar, onRenameCalendar, calendarConfigs }) => {
    const { t, i18n } = useTranslation();
    const [currentDate, setCurrentDate] = useState(new Date());
    const [editingSource, setEditingSource] = useState(null);
    const [editName, setEditName] = useState('');

    const daysOfWeek = [
        t('day_mo', 'Lu'), t('day_tu', 'Ma'), t('day_we', 'Mi'),
        t('day_th', 'Ju'), t('day_fr', 'Vi'), t('day_sa', 'Sa'), t('day_su', 'Do')
    ];

    // Calendar Generation Math
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();

    const firstDay = new Date(year, month, 1).getDay(); // 0 is Sunday, 1 is Monday
    const offset = firstDay === 0 ? 6 : firstDay - 1; // Adjust for Monday start
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const daysInPrevMonth = new Date(year, month, 0).getDate();

    const gridDays = [];
    // Prev month padding
    for (let i = offset - 1; i >= 0; i--) {
        gridDays.push({ num: daysInPrevMonth - i, isCurrent: false, date: new Date(year, month - 1, daysInPrevMonth - i) });
    }
    // Current month days
    for (let i = 1; i <= daysInMonth; i++) {
        const d = new Date(year, month, i);
        gridDays.push({ num: i, isCurrent: true, isToday: new Date().toDateString() === d.toDateString(), date: d });
    }
    // Next month padding
    const remaining = 42 - gridDays.length;
    for (let i = 1; i <= remaining; i++) {
        gridDays.push({ num: i, isCurrent: false, date: new Date(year, month + 1, i) });
    }

    const handlePrevMonth = () => {
        setCurrentDate(new Date(year, month - 1, 1));
        calendarRef.current?.getApi().prev();
    };

    const handleNextMonth = () => {
        setCurrentDate(new Date(year, month + 1, 1));
        calendarRef.current?.getApi().next();
    };

    const handleDayClick = (date) => {
        calendarRef.current?.getApi().gotoDate(date);
    };

    const monthName = currentDate.toLocaleString(i18n.language || 'ca-ES', { month: 'long', year: 'numeric' });
    const capitalizedMonth = monthName.charAt(0).toUpperCase() + monthName.slice(1);

    const getCalendarColor = (source, index) => {
        const config = calendarConfigs.find(c => c.source === source);
        return config?.color || 'var(--gnosi-primary)';
    };

    const getCalendarName = (source) => {
        const config = calendarConfigs?.find(c => c.source === source);
        if (config?.name) return config.name;

        try {
            const url = new URL(source);
            const path = url.pathname.split('/').pop().replace('.ics', '');
            return path || url.hostname;
        } catch {
            return source;
        }
    };

    return (
        <div className="w-64 flex-shrink-0 bg-[var(--bg-primary)] border-r border-[var(--border-primary)] flex flex-col h-full overflow-y-auto hidden md:flex text-sm text-[var(--text-secondary)]">
            {/* Mini Calendar Header */}
            <div className="p-4 pb-2 flex items-center justify-between">
                <span className="font-semibold text-[var(--text-primary)]">{capitalizedMonth}</span>
                <div className="flex gap-1">
                    <button onClick={handlePrevMonth} className="p-1 hover:bg-[var(--bg-secondary)] rounded text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"><ChevronLeft size={16} /></button>
                    <button onClick={handleNextMonth} className="p-1 hover:bg-[var(--bg-secondary)] rounded text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"><ChevronRight size={16} /></button>
                </div>
            </div>

            {/* Mini Calendar Grid */}
            <div className="px-4 pb-4">
                <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-semibold text-[var(--text-tertiary)]/60 mb-2">
                    {daysOfWeek.map(d => <div key={d}>{d}</div>)}
                </div>
                <div className="grid grid-cols-7 gap-y-1 gap-x-1 text-center text-[13px]">
                    {gridDays.map((dayObj, i) => (
                        <div
                            key={i}
                            onClick={() => handleDayClick(dayObj.date)}
                            className={`py-1 flex items-center justify-center w-6 h-6 mx-auto transition-colors ${dayObj.isToday
                                ? 'bg-[var(--gnosi-primary)] text-white font-semibold rounded-full cursor-pointer shadow-sm'
                                : dayObj.isCurrent
                                    ? 'text-[var(--text-primary)] font-bold cursor-pointer hover:bg-[var(--bg-secondary)] rounded-full'
                                    : 'text-[var(--text-tertiary)]/40 cursor-default font-normal'
                                }`}
                        >
                            {dayObj.num}
                        </div>
                    ))}
                </div>
            </div>

            <hr className="border-[var(--border-primary)] mx-4" />

            {/* Calendars Header */}
            <div className="px-[11px] pt-4 pb-2 flex items-center justify-between group">
                <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-secondary)]/60">
                    {t('calendars', 'Calendaris')}
                </span>
                <button
                    onClick={() => window.dispatchEvent(new CustomEvent('open-settings', { detail: 'integrations' }))}
                    className="p-1 hover:bg-[var(--bg-secondary)] rounded text-[var(--text-tertiary)] hover:text-[var(--gnosi-primary)] transition-colors"
                    title={t('add_calendar', 'Afegir calendari')}
                >
                    <Plus size={14} strokeWidth={2.5} />
                </button>
            </div>

            {/* Sources */}
            <div className="mb-5 px-[11px]">
                {availableCalendars.filter(s => s !== 'es_es').map((source, index) => {
                    const isVisible = selectedCalendars.has(source);
                    const color = getCalendarColor(source, index);
                    const isEditing = editingSource === source;
                    const displayName = getCalendarName(source);

                    return (
                        <div key={source} className={`flex items-center justify-between group rounded transition-colors mb-0.5 px-2 py-1.5 -mx-2 hover:bg-[var(--bg-secondary)] border border-transparent ${isEditing ? '!bg-[var(--bg-primary)] border-[var(--border-primary)] shadow-sm' : ''} ${!isVisible && !isEditing ? 'opacity-50' : ''}`}>
                            <div className="flex items-center gap-2.5 w-full overflow-hidden" onClick={() => !isEditing && onToggleCalendar && onToggleCalendar(source)}>
                                <div className="w-3 h-3 rounded flex-shrink-0 cursor-pointer" style={{ backgroundColor: isVisible ? color : 'transparent', border: `2px solid ${isVisible ? color : 'var(--text-tertiary)'}` }}></div>
                                {isEditing ? (
                                    <input
                                        type="text"
                                        className="text-[13px] text-[var(--text-primary)] font-medium bg-transparent border-none outline-none w-full mr-2"
                                        value={editName}
                                        onChange={(e) => setEditName(e.target.value)}
                                        onBlur={() => {
                                            if (editName !== displayName) onRenameCalendar?.(source, editName);
                                            setEditingSource(null);
                                        }}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') {
                                                if (editName !== displayName) onRenameCalendar?.(source, editName);
                                                setEditingSource(null);
                                            } else if (e.key === 'Escape') {
                                                setEditingSource(null);
                                            }
                                        }}
                                        autoFocus
                                        onClick={(e) => e.stopPropagation()}
                                    />
                                ) : (
                                    <span className="text-[13px] text-[var(--text-primary)] font-medium truncate w-full cursor-pointer" title={displayName}>{displayName}</span>
                                )}
                            </div>

                            {!isEditing && (
                                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <button
                                        className="p-1 hover:bg-[var(--bg-tertiary)] rounded text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setEditingSource(source);
                                            setEditName(displayName);
                                        }}
                                        title={t('rename_calendar', 'Reanomenar calendari')}
                                    >
                                        <Edit2 size={12} />
                                    </button>
                                    <div className="cursor-pointer p-1" onClick={() => onToggleCalendar && onToggleCalendar(source)}>
                                        {!isVisible ? <EyeOff size={14} className="text-[var(--text-tertiary)]" /> : <Eye size={14} className="text-[var(--text-tertiary)]" />}
                                    </div>
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

        </div>
    );
};
