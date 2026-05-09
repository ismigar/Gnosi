import React, { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import axios from 'axios';
import { toast } from '../lib/toast';
import { Play, RotateCw, Check, Headphones, ArrowLeft, Loader, BookOpen, ExternalLink, ChevronDown, ChevronRight, Inbox, Settings2, Menu, X, History } from 'lucide-react';
import { FeedManagerModal } from '../components/FeedManagerModal';
import { AppHeader } from '../components/AppHeader';

const API_BASE = '/api';
const LOCALE_MAP = { ca: 'ca-ES', es: 'es-ES', en: 'en-US', fr: 'fr-FR' };

const ReaderDashboard = () => {
    const { t, i18n } = useTranslation();
    const locale = LOCALE_MAP[i18n.language?.split('-')[0]] || 'ca-ES';

    const [displayArticles, setDisplayArticles] = useState([]);
    const [unreadArticles, setUnreadArticles] = useState([]);
    const [selectedArticle, setSelectedArticle] = useState(null);
    const [loading, setLoading] = useState(true);
    const [generatingPodcast, setGeneratingPodcast] = useState(false);
    const [podcastUrl, setPodcastUrl] = useState(null);
    const [podcastInfo, setPodcastInfo] = useState(null);
    const [sources, setSources] = useState([]);
    const [selectedSourceId, setSelectedSourceId] = useState(null);
    const [showUnreadOnly, setShowUnreadOnly] = useState(true);
    const [feedManagerOpen, setFeedManagerOpen] = useState(false);
    const [collapsedCategories, setCollapsedCategories] = useState(() => new Set());
    const [mobileChannelsOpen, setMobileChannelsOpen] = useState(false);
    const [podcastProgress, setPodcastProgress] = useState('');

    const pollingRef = React.useRef(null);

    useEffect(() => {
        fetchSources();
        fetchUnreadCounts();
        checkPodcast();
    }, []);

    useEffect(() => {
        fetchDisplayArticles();
    }, [selectedSourceId, showUnreadOnly]);

    const fetchSources = async () => {
        try {
            const res = await axios.get(`${API_BASE}/reader/sources`);
            setSources(res.data || []);
        } catch (error) {
            console.error("Error fetching sources:", error);
        }
    };

    const fetchDisplayArticles = async () => {
        setLoading(true);
        try {
            let url = `${API_BASE}/reader/articles?unread_only=${showUnreadOnly}`;
            if (selectedSourceId) url += `&source_id=${selectedSourceId}`;
            const res = await axios.get(url);
            setDisplayArticles(res.data);
        } catch (error) {
            console.error("Error fetching articles:", error);
        } finally {
            setLoading(false);
        }
    };

    const fetchUnreadCounts = async () => {
        try {
            const res = await axios.get(`${API_BASE}/reader/articles?unread_only=true`);
            setUnreadArticles(res.data || []);
        } catch (error) {
            console.error("Error fetching unread counts:", error);
        }
    };

    const checkPodcast = async () => {
        try {
            const res = await axios.get(`${API_BASE}/reader/podcast/info`);
            if (res.data.exists) {
                setPodcastUrl(`${API_BASE}/reader/podcast/latest`);
                setPodcastInfo(res.data);
            } else {
                setPodcastUrl(null);
                setPodcastInfo(null);
            }
        } catch (error) {
            console.debug('podcast info fetch failed:', error?.message);
        }
    };

    const markAsRead = async (id, e) => {
        if (e) e.stopPropagation();
        try {
            await axios.patch(`${API_BASE}/reader/articles/${id}/read?read=true`);
            setDisplayArticles((prev) => (
                showUnreadOnly
                    ? prev.filter((a) => a.id !== id)
                    : prev.map((a) => (a.id === id ? { ...a, read: true } : a))
            ));
            setUnreadArticles((prev) => prev.filter((a) => a.id !== id));
            if (selectedArticle?.id === id) {
                setSelectedArticle(showUnreadOnly ? null : { ...selectedArticle, read: true });
            }
        } catch (error) {
            console.error("Error marking as read", error);
        }
    };

    const generatePodcast = async () => {
        setGeneratingPodcast(true);
        setPodcastProgress(t('reader_podcast_starting'));
        try {
            const res = await axios.post(`${API_BASE}/reader/podcast/generate`);
            if (res.data.status === 'already_running') {
                setPodcastProgress(res.data.progress || t('reader_podcast_in_progress'));
            }
            pollingRef.current = setInterval(async () => {
                try {
                    const statusRes = await axios.get(`${API_BASE}/reader/podcast/status`);
                    const { running, progress, error, result_filename } = statusRes.data;
                    setPodcastProgress(progress || '');
                    if (!running) {
                        clearInterval(pollingRef.current);
                        pollingRef.current = null;
                        if (error) {
                            toast.error(`Error: ${error}`);
                        } else if (result_filename) {
                            setPodcastUrl(`${API_BASE}/reader/podcast/latest?t=${Date.now()}`);
                            checkPodcast();
                        }
                        setGeneratingPodcast(false);
                        setPodcastProgress('');
                    }
                } catch (err) {
                    console.error("Error polling status:", err);
                }
            }, 5000);
        } catch (error) {
            toast.error(t('reader_podcast_error'));
            console.error(error);
            setGeneratingPodcast(false);
            setPodcastProgress('');
        }
    };

    useEffect(() => {
        return () => {
            if (pollingRef.current) clearInterval(pollingRef.current);
        };
    }, []);

    const handleSyncAll = async () => {
        setLoading(true);
        try {
            await Promise.all([
                axios.post(`${API_BASE}/schedulers/fetch_feeds/run`),
                axios.post(`${API_BASE}/schedulers/fetch_newsletters/run`)
            ]);
            await Promise.all([fetchDisplayArticles(), fetchUnreadCounts()]);
        } catch (error) {
            console.error("Error durant la sincronització:", error);
        } finally {
            setLoading(false);
        }
    };

    const toggleCategory = (cat) => {
        setCollapsedCategories((prev) => {
            const next = new Set(prev);
            if (next.has(cat)) next.delete(cat);
            else next.add(cat);
            return next;
        });
    };

    const handleSelectSource = (sourceId) => {
        setSelectedSourceId(sourceId);
        setSelectedArticle(null);
        setMobileChannelsOpen(false);
    };

    const formatArticleMeta = (article) => {
        const date = new Date(article.published_at).toLocaleDateString(locale, { day: 'numeric', month: 'short' });
        return article.source_name ? `${article.source_name} · ${date}` : date;
    };

    const formatPending = (count) =>
        count === 1
            ? t('reader_articles_pending_one')
            : t('reader_articles_pending_other', { count });

    const formatSourcesCount = (count) =>
        count === 1
            ? t('reader_sources_count_one')
            : t('reader_sources_count_other', { count });

    const displayCategory = (cat) =>
        cat === 'Uncategorized' || cat === 'Sense categoria' ? t('reader_uncategorized') : cat;

    const articleCountsBySource = useMemo(() => {
        const counts = new Map();
        for (const a of unreadArticles) {
            if (!a.source_name) continue;
            counts.set(a.source_name, (counts.get(a.source_name) || 0) + 1);
        }
        return counts;
    }, [unreadArticles]);

    const sourcesByCategory = useMemo(() => {
        const grouped = new Map();
        for (const s of sources) {
            const cat = (s.category && s.category.trim()) || 'Uncategorized';
            if (!grouped.has(cat)) grouped.set(cat, []);
            grouped.get(cat).push(s);
        }
        const isUncat = (c) => c === 'Uncategorized' || c === 'Sense categoria';
        const entries = Array.from(grouped.entries()).map(([cat, items]) => ({
            category: cat,
            items: items.slice().sort((a, b) => a.name.localeCompare(b.name, locale)),
            unread: items.reduce((acc, s) => acc + (articleCountsBySource.get(s.name) || 0), 0)
        }));
        entries.sort((a, b) => {
            if (isUncat(a.category)) return 1;
            if (isUncat(b.category)) return -1;
            return a.category.localeCompare(b.category, locale);
        });
        return entries;
    }, [sources, articleCountsBySource, locale]);

    const selectedSource = useMemo(
        () => sources.find((s) => s.id === selectedSourceId) || null,
        [sources, selectedSourceId]
    );

    const groupedArticles = useMemo(() => {
        if (!displayArticles.length) return [];
        const now = new Date();
        const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
        const startOfYesterday = startOfDay - 86400000;
        const startOfWeek = startOfDay - 6 * 86400000;
        const startOfMonth = startOfDay - 29 * 86400000;

        const buckets = { today: [], yesterday: [], week: [], month: [], older: [] };
        for (const a of displayArticles) {
            const t = new Date(a.published_at).getTime();
            if (t >= startOfDay) buckets.today.push(a);
            else if (t >= startOfYesterday) buckets.yesterday.push(a);
            else if (t >= startOfWeek) buckets.week.push(a);
            else if (t >= startOfMonth) buckets.month.push(a);
            else buckets.older.push(a);
        }
        const labels = {
            today: t('reader_today'),
            yesterday: t('reader_yesterday'),
            week: t('reader_this_week'),
            month: t('reader_this_month'),
            older: t('reader_older')
        };
        return Object.entries(buckets)
            .filter(([, items]) => items.length > 0)
            .map(([key, items]) => ({ key, label: labels[key], items }));
    }, [displayArticles, t, i18n.resolvedLanguage]);

    return (
        <div className="flex flex-col h-screen w-full bg-[var(--bg-primary)] text-[var(--text-primary)] font-sans overflow-hidden">
            <AppHeader icon={BookOpen} title={t('reader_title')}>
                <button
                    onClick={() => setMobileChannelsOpen(true)}
                    title={t('reader_open_channels')}
                    className="md:hidden p-1.5 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
                >
                    <Menu size={16} />
                </button>
                <button
                    onClick={handleSyncAll}
                    disabled={loading}
                    title={t('reader_sync')}
                    className="p-1.5 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors disabled:opacity-50"
                >
                    <RotateCw size={16} className={loading ? "animate-spin" : ""} />
                </button>
            </AppHeader>

            <div className="flex flex-1 overflow-hidden relative">
                {/* Mobile overlay */}
                {mobileChannelsOpen && (
                    <div
                        onClick={() => setMobileChannelsOpen(false)}
                        className="md:hidden fixed inset-0 bg-black/40 z-40 animate-fade-in-up"
                        aria-hidden="true"
                    />
                )}

                {/* Columna 1: Canals */}
                <aside
                    className={`bg-[var(--bg-secondary)]/50 border-r border-[var(--border-primary)] flex-col flex-shrink-0 md:flex md:relative md:w-60 lg:w-64 ${mobileChannelsOpen ? 'flex fixed inset-y-0 left-0 w-72 z-50 shadow-2xl' : 'hidden'}`}
                >
                    <div className="px-5 py-5 flex items-center justify-between gap-2">
                        <div className="min-w-0">
                            <h2 className="text-base font-semibold text-[var(--text-primary)]">{t('reader_channels')}</h2>
                            <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
                                {sources.length === 0 ? t('reader_no_sources') : formatSourcesCount(sources.length)}
                            </p>
                        </div>
                        <button
                            onClick={() => setMobileChannelsOpen(false)}
                            title={t('reader_close_channels')}
                            className="md:hidden p-1.5 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors flex-shrink-0"
                        >
                            <X size={16} />
                        </button>
                    </div>

                    <nav className="overflow-y-auto flex-1 pb-2">
                        <button
                            onClick={() => handleSelectSource(null)}
                            className={`relative w-full flex items-center justify-between px-5 py-2 text-sm transition-colors ${selectedSourceId === null ? 'text-[var(--text-primary)] font-semibold' : 'text-slate-600 dark:text-slate-300 hover:text-[var(--text-primary)]'}`}
                        >
                            {selectedSourceId === null && (
                                <span className="absolute left-0 top-0 bottom-0 w-[2px] bg-[var(--gnosi-blue)]" aria-hidden="true" />
                            )}
                            <span className="flex items-center gap-2 min-w-0">
                                <Inbox size={14} className="flex-shrink-0 text-slate-400" />
                                <span className="truncate">{t('reader_all')}</span>
                            </span>
                            <span className="text-[11px] text-slate-400 tabular-nums flex-shrink-0">{unreadArticles.length}</span>
                        </button>

                        {sourcesByCategory.map((group) => {
                            const collapsed = collapsedCategories.has(group.category);
                            return (
                                <div key={group.category} className="mt-3">
                                    <button
                                        onClick={() => toggleCategory(group.category)}
                                        className="w-full flex items-center justify-between px-5 py-1.5 group"
                                    >
                                        <span className="flex items-center gap-1.5 min-w-0">
                                            {collapsed
                                                ? <ChevronRight size={11} className="text-slate-400 flex-shrink-0" />
                                                : <ChevronDown size={11} className="text-slate-400 flex-shrink-0" />}
                                            <span className="text-[10px] uppercase tracking-[0.1em] font-semibold text-slate-400 dark:text-slate-500 truncate">
                                                {displayCategory(group.category)}
                                            </span>
                                        </span>
                                        {group.unread > 0 && (
                                            <span className="text-[10px] text-slate-400 tabular-nums">{group.unread}</span>
                                        )}
                                    </button>
                                    {!collapsed && group.items.map((source) => {
                                        const isActive = selectedSourceId === source.id;
                                        const count = articleCountsBySource.get(source.name) || 0;
                                        return (
                                            <button
                                                key={source.id}
                                                onClick={() => handleSelectSource(source.id)}
                                                className={`relative w-full flex items-center justify-between pl-8 pr-5 py-1.5 text-sm transition-colors ${isActive ? 'text-[var(--text-primary)] font-medium' : 'text-slate-600 dark:text-slate-300 hover:text-[var(--text-primary)]'}`}
                                            >
                                                {isActive && (
                                                    <span className="absolute left-0 top-0 bottom-0 w-[2px] bg-[var(--gnosi-blue)]" aria-hidden="true" />
                                                )}
                                                <span className="truncate">{source.name}</span>
                                                {count > 0 && (
                                                    <span className={`text-[11px] tabular-nums flex-shrink-0 ml-2 ${isActive ? 'text-[var(--gnosi-blue)]' : 'text-slate-400'}`}>{count}</span>
                                                )}
                                            </button>
                                        );
                                    })}
                                </div>
                            );
                        })}
                    </nav>

                    <button
                        onClick={() => setFeedManagerOpen(true)}
                        className="flex items-center gap-2 px-5 py-3 text-xs text-slate-500 dark:text-slate-400 hover:text-[var(--text-primary)] hover:bg-[var(--bg-primary)] transition-colors border-t border-[var(--border-primary)]"
                    >
                        <Settings2 size={13} />
                        <span>{t('reader_manage_sources')}</span>
                    </button>

                    <div className="border-t border-[var(--border-primary)] bg-[var(--bg-primary)] px-4 py-3">
                        {generatingPodcast ? (
                            <div className="flex items-center gap-3">
                                <Loader size={16} className="animate-spin text-[var(--gnosi-blue)] flex-shrink-0" />
                                <div className="flex-1 min-w-0">
                                    <div className="text-[11px] text-slate-500 dark:text-slate-400 mb-1">{t('reader_podcast_generating')}</div>
                                    <div className="text-xs text-slate-700 dark:text-slate-200 truncate">{podcastProgress || t('reader_podcast_synthesizing')}</div>
                                </div>
                            </div>
                        ) : podcastUrl ? (
                            <div>
                                <div className="flex items-center justify-between mb-2">
                                    <div className="flex items-center gap-2 min-w-0">
                                        <Headphones size={14} className="text-slate-400 dark:text-slate-500 flex-shrink-0" />
                                        <span className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                                            {t('reader_podcast_daily')}{podcastInfo?.formatted_date ? ` · ${podcastInfo.formatted_date}` : ''}
                                        </span>
                                    </div>
                                    <button
                                        onClick={generatePodcast}
                                        title={t('reader_podcast_regenerate')}
                                        className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors p-1 -mr-1"
                                    >
                                        <RotateCw size={12} />
                                    </button>
                                </div>
                                <audio controls preload="none" className="w-full h-8" src={podcastUrl}>
                                    {t('reader_podcast_unsupported')}
                                </audio>
                            </div>
                        ) : (
                            <button
                                onClick={generatePodcast}
                                className="w-full flex items-center justify-center gap-2 py-2 rounded-md text-xs text-slate-600 dark:text-slate-300 hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] transition-colors border border-[var(--border-primary)]"
                            >
                                <Play size={12} fill="currentColor" />
                                <span>{t('reader_podcast_generate')}</span>
                            </button>
                        )}
                    </div>
                </aside>

                {/* Columna 2: Articles */}
                <div className={`w-full md:w-[360px] lg:w-[400px] border-r border-[var(--border-primary)] bg-[var(--bg-primary)] flex flex-col flex-shrink-0 ${selectedArticle ? 'hidden md:flex' : 'flex'}`}>

                    <div className="px-6 py-5">
                        <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                                <h2 className="text-base font-semibold text-[var(--text-primary)] truncate">
                                    {selectedSource ? selectedSource.name : t('reader_all_articles')}
                                </h2>
                                <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
                                    {loading && displayArticles.length === 0
                                        ? t('reader_loading')
                                        : showUnreadOnly
                                            ? formatPending(displayArticles.length)
                                            : t(
                                                displayArticles.length === 1 ? 'reader_articles_count_one' : 'reader_articles_count_other',
                                                {
                                                    count: displayArticles.length,
                                                    defaultValue: displayArticles.length === 1
                                                        ? '{{count}} article'
                                                        : '{{count}} articles',
                                                }
                                            )}
                                </p>
                            </div>
                            <button
                                onClick={() => setShowUnreadOnly(!showUnreadOnly)}
                                title={showUnreadOnly ? t('reader_show_history') : t('reader_show_pending')}
                                className={`flex-shrink-0 p-1.5 rounded-md text-xs transition-colors ${showUnreadOnly ? 'text-slate-400 dark:text-slate-500 hover:text-[var(--text-primary)] hover:bg-slate-100 dark:hover:bg-slate-800' : 'text-[var(--gnosi-blue)] bg-[var(--gnosi-blue)]/10'}`}
                            >
                                <History size={14} />
                            </button>
                        </div>
                    </div>

                    <div className="overflow-y-auto flex-1">
                        {displayArticles.length === 0 && !loading ? (
                            <div className="px-6 py-12 text-sm text-slate-400 dark:text-slate-500">
                                {selectedSource
                                    ? t('reader_no_articles_source', { source: selectedSource.name })
                                    : t('reader_up_to_date')}
                            </div>
                        ) : (
                            groupedArticles.map((group) => (
                                <section key={group.key}>
                                    <h3 className="px-6 pt-6 pb-2 text-[10px] uppercase tracking-[0.1em] font-semibold text-slate-400 dark:text-slate-500">
                                        {group.label}
                                    </h3>
                                    {group.items.map((article) => {
                                        const isSelected = selectedArticle?.id === article.id;
                                        return (
                                            <div
                                                key={article.id}
                                                onClick={() => setSelectedArticle(article)}
                                                className={`relative px-6 py-4 border-t border-slate-100 dark:border-slate-800/60 cursor-pointer transition-colors ${isSelected ? 'bg-slate-50/40 dark:bg-slate-800/30' : 'hover:bg-slate-50/60 dark:hover:bg-slate-800/30'}`}
                                            >
                                                {isSelected && (
                                                    <span className="absolute left-0 top-0 bottom-0 w-[2px] bg-[var(--gnosi-blue)]" aria-hidden="true" />
                                                )}
                                                <div className="text-[11px] text-slate-500 dark:text-slate-400 mb-1.5 truncate">
                                                    {formatArticleMeta(article)}
                                                </div>
                                                <h4 className={`text-[15px] leading-snug line-clamp-3 ${isSelected ? 'font-semibold text-[var(--text-primary)]' : 'font-medium text-slate-700 dark:text-slate-200'}`}>
                                                    {article.title}
                                                </h4>
                                            </div>
                                        );
                                    })}
                                </section>
                            ))
                        )}
                    </div>
                </div>

                {/* Columna 3: Reader */}
                <div className={`flex-1 bg-[var(--bg-primary)] h-full overflow-y-auto ${!selectedArticle ? 'hidden md:block' : 'block'}`}>
                    {selectedArticle ? (
                        <article className="max-w-[640px] mx-auto py-12 px-6 md:px-10 animate-fade-in-up">
                            <button
                                onClick={() => setSelectedArticle(null)}
                                className="md:hidden mb-8 flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400 hover:text-[var(--text-primary)] transition-colors"
                            >
                                <ArrowLeft size={16} />
                                <span>{t('reader_back')}</span>
                            </button>

                            <div className="text-[11px] uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-3">
                                {formatArticleMeta(selectedArticle)}
                            </div>

                            <h1 className="text-3xl md:text-4xl font-semibold text-[var(--text-primary)] leading-tight tracking-tight mb-6">
                                {selectedArticle.title}
                            </h1>

                            <div className="flex items-center gap-5 mb-10 text-sm">
                                <button
                                    onClick={() => markAsRead(selectedArticle.id)}
                                    className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400 hover:text-[var(--text-primary)] transition-colors"
                                >
                                    <Check size={15} />
                                    <span>{t('reader_mark_read')}</span>
                                </button>
                                <a
                                    href={selectedArticle.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400 hover:text-[var(--text-primary)] transition-colors"
                                >
                                    <span>{t('reader_original_source')}</span>
                                    <ExternalLink size={13} />
                                </a>
                            </div>

                            {selectedArticle.content && selectedArticle.content.includes('<') ? (
                                // XSS prevention: el contingut RSS ve de fonts externes
                                // (atacant-controlables). En lloc d'injectar amb
                                // dangerouslySetInnerHTML al document principal —que
                                // executaria scripts incrustats— el renderitzem dins
                                // un iframe sandbox sense `allow-scripts`.
                                <iframe
                                    srcDoc={`<!DOCTYPE html><html><head><meta charset="utf-8"><base target="_blank"><style>body{font-family:Inter,system-ui,sans-serif;color:#1e293b;line-height:1.7;padding:0;margin:0;}img{max-width:100%;height:auto;border-radius:8px}a{color:#4f46e5}</style></head><body>${selectedArticle.content}</body></html>`}
                                    sandbox="allow-same-origin allow-popups"
                                    title="article-content"
                                    style={{ width: '100%', minHeight: '600px', border: 'none' }}
                                />
                            ) : (
                                <div className="prose prose-slate dark:prose-invert max-w-none
                                    prose-headings:font-semibold prose-headings:tracking-tight
                                    prose-p:leading-7
                                    prose-a:text-[var(--gnosi-blue)] prose-a:font-medium prose-a:no-underline hover:prose-a:underline
                                    prose-strong:font-semibold
                                    prose-img:rounded-md prose-img:max-w-full"
                                >
                                    {selectedArticle.content?.split('\n').map((paragraph, idx) => (
                                        <p key={idx}>{paragraph}</p>
                                    ))}
                                </div>
                            )}
                        </article>
                    ) : (
                        <div className="h-full flex items-center justify-center">
                            <p className="text-sm text-slate-400 dark:text-slate-500">{t('reader_select_article')}</p>
                        </div>
                    )}
                </div>
            </div>

            <FeedManagerModal
                isOpen={feedManagerOpen}
                onClose={() => setFeedManagerOpen(false)}
                onRefresh={() => { fetchSources(); fetchDisplayArticles(); fetchUnreadCounts(); }}
            />
        </div>
    );
};

export default ReaderDashboard;
