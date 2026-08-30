import { History } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { ReaderArticle, ReaderSource } from '../../shared/api/reader';
import {
    readerArticleMeta,
    type ReaderArticleGroup,
} from './readerDashboardModel';

interface ReaderArticleListProps {
    readonly articlesLoading: boolean;
    readonly groups: readonly ReaderArticleGroup[];
    readonly locale: string;
    readonly onSelectArticle: (article: ReaderArticle) => void;
    readonly onToggleUnreadOnly: () => void;
    readonly selectedArticle: ReaderArticle | null;
    readonly selectedSource: ReaderSource | null;
    readonly showUnreadOnly: boolean;
    readonly totalArticles: number;
}

export function ReaderArticleList({
    articlesLoading,
    groups,
    locale,
    onSelectArticle,
    onToggleUnreadOnly,
    selectedArticle,
    selectedSource,
    showUnreadOnly,
    totalArticles,
}: ReaderArticleListProps) {
    const { t } = useTranslation();
    const countLabel = showUnreadOnly
        ? totalArticles === 1
            ? t('reader_articles_pending_one')
            : t('reader_articles_pending_other', { count: totalArticles })
        : t(
            totalArticles === 1 ? 'reader_articles_count_one' : 'reader_articles_count_other',
            {
                count: totalArticles,
                defaultValue: totalArticles === 1 ? '{{count}} article' : '{{count}} articles',
            },
        );
    return <div className={`w-full md:w-[360px] lg:w-[400px] border-r border-[var(--border-primary)] bg-[var(--bg-primary)] flex flex-col flex-shrink-0 ${selectedArticle ? 'hidden md:flex' : 'flex'}`}>
        <div className="px-6 py-5">
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                    <h2 className="text-base font-semibold text-[var(--text-primary)] truncate">
                        {selectedSource ? selectedSource.name : t('reader_all_articles')}
                    </h2>
                    <p className="text-xs text-[var(--text-tertiary)] mt-0.5">
                        {articlesLoading && totalArticles === 0 ? t('reader_loading') : countLabel}
                    </p>
                </div>
                <button onClick={onToggleUnreadOnly} title={showUnreadOnly ? t('reader_show_history') : t('reader_show_pending')} className={`flex-shrink-0 p-1.5 rounded-md text-xs transition-colors ${showUnreadOnly ? 'text-slate-400 dark:text-slate-500 hover:text-[var(--text-primary)] hover:bg-slate-100 dark:hover:bg-slate-800' : 'text-[var(--gnosi-blue)] bg-[var(--gnosi-blue)]/10'}`} type="button">
                    <History size={14} />
                </button>
            </div>
        </div>
        <div className="overflow-y-auto flex-1">
            {totalArticles === 0 && !articlesLoading ? <div className="px-6 py-12 text-sm text-[var(--text-tertiary)]">
                {selectedSource
                    ? t('reader_no_articles_source', { source: selectedSource.name })
                    : t('reader_up_to_date')}
            </div> : groups.map((group) => <section key={group.key}>
                <h3 className="px-6 pt-6 pb-2 text-[10px] uppercase tracking-[0.1em] font-semibold text-[var(--text-tertiary)]">{group.label}</h3>
                {group.items.map((article) => {
                    const selected = selectedArticle?.id === article.id;
                    const read = article.is_read;
                    return <button
                        key={article.id}
                        onClick={() => { onSelectArticle(article); }}
                        className={`relative block w-full px-6 py-4 border-t border-slate-100 dark:border-slate-800/60 cursor-pointer text-left transition-colors ${selected ? 'bg-slate-50/40 dark:bg-slate-800/30' : 'hover:bg-slate-50/60 dark:hover:bg-slate-800/30'}`}
                        type="button"
                    >
                        {selected ? <span className="absolute left-0 top-0 bottom-0 w-[2px] bg-[var(--gnosi-blue)]" aria-hidden="true" /> : null}
                        {!read && !selected ? <span className="absolute left-2.5 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-[var(--gnosi-blue)]" aria-hidden="true" /> : null}
                        <span className={`block text-[11px] mb-1.5 truncate ${read ? 'text-slate-400 dark:text-slate-500' : 'text-slate-500 dark:text-slate-400'}`}>
                            {readerArticleMeta(article, locale)}
                        </span>
                        <span className={`block text-[15px] leading-snug line-clamp-3 ${selected ? 'font-semibold text-[var(--text-primary)]' : read ? 'font-normal text-slate-400 dark:text-slate-500' : 'font-medium text-slate-800 dark:text-slate-100'}`}>
                            {article.title}
                        </span>
                    </button>;
                })}
            </section>)}
        </div>
    </div>;
}
