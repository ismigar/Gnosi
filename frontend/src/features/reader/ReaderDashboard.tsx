import { useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, Menu, RotateCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { AppHeader } from '../../shared/ui/layout/AppHeader';
import { toast } from '../../lib/toast';
import { logError } from '../../lib/notifyError';
import { getIntlLocale } from '../../locales/registry';
import { usePlugins } from '../../plugins/usePlugins';
import {
    fetchReaderArticle,
    fetchReaderPodcastStatus,
    generateReaderPodcast,
    readerPodcastUrl,
    type ReaderArticle,
    type ReaderSource,
} from '../../shared/api/reader';
import { runScheduledTask } from '../../shared/api/scheduler';
import {
    useMarkReaderArticleRead,
    useReaderArticles,
    useReaderInventory,
    useReaderPodcastInfo,
    useReaderSources,
} from '../../shared/api/useReaderData';
import { emitAppEvent } from '../../shared/platform/app-events';
import { ReaderArticleContent } from './page/ReaderArticleContent';
import { ReaderArticleList } from './page/ReaderArticleList';
import { ReaderChannels } from './page/ReaderChannels';
import {
    groupReaderArticles,
    groupReaderSources,
    readerCountsBySource,
} from './page/readerDashboardModel';

const EMPTY_ARTICLES: readonly ReaderArticle[] = Object.freeze([]);
const EMPTY_SOURCES: readonly ReaderSource[] = Object.freeze([]);

export default function ReaderDashboard() {
    const { t, i18n } = useTranslation();
    const { isEnabled } = usePlugins();
    const podcastEnabled = isEnabled('ai-platform');
    const locale = getIntlLocale(i18n.resolvedLanguage || i18n.language);
    const [selectedArticle, setSelectedArticle] = useState<ReaderArticle | null>(null);
    const [syncing, setSyncing] = useState(false);
    const [generatingPodcast, setGeneratingPodcast] = useState(false);
    const [generatedPodcastUrl, setGeneratedPodcastUrl] = useState<string | null>(null);
    const [selectedSourceId, setSelectedSourceId] = useState<number | null>(null);
    const [showUnreadOnly, setShowUnreadOnly] = useState(true);
    const [collapsedCategories, setCollapsedCategories] = useState<ReadonlySet<string>>(
        () => new Set(),
    );
    const [mobileChannelsOpen, setMobileChannelsOpen] = useState(false);
    const [podcastProgress, setPodcastProgress] = useState('');
    const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const sourcesQuery = useReaderSources();
    const articlesQuery = useReaderArticles({
        unreadOnly: showUnreadOnly,
        sourceIds: selectedSourceId === null ? undefined : [selectedSourceId],
    });
    const inventoryQuery = useReaderInventory({ unreadOnly: true });
    const podcastInfoQuery = useReaderPodcastInfo(podcastEnabled);
    const markArticleRead = useMarkReaderArticleRead();
    const sources = sourcesQuery.data ?? EMPTY_SOURCES;
    const articles = articlesQuery.data ?? EMPTY_ARTICLES;
    const inventory = inventoryQuery.data;
    const podcastInfo = podcastInfoQuery.data?.exists ? podcastInfoQuery.data : null;
    const podcastUrl = podcastEnabled
        ? generatedPodcastUrl ?? (podcastInfo ? readerPodcastUrl() : null)
        : null;

    useEffect(() => {
        const canonicalMatch = window.location.pathname.match(
            /^\/@[^/]+\/reader\/article\/([^/]+)\/?$/,
        );
        const encodedArticleId = canonicalMatch?.[1];
        const articleId = encodedArticleId
            ? decodeURIComponent(encodedArticleId)
            : new URLSearchParams(window.location.search).get('article');
        if (!articleId) return undefined;
        const numericArticleId = Number(articleId);
        let active = true;
        if (!Number.isInteger(numericArticleId)) {
            toast.error(t(
                'reader_analysis_evidence_error',
                'The evidence article is no longer available.',
            ));
            return undefined;
        }
        void fetchReaderArticle(numericArticleId)
            .then((article) => {
                if (active) setSelectedArticle(article);
            })
            .catch((error: unknown) => {
                logError('reader-open-evidence', error);
                toast.error(t(
                    'reader_analysis_evidence_error',
                    'The evidence article is no longer available.',
                ));
            });
        return () => { active = false; };
    }, [t]);

    useEffect(() => {
        emitAppEvent('gnosi:module-context', [{
            id: 'route-reader',
            type: 'internal',
            ref: 'reader',
            label: t('reader_title'),
            scope: { unread_only: false, read_status: 'all', source_ids: [] },
        }]);
    }, [t]);

    useEffect(() => () => {
        if (pollingRef.current) clearInterval(pollingRef.current);
    }, []);

    const handleMarkRead = async (articleId: number): Promise<void> => {
        const sourceId = articles.find((article) => article.id === articleId)?.source_id
            ?? (selectedArticle?.id === articleId ? selectedArticle.source_id : null);
        try {
            await markArticleRead.mutateAsync({ articleId, sourceId });
            if (selectedArticle?.id === articleId) {
                setSelectedArticle(showUnreadOnly ? null : { ...selectedArticle, is_read: true });
            }
        } catch (error: unknown) {
            logError('reader-mark-read', error);
        }
    };

    const stopPodcastGeneration = (): void => {
        if (pollingRef.current) clearInterval(pollingRef.current);
        pollingRef.current = null;
        setGeneratingPodcast(false);
        setPodcastProgress('');
    };

    const pollPodcastStatus = async (): Promise<void> => {
        try {
            const status = await fetchReaderPodcastStatus();
            setPodcastProgress(status.progress || '');
            if (status.running) return;
            stopPodcastGeneration();
            if (status.error) toast.error(`${t('reader_podcast_error_prefix', 'Error')}: ${status.error}`);
            else if (status.result_filename) {
                setGeneratedPodcastUrl(readerPodcastUrl(Date.now()));
                await podcastInfoQuery.refetch();
            }
        } catch (error: unknown) {
            logError('reader-podcast-status', error);
        }
    };

    const handleGeneratePodcast = async (): Promise<void> => {
        setGeneratingPodcast(true);
        setPodcastProgress(t('reader_podcast_starting'));
        try {
            const generation = await generateReaderPodcast();
            if (generation.status === 'already_running') {
                setPodcastProgress(generation.progress || t('reader_podcast_in_progress'));
            }
            pollingRef.current = setInterval(() => { void pollPodcastStatus(); }, 5_000);
        } catch (error: unknown) {
            toast.error(t('reader_podcast_error'));
            logError('reader-podcast-generate', error);
            stopPodcastGeneration();
        }
    };

    const handleSyncAll = async (): Promise<void> => {
        setSyncing(true);
        try {
            await Promise.all([
                runScheduledTask('fetch_feeds'),
                runScheduledTask('fetch_newsletters'),
            ]);
            await Promise.all([
                articlesQuery.refetch(),
                inventoryQuery.refetch(),
                sourcesQuery.refetch(),
            ]);
        } catch (error: unknown) {
            logError('reader-sync', error);
        } finally {
            setSyncing(false);
        }
    };

    const countsBySource = useMemo(
        () => inventory ? readerCountsBySource(inventory) : new Map<number, number>(),
        [inventory],
    );
    const sourceGroups = useMemo(
        () => groupReaderSources(sources, countsBySource, locale),
        [countsBySource, locale, sources],
    );
    const articleGroups = useMemo(() => groupReaderArticles(articles, {
        today: t('reader_today'),
        yesterday: t('reader_yesterday'),
        week: t('reader_this_week'),
        month: t('reader_this_month'),
        older: t('reader_older'),
    }), [articles, t]);
    const selectedSource = useMemo(
        () => sources.find((source) => source.id === selectedSourceId) ?? null,
        [selectedSourceId, sources],
    );
    const handleSelectSource = (sourceId: number | null): void => {
        setSelectedSourceId(sourceId);
        setSelectedArticle(null);
        setMobileChannelsOpen(false);
    };
    const handleToggleCategory = (category: string): void => {
        setCollapsedCategories((previous) => {
            const next = new Set(previous);
            if (next.has(category)) next.delete(category);
            else next.add(category);
            return next;
        });
    };

    return <div className="relative flex h-full min-h-0 w-full flex-col overflow-hidden bg-[var(--bg-primary)] font-sans text-[var(--text-primary)]">
        <AppHeader icon={BookOpen} title={t('reader_title')}>
            <button onClick={() => { setMobileChannelsOpen(true); }} title={t('reader_open_channels')} aria-label={t('reader_open_channels')} className="md:hidden p-1.5 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors" type="button"><Menu size={16} /></button>
            <button onClick={() => { void handleSyncAll(); }} disabled={syncing} title={t('reader_sync')} aria-label={t('reader_sync')} className="p-1.5 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors disabled:opacity-50" type="button"><RotateCw size={16} className={syncing ? 'animate-spin' : ''} /></button>
        </AppHeader>
        <div className="flex flex-1 overflow-hidden relative">
            {mobileChannelsOpen ? <button onClick={() => { setMobileChannelsOpen(false); }} className="md:hidden fixed inset-0 bg-black/40 z-40 animate-fade-in-up" aria-label={t('reader_close_channels')} type="button" /> : null}
            <ReaderChannels
                collapsedCategories={collapsedCategories}
                countsBySource={countsBySource}
                generatingPodcast={generatingPodcast}
                groups={sourceGroups}
                mobileOpen={mobileChannelsOpen}
                onClose={() => { setMobileChannelsOpen(false); }}
                onGeneratePodcast={() => { void handleGeneratePodcast(); }}
                onSelectSource={handleSelectSource}
                onToggleCategory={handleToggleCategory}
                podcastEnabled={podcastEnabled}
                podcastInfo={podcastInfo}
                podcastProgress={podcastProgress}
                podcastUrl={podcastUrl}
                selectedSourceId={selectedSourceId}
                sourceCount={sources.length}
                unreadCount={inventory?.count ?? 0}
            />
            <ReaderArticleList
                articlesLoading={articlesQuery.isPending}
                groups={articleGroups}
                locale={locale}
                onSelectArticle={setSelectedArticle}
                onToggleUnreadOnly={() => { setShowUnreadOnly((current) => !current); }}
                selectedArticle={selectedArticle}
                selectedSource={selectedSource}
                showUnreadOnly={showUnreadOnly}
                totalArticles={articles.length}
            />
            <div className={`flex-1 bg-[var(--bg-primary)] h-full overflow-y-auto ${selectedArticle ? 'block' : 'hidden md:block'}`}>
                {selectedArticle ? <ReaderArticleContent
                    article={selectedArticle}
                    locale={locale}
                    onBack={() => { setSelectedArticle(null); }}
                    onMarkRead={(articleId) => { void handleMarkRead(articleId); }}
                /> : <div className="h-full flex items-center justify-center"><p className="text-sm text-[var(--text-tertiary)]">{t('reader_select_article')}</p></div>}
            </div>
        </div>
    </div>;
}
