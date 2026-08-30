import { Calendar, ChevronLeft, ChevronRight, PanelLeft, PanelRight, Bell } from 'lucide-react';
import { AppHeader } from '../../components/AppHeader';
import type { CalendarPageController } from './useCalendarPage';

export function CalendarPageHeader({ controller }: {controller: CalendarPageController}) {
 const { t, currentTitle, showLeftSidebar, setShowLeftSidebar, showRightSidebar, setShowRightSidebar, isCompact, calendarRef, aiMeetingsEnabled, remindersEnabled, remindersLead, saveReminderSettings, handlePrev, handleNext, handleToday, handleViewChange, activeView } = controller;
 const btnClass = "flex items-center justify-center h-7 px-3 rounded-md text-[11px] font-bold tracking-tight uppercase transition-all border";
 return <>            <AppHeader icon={Calendar} title={`${t('calendar.title')} ${currentTitle ? `- ${currentTitle}` : ''}`}>
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
                            onClick={() => { void saveReminderSettings({ enabled: !remindersEnabled }); }}
                            className={`flex items-center gap-1 p-1.5 rounded transition-all ${remindersEnabled ? 'text-[var(--gnosi-primary)] bg-[var(--gnosi-primary)]/10' : 'text-[var(--text-tertiary)] hover:bg-[var(--bg-tertiary)]'}`}
                            title={remindersEnabled ? t('calendar.ai_reminders_active', "AI meeting reminders enabled") : t('calendar.ai_reminders_activate', "Enable AI meeting reminders")}
                        >
                            <Bell size={16} strokeWidth={2.5} />
                        </button>
                        {remindersEnabled && (
                            <select
                                value={remindersLead}
                                onChange={(e) => { void saveReminderSettings({ lead_minutes: Number(e.target.value) }); }}
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
                                onClick={() => { handleViewChange(view.id); }}
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

</>;
}
