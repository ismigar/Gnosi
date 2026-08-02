import React, { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import axios from 'axios';
import { toast } from '../lib/toast';
import { Play, RotateCw, Check, Headphones, ArrowLeft, Loader, BookOpen, ExternalLink, ChevronDown, ChevronRight, Inbox, Menu, X, History, Sparkles, Square } from 'lucide-react';
import { AppHeader } from '../components/AppHeader';
import { getIntlLocale } from '../locales/registry';

const API_BASE = '/api';
// Google's favicon service: covers all public domains, returns a 32px PNG
// with sane fallbacks. Trade-off: each source URL leaks once to Google when
// the column renders. Acceptable here because the user already pulls these
// feeds publicly. If we want zero-leak, swap for `${origin}/favicon.ico`.
const getFaviconUrl = (sourceUrl) => {
    try {
        const hostname = new URL(sourceUrl).hostname;
        return `https://www.google.com/s2/favicons?sz=32&domain=${hostname}`;
    } catch {
        return null;
    }
};

// Typography for the iframe-rendered article body. Kept here so the CSS is
// applied consistently regardless of the host page's stylesheet (the iframe
// is a clean document). `prefers-color-scheme` covers dark mode without
// needing JS to push a class in.
const ARTICLE_IFRAME_CSS = `
    :root { color-scheme: light dark; }
    * { box-sizing: border-box; }
    body {
        font-family: Inter, -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
        font-size: 16px;
        line-height: 1.7;
        color: #1e293b;
        margin: 0;
        padding: 0;
        word-wrap: break-word;
        overflow-wrap: break-word;
    }
    @media (prefers-color-scheme: dark) {
        body { color: #e2e8f0; }
        blockquote { color: #94a3b8; border-color: #475569; }
        code, pre { background: rgba(255,255,255,0.07); }
        th { background: rgba(255,255,255,0.04); }
        th, td, hr { border-color: #334155; }
        a { color: #93c5fd; }
        a:hover { border-bottom-color: #93c5fd; }
    }
    h1, h2, h3, h4, h5, h6 {
        font-weight: 600;
        line-height: 1.3;
        margin: 1.6em 0 0.5em;
        letter-spacing: -0.01em;
    }
    h1 { font-size: 1.5em; }
    h2 { font-size: 1.3em; }
    h3 { font-size: 1.15em; }
    h4 { font-size: 1.05em; }
    p { margin: 0 0 1em; }
    ul, ol { padding-left: 1.5em; margin: 0 0 1em; }
    li { margin: 0.25em 0; }
    li > p:last-child { margin-bottom: 0; }
    blockquote {
        border-left: 3px solid #cbd5e1;
        padding-left: 1em;
        margin: 1em 0;
        color: #64748b;
        font-style: italic;
    }
    code {
        background: rgba(0,0,0,0.06);
        padding: 0.15em 0.35em;
        border-radius: 3px;
        font-size: 0.9em;
        font-family: ui-monospace, SF Mono, Menlo, monospace;
    }
    pre {
        background: rgba(0,0,0,0.06);
        padding: 1em;
        border-radius: 6px;
        overflow-x: auto;
        margin: 1em 0;
    }
    pre code { background: none; padding: 0; font-size: 0.9em; }
    img, video {
        max-width: 100%;
        height: auto;
        border-radius: 8px;
        margin: 1em 0;
        display: block;
    }
    a {
        color: #4f46e5;
        text-decoration: none;
        border-bottom: 1px solid rgba(79,70,229,0.3);
    }
    a:hover { border-bottom-color: currentColor; }
    table {
        width: 100%;
        border-collapse: collapse;
        margin: 1em 0;
        font-size: 0.95em;
    }
    th, td { border: 1px solid #cbd5e1; padding: 0.5em 0.75em; text-align: left; vertical-align: top; }
    th { background: rgba(0,0,0,0.04); font-weight: 600; }
    hr { border: none; border-top: 1px solid #cbd5e1; margin: 2em 0; }
    figure { margin: 1em 0; }
    figcaption { font-size: 0.85em; color: #64748b; margin-top: 0.5em; text-align: center; }
    iframe { max-width: 100%; }
`;

// Resize the article iframe to fit its content. Without this, Electron-style
// renderers cap iframes at the height attribute and the article is cut off.
const fitIframeToContent = (event) => {
    const iframe = event.currentTarget;
    try {
        const doc = iframe.contentDocument || iframe.contentWindow?.document;
        if (!doc) return;
        const measure = () => {
            const h = Math.max(doc.body.scrollHeight, doc.documentElement.scrollHeight);
            iframe.style.height = `${h + 16}px`;
        };
        measure();
        // Images and webfonts settle async; remeasure once they're loaded.
        const imgs = Array.from(doc.images || []);
        if (imgs.length === 0) return;
        let pending = imgs.filter((img) => !img.complete).length;
        if (pending === 0) return;
        imgs.forEach((img) => {
            if (img.complete) return;
            img.addEventListener('load', () => { if (--pending <= 0) measure(); }, { once: true });
            img.addEventListener('error', () => { if (--pending <= 0) measure(); }, { once: true });
        });
    } catch {
        // Cross-origin or sandbox quirks: leave the default height.
    }
};

const ReaderDashboard = () => {
    const { t, i18n } = useTranslation();
    const locale = getIntlLocale(i18n.resolvedLanguage || i18n.language);

    const [displayArticles, setDisplayArticles] = useState([]);
    const [unreadInventory, setUnreadInventory] = useState({ count: 0, feeds: [] });
    const [selectedArticle, setSelectedArticle] = useState(null);
    const [articlesLoading, setArticlesLoading] = useState(true);
    const [syncing, setSyncing] = useState(false);
    const [generatingPodcast, setGeneratingPodcast] = useState(false);
    const [podcastUrl, setPodcastUrl] = useState(null);
    const [podcastInfo, setPodcastInfo] = useState(null);
    const [sources, setSources] = useState([]);
    const [selectedSourceId, setSelectedSourceId] = useState(null);
    const [showUnreadOnly, setShowUnreadOnly] = useState(true);
    const [collapsedCategories, setCollapsedCategories] = useState(() => new Set());
    const [mobileChannelsOpen, setMobileChannelsOpen] = useState(false);
    const [podcastProgress, setPodcastProgress] = useState('');
    const [showAnalysis, setShowAnalysis] = useState(false);
    const [analysisScopeInventory, setAnalysisScopeInventory] = useState({ count: 0 });
    const [analysisJob, setAnalysisJob] = useState(null);
    const [analysisResult, setAnalysisResult] = useState(null);
    const [analysisStarting, setAnalysisStarting] = useState(false);

    const pollingRef = React.useRef(null);
    const analysisPollingRef = React.useRef(null);

    useEffect(() => {
        fetchSources();
        fetchUnreadCounts();
        checkPodcast();
        loadLatestAnalysis();
        const articleId = new URLSearchParams(window.location.search).get('article');
        if (articleId) openEvidenceArticle(articleId);
    }, []);

    useEffect(() => {
        fetchDisplayArticles();
        fetchAnalysisScopeInventory();
    }, [selectedSourceId, showUnreadOnly]);

    useEffect(() => {
        const selected = sources.find(source => source.id === selectedSourceId);
        window.dispatchEvent(new CustomEvent('gnosi:module-context', {
            detail: [{
                id: 'route-reader',
                type: 'internal',
                ref: 'reader',
                label: selected?.name || t('reader_title'),
                scope: {
                    unread_only: showUnreadOnly,
                    source_ids: selectedSourceId ? [selectedSourceId] : [],
                },
            }],
        }));
    }, [selectedSourceId, showUnreadOnly, sources, t]);

    const fetchSources = async () => {
        try {
            const res = await axios.get(`${API_BASE}/reader/sources`);
            setSources(res.data || []);
        } catch (error) {
            console.error("Error fetching sources:", error);
        }
    };

    const fetchDisplayArticles = async () => {
        setArticlesLoading(true);
        try {
            let url = `${API_BASE}/reader/articles?unread_only=${showUnreadOnly}`;
            if (selectedSourceId) url += `&source_id=${selectedSourceId}`;
            const res = await axios.get(url);
            setDisplayArticles(res.data);
        } catch (error) {
            console.error("Error fetching articles:", error);
        } finally {
            setArticlesLoading(false);
        }
    };

    const fetchUnreadCounts = async () => {
        try {
            const res = await axios.get(`${API_BASE}/reader/inventory?unread_only=true`);
            setUnreadInventory(res.data || { count: 0, feeds: [] });
        } catch (error) {
            console.error("Error fetching unread counts:", error);
        }
    };

    const fetchAnalysisScopeInventory = async () => {
        try {
            const params = new URLSearchParams({ unread_only: String(showUnreadOnly) });
            if (selectedSourceId) params.append('source_id', String(selectedSourceId));
            const res = await axios.get(`${API_BASE}/reader/inventory?${params.toString()}`);
            setAnalysisScopeInventory(res.data || { count: 0 });
        } catch (error) {
            console.error('Error fetching Reader analysis scope:', error);
        }
    };

    const loadAnalysisResult = async (jobId) => {
        const response = await axios.get(`${API_BASE}/reader/analysis/${jobId}/result`);
        setAnalysisResult(response.data);
    };

    const trackAnalysis = (jobId) => {
        if (analysisPollingRef.current) clearInterval(analysisPollingRef.current);
        analysisPollingRef.current = setInterval(async () => {
            try {
                const response = await axios.get(`${API_BASE}/reader/analysis/${jobId}`);
                const job = response.data;
                setAnalysisJob(job);
                if (['completed', 'failed', 'cancelled', 'interrupted'].includes(job.state)) {
                    clearInterval(analysisPollingRef.current);
                    analysisPollingRef.current = null;
                    if (job.state === 'completed') await loadAnalysisResult(jobId);
                }
            } catch (error) {
                console.error('Could not poll Reader analysis', error);
            }
        }, 2000);
    };

    const loadLatestAnalysis = async () => {
        try {
            const response = await axios.get(`${API_BASE}/reader/analysis?limit=1`);
            const latest = response.data?.[0];
            if (!latest) return;
            setAnalysisJob(latest);
            if (latest.state === 'completed') await loadAnalysisResult(latest.job_id);
            if (['queued', 'snapshotting', 'mapping', 'reducing'].includes(latest.state)) {
                trackAnalysis(latest.job_id);
            }
        } catch (error) {
            console.debug('No previous Reader analysis could be loaded', error?.message);
        }
    };

    const startTopicAnalysis = async () => {
        setAnalysisStarting(true);
        setAnalysisResult(null);
        try {
            const language = {
                ca: 'Catalan', en: 'English', es: 'Spanish', fr: 'French',
            }[(i18n.resolvedLanguage || i18n.language || 'ca').split('-')[0]] || 'Catalan';
            const response = await axios.post(`${API_BASE}/reader/analysis`, {
                unread_only: showUnreadOnly,
                source_ids: selectedSourceId ? [selectedSourceId] : [],
                language,
            });
            setAnalysisJob(response.data);
            trackAnalysis(response.data.job_id);
        } catch (error) {
            console.error('Could not start Reader analysis', error);
            toast.error(t('reader_analysis_start_error', 'The analysis could not be started.'));
        } finally {
            setAnalysisStarting(false);
        }
    };

    const resumeTopicAnalysis = async () => {
        if (!analysisJob?.job_id) return;
        try {
            const response = await axios.post(`${API_BASE}/reader/analysis/${analysisJob.job_id}/resume`);
            setAnalysisJob(response.data);
            trackAnalysis(analysisJob.job_id);
        } catch (error) {
            console.error('Could not resume Reader analysis', error);
            toast.error(t('reader_analysis_resume_error', 'The analysis could not be resumed.'));
        }
    };

    const cancelTopicAnalysis = async () => {
        if (!analysisJob?.job_id) return;
        try {
            const response = await axios.post(`${API_BASE}/reader/analysis/${analysisJob.job_id}/cancel`);
            setAnalysisJob(response.data);
        } catch (error) {
            console.error('Could not cancel Reader analysis', error);
        }
    };

    const openEvidenceArticle = async (articleId) => {
        try {
            const response = await axios.get(`${API_BASE}/reader/articles/${articleId}`);
            setSelectedArticle(response.data);
            setShowAnalysis(false);
        } catch (error) {
            console.error('Could not open Reader evidence article', error);
            toast.error(t('reader_analysis_evidence_error', 'The evidence article is no longer available.'));
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
        const sourceId = displayArticles.find(article => article.id === id)?.source_id
            || (selectedArticle?.id === id ? selectedArticle.source_id : null);
        try {
            await axios.patch(`${API_BASE}/reader/articles/${id}/read?read=true`);
            setDisplayArticles((prev) => (
                showUnreadOnly
                    ? prev.filter((a) => a.id !== id)
                    : prev.map((a) => (a.id === id ? { ...a, is_read: true } : a))
            ));
            setUnreadInventory(prev => ({
                ...prev,
                count: Math.max(0, (prev.count || 0) - 1),
                feeds: (prev.feeds || []).map(feed => (
                    feed.id === sourceId
                        ? { ...feed, count: Math.max(0, (feed.count || 0) - 1) }
                        : feed
                )),
            }));
            if (selectedArticle?.id === id) {
                setSelectedArticle(showUnreadOnly ? null : { ...selectedArticle, is_read: true });
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
                            toast.error(`${t('reader_podcast_error_prefix', 'Error')}: ${error}`);
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
            if (analysisPollingRef.current) clearInterval(analysisPollingRef.current);
        };
    }, []);

    const handleSyncAll = async () => {
        setSyncing(true);
        try {
            await Promise.all([
                axios.post(`${API_BASE}/schedulers/fetch_feeds/run`),
                axios.post(`${API_BASE}/schedulers/fetch_newsletters/run`)
            ]);
            await Promise.all([fetchDisplayArticles(), fetchUnreadCounts()]);
        } catch (error) {
            console.error("Error during synchronization:", error);
        } finally {
            setSyncing(false);
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
        // Some RSS articles don't carry a date (`published_at` null; the backend
        // sorts them with `nullslast()`). Without this guard, `new Date(null)` produced
        // the epoch ("Jan 1") as the article's date.
        const d = article.published_at ? new Date(article.published_at) : null;
        const date = d && !isNaN(d.getTime())
            ? d.toLocaleDateString(locale, { day: 'numeric', month: 'short' })
            : '';
        return [article.source_name, date].filter(Boolean).join(' · ');
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
        for (const feed of unreadInventory.feeds || []) {
            if (!feed.id) continue;
            counts.set(feed.id, feed.count || 0);
        }
        return counts;
    }, [unreadInventory]);

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
            unread: items.reduce((acc, s) => acc + (articleCountsBySource.get(s.id) || 0), 0)
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
        <div className="relative flex h-full min-h-0 w-full flex-col overflow-hidden bg-[var(--bg-primary)] font-sans text-[var(--text-primary)]">
            <AppHeader icon={BookOpen} title={t('reader_title')}>
                <button
                    onClick={() => setMobileChannelsOpen(true)}
                    title={t('reader_open_channels')}
                    aria-label={t('reader_open_channels')}
                    className="md:hidden p-1.5 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
                >
                    <Menu size={16} />
                </button>
                <button
                    onClick={() => setShowAnalysis(true)}
                    title={t('reader_analysis_open', 'Topic evolution')}
                    aria-label={t('reader_analysis_open', 'Topic evolution')}
                    className="p-1.5 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-[var(--text-primary)] transition-colors"
                >
                    <Sparkles size={16} />
                </button>
                <button
                    onClick={handleSyncAll}
                    disabled={syncing}
                    title={t('reader_sync')}
                    aria-label={t('reader_sync')}
                    className="p-1.5 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors disabled:opacity-50"
                >
                    <RotateCw size={16} className={syncing ? "animate-spin" : ""} />
                </button>
            </AppHeader>

            {showAnalysis && (
                <div className="fixed inset-0 z-[80] flex justify-end bg-black/35" onClick={() => setShowAnalysis(false)}>
                    <section
                        className="h-full w-full max-w-2xl overflow-y-auto border-l border-[var(--border-primary)] bg-[var(--bg-primary)] shadow-2xl"
                        onClick={event => event.stopPropagation()}
                        aria-label={t('reader_analysis_title', 'Topic evolution analysis')}
                    >
                        <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-[var(--border-primary)] bg-[var(--bg-primary)] px-6 py-5">
                            <div>
                                <h2 className="text-lg font-semibold">{t('reader_analysis_title', 'Topic evolution analysis')}</h2>
                                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                                    {selectedSource
                                        ? t('reader_analysis_scope_source', '{{source}} · {{count}} articles', { source: selectedSource.name, count: analysisScopeInventory.count || 0 })
                                        : t('reader_analysis_scope_all', 'All feeds · {{count}} articles', { count: analysisScopeInventory.count || 0 })}
                                </p>
                            </div>
                            <button onClick={() => setShowAnalysis(false)} aria-label={t('common.close', 'Close')} className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200">
                                <X size={18} />
                            </button>
                        </header>

                        <div className="space-y-5 px-6 py-6">
                            {!analysisJob && (
                                <div className="rounded-xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-5">
                                    <p className="text-sm leading-6 text-slate-600 dark:text-slate-300">
                                        {t('reader_analysis_desc', 'Gnosi creates an immutable snapshot, processes every selected article in checkpoints, and produces a cited evolution for each topic. You can leave this page and resume after a restart.')}
                                    </p>
                                    <button onClick={startTopicAnalysis} disabled={analysisStarting} className="mt-4 inline-flex items-center gap-2 rounded-lg bg-[var(--gnosi-blue)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
                                        {analysisStarting ? <Loader size={15} className="animate-spin" /> : <Sparkles size={15} />}
                                        {t('reader_analysis_start', 'Analyze selected articles')}
                                    </button>
                                </div>
                            )}

                            {analysisJob && (
                                <div className="rounded-xl border border-[var(--border-primary)] p-4">
                                    <div className="flex items-center justify-between gap-3 text-sm">
                                        <span className="font-medium">{t(`reader_analysis_state_${analysisJob.state}`, analysisJob.state)}</span>
                                        <span className="tabular-nums text-slate-500">{analysisJob.progress || 0}%</span>
                                    </div>
                                    <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                                        <div className="h-full rounded-full bg-[var(--gnosi-blue)] transition-all" style={{ width: `${analysisJob.progress || 0}%` }} />
                                    </div>
                                    <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
                                        {t('reader_analysis_progress', '{{processed}} of {{total}} articles processed', { processed: analysisJob.processed_articles || 0, total: analysisJob.total_articles || 0 })}
                                    </p>
                                    {analysisJob.error && <p className="mt-3 text-xs text-red-600 dark:text-red-400">{analysisJob.error}</p>}
                                    <div className="mt-4 flex flex-wrap gap-2">
                                        {['queued', 'snapshotting', 'mapping', 'reducing'].includes(analysisJob.state) && (
                                            <button onClick={cancelTopicAnalysis} className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-primary)] px-3 py-1.5 text-xs">
                                                <Square size={11} /> {t('common.cancel', 'Cancel')}
                                            </button>
                                        )}
                                        {['interrupted', 'failed'].includes(analysisJob.state) && (
                                            <button onClick={resumeTopicAnalysis} className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--gnosi-blue)] px-3 py-1.5 text-xs text-white">
                                                <RotateCw size={12} /> {t('reader_analysis_resume', 'Resume from checkpoints')}
                                            </button>
                                        )}
                                        {['completed', 'cancelled', 'failed'].includes(analysisJob.state) && (
                                            <button onClick={() => { setAnalysisJob(null); setAnalysisResult(null); }} className="rounded-lg border border-[var(--border-primary)] px-3 py-1.5 text-xs">
                                                {t('reader_analysis_new', 'New analysis')}
                                            </button>
                                        )}
                                    </div>
                                </div>
                            )}

                            {analysisResult?.topics?.map(topic => (
                                <article key={topic.topic} className="rounded-xl border border-[var(--border-primary)] p-5">
                                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                                        <h3 className="text-base font-semibold">{topic.topic}</h3>
                                        <span className="text-xs text-slate-500">{t('reader_analysis_topic_count', '{{count}} articles', { count: topic.article_count || 0 })}</span>
                                    </div>
                                    <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-700 dark:text-slate-200">{topic.evolution}</p>
                                    {(topic.article_ids || []).length > 0 && (
                                        <div className="mt-4 flex flex-wrap gap-2">
                                            {(topic.article_ids || []).slice(0, 20).map(articleId => (
                                                <button key={articleId} onClick={() => openEvidenceArticle(articleId)} className="rounded-full border border-[var(--border-primary)] px-2.5 py-1 text-xs text-[var(--gnosi-blue)] hover:bg-[var(--bg-secondary)]">
                                                    {t('reader_analysis_evidence', 'Article #{{id}}', { id: articleId })}
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </article>
                            ))}
                        </div>
                    </section>
                </div>
            )}

            <div className="flex flex-1 overflow-hidden relative">
                {/* Mobile overlay */}
                {mobileChannelsOpen && (
                    <div
                        onClick={() => setMobileChannelsOpen(false)}
                        className="md:hidden fixed inset-0 bg-black/40 z-40 animate-fade-in-up"
                        aria-hidden="true"
                    />
                )}

                {/* Column 1: Channels */}
                <aside
                    className={`bg-[var(--bg-secondary)]/50 border-r border-[var(--border-primary)] flex-col flex-shrink-0 md:flex md:relative md:w-60 lg:w-64 ${mobileChannelsOpen ? 'flex fixed inset-y-0 left-0 w-72 z-50 shadow-2xl' : 'hidden'}`}
                >
                    <div className="px-5 py-5 flex items-center justify-between gap-2">
                        <div className="min-w-0">
                            <h2 className="gnosi-sidebar-section-title">{t('reader_channels')}</h2>
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
                            <span className="text-[11px] text-slate-400 tabular-nums flex-shrink-0">{unreadInventory.count || 0}</span>
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
                                            <span className="gnosi-sidebar-section-title truncate">
                                                {displayCategory(group.category)}
                                            </span>
                                        </span>
                                        {group.unread > 0 && (
                                            <span className="text-[10px] text-slate-400 tabular-nums">{group.unread}</span>
                                        )}
                                    </button>
                                    {!collapsed && group.items.map((source) => {
                                        const isActive = selectedSourceId === source.id;
                                        const count = articleCountsBySource.get(source.id) || 0;
                                        const favicon = getFaviconUrl(source.url);
                                        return (
                                            <button
                                                key={source.id}
                                                onClick={() => handleSelectSource(source.id)}
                                                className={`relative w-full flex items-center justify-between pl-5 pr-5 py-1.5 text-sm transition-colors ${isActive ? 'text-[var(--text-primary)] font-medium' : 'text-slate-600 dark:text-slate-300 hover:text-[var(--text-primary)]'}`}
                                            >
                                                {isActive && (
                                                    <span className="absolute left-0 top-0 bottom-0 w-[2px] bg-[var(--gnosi-blue)]" aria-hidden="true" />
                                                )}
                                                <span className="flex items-center gap-2 min-w-0 flex-1">
                                                    <span className="w-4 h-4 flex-shrink-0 flex items-center justify-center">
                                                        {favicon && (
                                                            <img
                                                                src={favicon}
                                                                alt=""
                                                                loading="lazy"
                                                                referrerPolicy="no-referrer"
                                                                className="w-3.5 h-3.5 rounded-sm opacity-90"
                                                                onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }}
                                                            />
                                                        )}
                                                    </span>
                                                    <span className="truncate">{source.name}</span>
                                                </span>
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

                {/* Column 2: Articles */}
                <div className={`w-full md:w-[360px] lg:w-[400px] border-r border-[var(--border-primary)] bg-[var(--bg-primary)] flex flex-col flex-shrink-0 ${selectedArticle ? 'hidden md:flex' : 'flex'}`}>

                    <div className="px-6 py-5">
                        <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                                <h2 className="text-base font-semibold text-[var(--text-primary)] truncate">
                                    {selectedSource ? selectedSource.name : t('reader_all_articles')}
                                </h2>
                                <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
                                    {articlesLoading && displayArticles.length === 0
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
                        {displayArticles.length === 0 && !articlesLoading ? (
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
                                        const isRead = !!article.is_read;
                                        return (
                                            <div
                                                key={article.id}
                                                onClick={() => setSelectedArticle(article)}
                                                className={`relative px-6 py-4 border-t border-slate-100 dark:border-slate-800/60 cursor-pointer transition-colors ${isSelected ? 'bg-slate-50/40 dark:bg-slate-800/30' : 'hover:bg-slate-50/60 dark:hover:bg-slate-800/30'}`}
                                            >
                                                {isSelected && (
                                                    <span className="absolute left-0 top-0 bottom-0 w-[2px] bg-[var(--gnosi-blue)]" aria-hidden="true" />
                                                )}
                                                {!isRead && !isSelected && (
                                                    <span className="absolute left-2.5 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-[var(--gnosi-blue)]" aria-hidden="true" />
                                                )}
                                                <div className={`text-[11px] mb-1.5 truncate ${isRead ? 'text-slate-400 dark:text-slate-500' : 'text-slate-500 dark:text-slate-400'}`}>
                                                    {formatArticleMeta(article)}
                                                </div>
                                                <h4 className={`text-[15px] leading-snug line-clamp-3 ${
                                                    isSelected ? 'font-semibold text-[var(--text-primary)]'
                                                    : isRead ? 'font-normal text-slate-400 dark:text-slate-500'
                                                    : 'font-medium text-slate-800 dark:text-slate-100'
                                                }`}>
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

                {/* Column 3: Reader */}
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

                            {(() => {
                                // Prefer the extracted full body when the
                                // backend has it (for feeds that only ship
                                // an excerpt). Otherwise use the raw RSS
                                // content. Either way, if it contains tags
                                // we render it inside the sandbox iframe.
                                const body = selectedArticle.full_content || selectedArticle.content || '';
                                const isHtml = body.includes('<');
                                if (!isHtml) return null;
                                return (
                                    // XSS prevention: RSS content comes from external sources
                                    // (attacker-controllable). Instead of injecting with
                                    // dangerouslySetInnerHTML in the main document —which
                                    // would execute embedded scripts— we render it inside
                                    // a sandboxed iframe without `allow-scripts`.
                                    <iframe
                                        key={selectedArticle.id}
                                        srcDoc={`<!DOCTYPE html><html><head><meta charset="utf-8"><base target="_blank"><style>${ARTICLE_IFRAME_CSS}</style></head><body>${body}</body></html>`}
                                        sandbox="allow-same-origin allow-popups"
                                        title="article-content"
                                        onLoad={fitIframeToContent}
                                        style={{ width: '100%', minHeight: '200px', border: 'none', display: 'block' }}
                                    />
                                );
                            })()}
                            {!(selectedArticle.full_content || selectedArticle.content || '').includes('<') && (
                                <div className="prose prose-slate dark:prose-invert max-w-none
                                    prose-headings:font-semibold prose-headings:tracking-tight
                                    prose-p:leading-7
                                    prose-a:text-[var(--gnosi-blue)] prose-a:font-medium prose-a:no-underline hover:prose-a:underline
                                    prose-strong:font-semibold
                                    prose-img:rounded-md prose-img:max-w-full"
                                >
                                    {/*
                                        Plain-text fallback for articles whose
                                        content was flattened to plain text by
                                        the old ingester. Split on blank lines
                                        when possible; if there are none, keep
                                        the text in a single paragraph with
                                        pre-wrap so single-line breaks and
                                        spacing are preserved.
                                    */}
                                    {(() => {
                                        const txt = selectedArticle.content || '';
                                        const paragraphs = txt.split(/\n\s*\n/).filter(p => p.trim());
                                        if (paragraphs.length > 1) {
                                            return paragraphs.map((p, i) => (
                                                <p key={i} style={{ whiteSpace: 'pre-wrap' }}>{p}</p>
                                            ));
                                        }
                                        return <p style={{ whiteSpace: 'pre-wrap' }}>{txt}</p>;
                                    })()}
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

        </div>
    );
};

export default ReaderDashboard;
