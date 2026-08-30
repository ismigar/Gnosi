import { useMemo } from 'react';
import { Search, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { dispatchWindowEvent } from '../../../../shared/platform/browser-events';
import type { CalendarSidebarRightProps } from './calendarTypes';
export const DefaultContent = ({ searchQuery, onSearchChange, onToggleSidebar, onOpenSearch, allNotes = [], onEventEdit }: CalendarSidebarRightProps) => {
    const { t } = useTranslation();

    // We filter notes based on the search to show them here
    const filteredResults = useMemo(() => {
        if (!searchQuery.trim()) return [];
        const lower = searchQuery.toLowerCase();
        return allNotes.filter(note => {
            const title = (note.title || note.metadata.title || '').toLowerCase();
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
                    onChange={(e) => { onSearchChange(e.target.value); }}
                    className="flex-1 bg-transparent border-none outline-none text-[13px] placeholder:text-[var(--text-tertiary)] text-[var(--text-primary)]"
                />
                {searchQuery && (
                    <button onClick={() => { onSearchChange(''); }} className="p-0.5 hover:bg-[var(--bg-tertiary)] rounded">
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
                                <div className="text-[12px] font-semibold text-[var(--text-primary)] truncate">{res.title || res.metadata.title || t('common.untitled', "Untitled")}</div>
                                <div className="text-[10px] text-[var(--text-tertiary)]">{res.metadata.date?.split('T')[0] || t('calendar.no_date', "No date")}</div>
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
                        onClick={() => dispatchWindowEvent(new KeyboardEvent('keydown', { key: ',' }))}
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
