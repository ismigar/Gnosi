import {
    ChevronDown,
    ChevronRight,
    Headphones,
    Inbox,
    Loader,
    Play,
    RotateCw,
    X,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { ReaderPodcastInfo } from '../../../shared/api/reader';
import {
    readerFaviconUrl,
    type ReaderSourceGroup,
} from './readerDashboardModel';

interface ReaderChannelsProps {
    readonly collapsedCategories: ReadonlySet<string>;
    readonly countsBySource: ReadonlyMap<number, number>;
    readonly generatingPodcast: boolean;
    readonly groups: readonly ReaderSourceGroup[];
    readonly mobileOpen: boolean;
    readonly onClose: () => void;
    readonly onGeneratePodcast: () => void;
    readonly onSelectSource: (sourceId: number | null) => void;
    readonly onToggleCategory: (category: string) => void;
    readonly podcastEnabled: boolean;
    readonly podcastInfo: ReaderPodcastInfo | null;
    readonly podcastProgress: string;
    readonly podcastUrl: string | null;
    readonly selectedSourceId: number | null;
    readonly sourceCount: number;
    readonly unreadCount: number;
}

export function ReaderChannels({
    collapsedCategories,
    countsBySource,
    generatingPodcast,
    groups,
    mobileOpen,
    onClose,
    onGeneratePodcast,
    onSelectSource,
    onToggleCategory,
    podcastEnabled,
    podcastInfo,
    podcastProgress,
    podcastUrl,
    selectedSourceId,
    sourceCount,
    unreadCount,
}: ReaderChannelsProps) {
    const { t } = useTranslation();
    const sourceCountLabel = sourceCount === 1
        ? t('reader_sources_count_one')
        : t('reader_sources_count_other', { count: sourceCount });
    const displayCategory = (category: string): string => (
        category === 'Uncategorized' || category === 'Sense categoria'
            ? t('reader_uncategorized')
            : category
    );
    return <aside className={`bg-[var(--bg-secondary)]/50 border-r border-[var(--border-primary)] flex-col flex-shrink-0 md:flex md:relative md:w-60 lg:w-64 ${mobileOpen ? 'flex fixed inset-y-0 left-0 w-72 z-50 shadow-2xl' : 'hidden'}`}>
        <div className="px-5 py-5 flex items-center justify-between gap-2">
            <div className="min-w-0">
                <h2 className="gnosi-sidebar-section-title">{t('reader_channels')}</h2>
                <p className="text-xs text-[var(--text-tertiary)] mt-0.5">
                    {sourceCount === 0 ? t('reader_no_sources') : sourceCountLabel}
                </p>
            </div>
            <button onClick={onClose} title={t('reader_close_channels')} className="md:hidden p-1.5 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors flex-shrink-0" type="button">
                <X size={16} />
            </button>
        </div>
        <nav className="overflow-y-auto flex-1 pb-2">
            <button onClick={() => { onSelectSource(null); }} className={`relative w-full flex items-center justify-between px-5 py-2 text-sm transition-colors ${selectedSourceId === null ? 'text-[var(--text-primary)] font-semibold' : 'text-slate-600 dark:text-slate-300 hover:text-[var(--text-primary)]'}`} type="button">
                {selectedSourceId === null ? <span className="absolute left-0 top-0 bottom-0 w-[2px] bg-[var(--gnosi-blue)]" aria-hidden="true" /> : null}
                <span className="flex items-center gap-2 min-w-0">
                    <Inbox size={14} className="flex-shrink-0 text-slate-400" />
                    <span className="truncate">{t('reader_all')}</span>
                </span>
                <span className="text-[11px] text-[var(--text-tertiary)] tabular-nums flex-shrink-0">{unreadCount}</span>
            </button>
            {groups.map((group) => {
                const collapsed = collapsedCategories.has(group.category);
                return <div key={group.category} className="mt-3">
                    <button onClick={() => { onToggleCategory(group.category); }} className="w-full flex items-center justify-between px-5 py-1.5 group" type="button">
                        <span className="flex items-center gap-1.5 min-w-0">
                            {collapsed
                                ? <ChevronRight size={11} className="text-slate-400 flex-shrink-0" />
                                : <ChevronDown size={11} className="text-slate-400 flex-shrink-0" />}
                            <span className="gnosi-sidebar-section-title truncate">{displayCategory(group.category)}</span>
                        </span>
                        {group.unread > 0 ? <span className="text-[10px] text-[var(--text-tertiary)] tabular-nums">{group.unread}</span> : null}
                    </button>
                    {!collapsed ? group.items.map((source) => {
                        const active = selectedSourceId === source.id;
                        const count = countsBySource.get(source.id) ?? 0;
                        const favicon = readerFaviconUrl(source.url);
                        return <button key={source.id} onClick={() => { onSelectSource(source.id); }} className={`relative w-full flex items-center justify-between pl-5 pr-5 py-1.5 text-sm transition-colors ${active ? 'text-[var(--text-primary)] font-medium' : 'text-slate-600 dark:text-slate-300 hover:text-[var(--text-primary)]'}`} type="button">
                            {active ? <span className="absolute left-0 top-0 bottom-0 w-[2px] bg-[var(--gnosi-blue)]" aria-hidden="true" /> : null}
                            <span className="flex items-center gap-2 min-w-0 flex-1">
                                <span className="w-4 h-4 flex-shrink-0 flex items-center justify-center">
                                    {favicon ? <img src={favicon} alt="" loading="lazy" referrerPolicy="no-referrer" className="w-3.5 h-3.5 rounded-sm opacity-90" onError={(event) => { event.currentTarget.style.visibility = 'hidden'; }} /> : null}
                                </span>
                                <span className="truncate">{source.name}</span>
                            </span>
                            {count > 0 ? <span className={`text-[11px] tabular-nums flex-shrink-0 ml-2 ${active ? 'text-[var(--gnosi-blue)]' : 'text-[var(--text-tertiary)]'}`}>{count}</span> : null}
                        </button>;
                    }) : null}
                </div>;
            })}
        </nav>
        {podcastEnabled ? <div className="border-t border-[var(--border-primary)] bg-[var(--bg-primary)] px-4 py-3">
            {generatingPodcast ? <div className="flex items-center gap-3">
                <Loader size={16} className="animate-spin text-[var(--gnosi-blue)] flex-shrink-0" />
                <div className="flex-1 min-w-0">
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 mb-1">{t('reader_podcast_generating')}</div>
                    <div className="text-xs text-slate-700 dark:text-slate-200 truncate">{podcastProgress || t('reader_podcast_synthesizing')}</div>
                </div>
            </div> : podcastUrl ? <div>
                <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2 min-w-0">
                        <Headphones size={14} className="text-slate-400 dark:text-slate-500 flex-shrink-0" />
                        <span className="text-[11px] text-slate-500 dark:text-slate-400 truncate">{t('reader_podcast_daily')}{podcastInfo?.formatted_date ? ` · ${podcastInfo.formatted_date}` : ''}</span>
                    </div>
                    <button onClick={onGeneratePodcast} title={t('reader_podcast_regenerate')} className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors p-1 -mr-1" type="button"><RotateCw size={12} /></button>
                </div>
                <audio controls preload="none" className="w-full h-8" src={podcastUrl}>{t('reader_podcast_unsupported')}</audio>
            </div> : <button onClick={onGeneratePodcast} className="w-full flex items-center justify-center gap-2 py-2 rounded-md text-xs text-slate-600 dark:text-slate-300 hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] transition-colors border border-[var(--border-primary)]" type="button">
                <Play size={12} fill="currentColor" /><span>{t('reader_podcast_generate')}</span>
            </button>}
        </div> : null}
    </aside>;
}
