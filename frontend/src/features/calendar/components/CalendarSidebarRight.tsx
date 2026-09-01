import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EventForm } from './calendar-sidebar-right/EventForm';
import { DefaultContent } from './calendar-sidebar-right/DefaultContent';
import { AvailabilityTool } from './calendar-sidebar-right/AvailabilityTool';
import type { CalendarSidebarRightProps } from './calendar-sidebar-right/calendarTypes';
export type { CalendarSidebarRightProps } from './calendar-sidebar-right/calendarTypes';
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
    defaultCalendarId = '',
}: CalendarSidebarRightProps) => {
    const { t } = useTranslation();
    const [activeTab, setActiveTab] = useState('shortcuts'); // 'shortcuts' | 'availability'

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
                    onClick={() => { setActiveTab('shortcuts'); }}
                    className={`flex-1 py-3 text-[11px] font-bold uppercase tracking-wider transition-colors ${activeTab === 'shortcuts' ? 'text-[var(--gnosi-primary)] border-b-2 border-[var(--gnosi-primary)]' : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]'}`}
                >
                    {t('calendar.shortcuts_tab', 'Shortcuts')}
                </button>
                <button
                    onClick={() => { setActiveTab('availability'); }}
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
