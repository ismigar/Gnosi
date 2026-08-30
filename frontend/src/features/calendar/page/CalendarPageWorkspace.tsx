import { DigitalBrainCalendar } from '../../../components/Vault/DigitalBrainCalendar';
import { CalendarSidebarLeft } from '../../../components/Vault/CalendarSidebarLeft';
import { CalendarSidebarRight } from '../../../components/Vault/CalendarSidebarRight';
import type { CalendarPageController } from './useCalendarPage';

export function CalendarPageWorkspace({ controller }: {controller: CalendarPageController}) {
 const { t, isCompact, showLeftSidebar, showRightSidebar, setShowLeftSidebar, setShowRightSidebar, calendarRef, calendarConfigs, selectedCalendars, toggleCalendar, renameCalendar, updateColor, setDefaultCalendar, integrations, undatedNotes, handleEventClick, loading, pages, externalEvents, searchQuery, handleContextMenu, fetchPages, setCurrentTitle, setDateRange, handleCreateEventAtDate, colorMap, setSearchQuery, eventPanel, closePanel, handleEventSaved, handleRsvp, setIsGlobalSearchOpen, defaultCalendarId } = controller;
 return <>            <div className="calendar-workspace">
                {isCompact && (showLeftSidebar || showRightSidebar) && (
                    <button
                        type="button"
                        className="calendar-workspace__backdrop"
                        onClick={() => {
                            setShowLeftSidebar(false);
                            setShowRightSidebar(false);
                        }}
                        aria-label={t('common.close', 'Close')}
                    />
                )}
                {/* Barra Esquerra Col·lapsable */}
                <div className={`calendar-workspace__sidebar calendar-workspace__sidebar--left ${showLeftSidebar ? 'is-open' : ''}`}>
                    <div className="calendar-workspace__sidebar-content calendar-workspace__sidebar-content--left">
<CalendarSidebarLeft
                            calendarRef={calendarRef}
                            availableCalendars={calendarConfigs.map(c => c.source)}
                            selectedCalendars={selectedCalendars}
                            onToggleCalendar={toggleCalendar}
                            onRenameCalendar={(...args) => { void renameCalendar(...args); }}
                            onUpdateColor={(...args) => { void updateColor(...args); }}
                            onToggleSidebar={() => { setShowLeftSidebar(false); }}
                            onSetDefaultCalendar={(source) => { void setDefaultCalendar(source); }}
                            defaultCalendar={integrations.default_calendar}
                            calendarConfigs={calendarConfigs}
                            undatedNotes={undatedNotes}
                            onNoteClick={(id) => { void handleEventClick(id); }}
                        />
                    </div>
                </div>

                <div className="calendar-workspace__canvas">
                    {loading ? (
                        <div className="flex items-center justify-center h-full text-[var(--text-secondary)]" role="status" aria-live="polite">
                            {t('calendar.loading_events')}
                        </div>
                    ) : (
                        <div className="h-full">
                            <DigitalBrainCalendar
                                allNotes={[...pages, ...externalEvents]}
                                searchQuery={searchQuery}
                                selectedCalendars={selectedCalendars}

                                onEventEdit={(...args) => { void handleEventClick(...args); }}
                                onContextMenu={handleContextMenu}
                                onRefresh={() => { void fetchPages(); }}
                                calendarRef={calendarRef}
                                onTitleChange={setCurrentTitle}
                                onDatesSet={(range) => { setDateRange(prev =>
                                    prev?.start === range.start && prev.end === range.end ? prev : range
                                ); }}
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
                <div className={`calendar-workspace__sidebar calendar-workspace__sidebar--right ${showRightSidebar ? 'is-open' : ''}`}>
                    <div className="calendar-workspace__sidebar-content calendar-workspace__sidebar-content--right">
                        <CalendarSidebarRight
                            searchQuery={searchQuery}
                            onSearchChange={setSearchQuery}
                            eventPanel={eventPanel}
                            onClosePanel={closePanel}
                            onSaved={handleEventSaved}
                            onRsvp={(status) => { void handleRsvp(status); }}
                            calendars={calendarConfigs}
                            onToggleSidebar={() => { setShowRightSidebar(false); }}
                            onOpenSearch={() => { setIsGlobalSearchOpen(true); }}
                            allNotes={pages}
                            onEventEdit={(...args) => { void handleEventClick(...args); }}
                            userEmail={integrations.calendars?.[0]?.email || ''}
                            defaultCalendarId={defaultCalendarId}
                        />
                    </div>
                </div>
            </div>

</>;
}
