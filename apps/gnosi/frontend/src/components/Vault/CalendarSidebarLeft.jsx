import React, { useState } from 'react';
import { ChevronLeft, ChevronRight, Plus, Eye, EyeOff, Edit2, Star, ChevronRight as ChevronRightIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export const CalendarSidebarLeft = ({ 
    calendarRef, 
    availableCalendars, 
    selectedCalendars, 
    onToggleCalendar, 
    onRenameCalendar,
    onUpdateColor,
    onSetDefaultCalendar,
    defaultCalendar,
    onToggleSidebar,
    calendarConfigs,
    undatedNotes = [],
    onNoteClick
}) => {
    const { t, i18n } = useTranslation();
    const [currentDate, setCurrentDate] = useState(new Date());
    const [editingSource, setEditingSource] = useState(null);
    const [editName, setEditName] = useState('');
    const [colorPickerSource, setColorPickerSource] = useState(null);

    const CALENDAR_COLORS = [
        '#3b82f6', // Gnosi Blue
        '#ef4444', // Red
        '#10b981', // green
        '#f59e0b', // Yellow/Gold
        '#8b5cf6', // Purple
        '#ec4899', // Pink
        '#06b6d4', // Cyan
        '#f97316', // Orange
        '#71717a', // Gray
        '#1e293b', // Dark Slate
    ];

    const daysOfWeek = [
        t('day_mo', "Mo"), t('day_tu', "Tu"), t('day_we', "We"),
        t('day_th', "Th"), t('day_fr', "Fr"), t('day_sa', 'Sa'), t('day_su', "Su")
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
        const newDate = new Date(year, month - 1, 1);
        setCurrentDate(newDate);
        calendarRef.current?.getApi().prev();
    };

    const handleNextMonth = () => {
        const newDate = new Date(year, month + 1, 1);
        setCurrentDate(newDate);
        calendarRef.current?.getApi().next();
    };

    const handleDayClick = (date) => {
        calendarRef.current?.getApi().gotoDate(date);
    };

    const monthName = currentDate.toLocaleString(i18n.resolvedLanguage || i18n.language || 'en', { month: 'long', year: 'numeric' });
    const capitalizedMonth = monthName.charAt(0).toUpperCase() + monthName.slice(1);

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
                <button 
                    onClick={onToggleSidebar}
                    className="p-1 hover:bg-[var(--bg-secondary)] rounded text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
                    title={t('common.collapse', "Collapse")}
                >
                    <ChevronLeft size={16} />
                </button>
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
                <span className="gnosi-sidebar-section-title">
                    {t('calendars', "Calendars")}
                </span>
                <button
                    onClick={() => window.dispatchEvent(new CustomEvent('open-settings', { detail: 'integrations' }))}
                    className="p-1 hover:bg-[var(--bg-secondary)] rounded text-[var(--text-tertiary)] hover:text-[var(--gnosi-primary)] transition-colors"
                    title={t('add_calendar', "Add calendar")}
                >
                    <Plus size={14} strokeWidth={2.5} />
                </button>
            </div>

            {/* Sources */}
            <div className="mb-2 px-[11px]">
                {(() => {
                    const groups = {};
                    availableCalendars.filter(s => s !== 'es_es').forEach(source => {
                        const config = calendarConfigs.find(c => c.source === source);
                        const account = config?.account || 'Other';
                        if (!groups[account]) groups[account] = [];
                        groups[account].push({ source, config });
                    });

                    return Object.entries(groups).map(([account, calendars]) => {
                        const isAccount = account.includes('@');
                        const hasMultiple = calendars.length > 1;

                        return (
                            <div key={account} className="mb-2">
                                {isAccount && hasMultiple && (
                                    <div className="px-2 py-1 text-[10px] font-bold text-[var(--text-tertiary)]/50 uppercase tracking-tighter">
                                        {account}
                                    </div>
                                )}
                                {calendars.map(({ source, config }) => {
                                    const isVisible = selectedCalendars.has(source);
                                    const color = config?.color || 'var(--gnosi-primary)';
                                    const isEditing = editingSource === source;
                                    const displayName = config?.name || getCalendarName(source);

                                    return (
                                        <div key={source} className={`flex items-center justify-between group rounded transition-colors mb-0.5 px-2 py-1.5 -mx-2 hover:bg-[var(--bg-secondary)] border border-transparent ${isEditing ? '!bg-[var(--bg-primary)] border-[var(--border-primary)] shadow-sm' : ''} ${!isVisible && !isEditing ? 'opacity-50' : ''}`}>
                                            <div className="flex items-center gap-2.5 w-full" onClick={() => {
                                                if (isEditing) return;
                                                // If clicking the name area (not the color box specifically), just toggle
                                                onToggleCalendar?.(source);
                                            }}>
                                                <div className="relative">
                                                    <div 
                                                        className="w-3.5 h-3.5 rounded flex-shrink-0 cursor-pointer hover:scale-110 transition-transform shadow-sm" 
                                                        style={{ 
                                                            backgroundColor: color, 
                                                            border: `1.5px solid ${isVisible ? 'rgba(255,255,255,0.2)' : 'var(--text-tertiary)'}`,
                                                            opacity: isVisible ? 1 : 0.4,
                                                            boxShadow: colorPickerSource === source ? `0 0 0 2px var(--gnosi-primary)` : 'none'
                                                        }}
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            setColorPickerSource(colorPickerSource === source ? null : source);
                                                        }}
                                                    ></div>

                                                    {colorPickerSource === source && (
                                                        <div className="absolute top-[120%] left-0 z-[100] bg-[var(--bg-secondary)] border border-[var(--border-primary)] p-2 rounded-lg shadow-2xl grid grid-cols-5 gap-1.5 animate-in fade-in zoom-in-95 duration-200 min-w-[120px]"
                                                             onClick={(e) => e.stopPropagation()}
                                                             onMouseLeave={() => setColorPickerSource(null)}>
                                                            {CALENDAR_COLORS.map(c => (
                                                                <div 
                                                                    key={c}
                                                                    className="w-4 h-4 rounded-full cursor-pointer hover:scale-125 transition-all border border-black/10 ring-offset-2 hover:ring-2 hover:ring-[var(--gnosi-primary)]"
                                                                    style={{ backgroundColor: c }}
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        onUpdateColor?.(source, c);
                                                                        setColorPickerSource(null);
                                                                    }}
                                                                />
                                                            ))}
                                                        </div>
                                                    )}
                                                </div>
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
                                                    <span className="text-[13px] text-[var(--text-primary)] font-medium truncate w-full cursor-pointer" title={displayName}>
                                                        {displayName}
                                                    </span>
                                                )}
                                            </div>

                                            {!isEditing && (
                                                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                    <button
                                                        className={`p-1 hover:bg-[var(--bg-tertiary)] rounded transition-colors ${defaultCalendar === source ? 'text-[var(--gnosi-primary)]' : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)]'}`}
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            onSetDefaultCalendar?.(source);
                                                        }}
                                                        title={t('set_default_calendar', "Set as default")}
                                                    >
                                                        <Star size={12} fill={defaultCalendar === source ? 'var(--gnosi-primary)' : 'none'} />
                                                    </button>
                                                    <button
                                                        className="p-1 hover:bg-[var(--bg-tertiary)] rounded text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            setEditingSource(source);
                                                            setEditName(displayName);
                                                        }}
                                                        title={t('rename_calendar', "Rename calendar")}
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
                        );
                    });
                })()}
            </div>

            {undatedNotes.length > 0 && (
                <>
                    <hr className="border-[var(--border-primary)] mx-4 my-2" />
                    <div className="px-[11px] pt-2 pb-2">
                        <span className="gnosi-sidebar-section-title">
                            {t('pending_notes', "Unscheduled")}
                        </span>
                        <div className="mt-2 space-y-1">
                            {undatedNotes.map(note => (
                                <div 
                                    key={note.id}
                                    onClick={() => onNoteClick(note.id)}
                                    className="px-2 py-1.5 rounded hover:bg-[var(--bg-secondary)] cursor-pointer text-[13px] text-[var(--text-primary)] font-medium truncate transition-colors border border-transparent border-dashed hover:border-[var(--gnosi-primary)]/20"
                                    title={note.metadata?.title || note.title}
                                >
                                    {note.metadata?.title || note.title}
                                </div>
                            ))}
                        </div>
                    </div>
                </>
            )}
        </div>
    );
};
