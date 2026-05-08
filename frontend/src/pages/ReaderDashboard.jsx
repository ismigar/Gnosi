import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { toast } from '../lib/toast';
import { Play, RotateCw, CheckCircle, Headphones, ArrowLeft, Loader, Clock, BookOpen, Filter, History, ChevronRight, Search, X } from 'lucide-react';
import { FeedManagerModal } from '../components/FeedManagerModal';
import { AppHeader } from '../components/AppHeader';

const API_BASE = '/api';

const ReaderDashboard = () => {
    const [articles, setArticles] = useState([]);
    const [selectedArticle, setSelectedArticle] = useState(null);
    const [loading, setLoading] = useState(true);
    const [generatingPodcast, setGeneratingPodcast] = useState(false);
    const [podcastUrl, setPodcastUrl] = useState(null);
    const [podcastInfo, setPodcastInfo] = useState(null);
    const [sources, setSources] = useState([]);
    // Set d'IDs seleccionats. Buit = "Tots els mitjans" (cap filtre).
    const [selectedSourceIds, setSelectedSourceIds] = useState(() => new Set());
    const [sourceSearch, setSourceSearch] = useState('');
    // Estat propi del <details> dels filtres: l'usuari el controla amb el clic
    // al <summary>. Necessari per evitar que un re-render colapsi el panel
    // quan l'usuari escriu al cercador o canvia altres camps interns.
    const [filtersOpen, setFiltersOpen] = useState(false);
    const [showUnreadOnly, setShowUnreadOnly] = useState(true);
    const [feedManagerOpen, setFeedManagerOpen] = useState(false);

    useEffect(() => {
        fetchSources();
        checkPodcast();
    }, [fetchSources, checkPodcast]);

    useEffect(() => {
        fetchArticles();
    }, [fetchArticles]);

    const toggleSourceSelection = (id) => {
        setSelectedSourceIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    };

    const clearSourceSelection = () => setSelectedSourceIds(new Set());

    const selectAllVisibleSources = (visibleSources) => {
        setSelectedSourceIds(new Set(visibleSources.map(s => s.id)));
    };

    const fetchSources = useCallback(async () => {
        try {
            const res = await axios.get(`${API_BASE}/reader/sources`);
            setSources(res.data);
        } catch (error) {
            console.error("Error fetching sources:", error);
        }
    }, []);

    const fetchArticles = useCallback(async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams();
            params.set('unread_only', String(showUnreadOnly));
            // Repetim source_id per cada font seleccionada; backend ho interpreta com a OR.
            for (const id of selectedSourceIds) params.append('source_id', String(id));
            const res = await axios.get(`${API_BASE}/reader/articles?${params.toString()}`);
            setArticles(res.data);
        } catch (error) {
            console.error("Error fetching articles:", error);
        } finally {
            setLoading(false);
        }
    }, [selectedSourceIds, showUnreadOnly]);

    const checkPodcast = useCallback(async () => {
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
            // Errors aquí (404 podcast no generat encara, 5xx) són esperats
            // — el podcast info és opcional. Loggeja sense alarmar.
            console.debug('podcast info fetch failed:', error?.message);
        }
    }, []);

    const markAsRead = async (id, e) => {
        if (e) e.stopPropagation();
        try {
            await axios.patch(`${API_BASE}/reader/articles/${id}/read?read=true`);
            setArticles(articles.filter((a) => a.id !== id));
            if (selectedArticle?.id === id) {
                setSelectedArticle(null);
            }
        } catch (error) {
            console.error("Error marking as read", error);
        }
    };

    const pollingRef = React.useRef(null);
    const [podcastProgress, setPodcastProgress] = useState('');

    const generatePodcast = async () => {
        setGeneratingPodcast(true);
        setPodcastProgress('Iniciant generació...');
        try {
            const res = await axios.post(`${API_BASE}/reader/podcast/generate`);
            if (res.data.status === 'already_running') {
                setPodcastProgress(res.data.progress || 'Ja en curs...');
            }
            // Start polling for status
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
            toast.error("Error iniciant la generació del podcast.");
            console.error(error);
            setGeneratingPodcast(false);
            setPodcastProgress('');
        }
    };

    // Cleanup polling on unmount
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
            const res = await axios.get(`${API_BASE}/reader/articles?unread_only=true`);
            setArticles(res.data);
        } catch (error) {
            console.error("Error durant la sincronització:", error);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="flex flex-col h-screen w-full bg-[var(--bg-primary)] text-[var(--text-primary)] font-sans overflow-hidden">
            <AppHeader icon={BookOpen} title="Lector" />

            <div className="flex flex-1 overflow-hidden">
                {/* Sidebar: Article List */}
                <div className={`w-full md:w-1/3 border-r border-[var(--border-primary)] bg-[var(--bg-primary)] flex flex-col transition-all duration-300 ${selectedArticle ? 'hidden md:flex' : 'flex'}`}>

                    {/* Header Options (STAY FIXED) */}
                    <div className="p-6 border-b border-[var(--border-primary)] bg-[var(--bg-primary)]/80 backdrop-blur-md sticky top-0 z-10 flex justify-between items-center">
                        <div>
                            <h2 className="text-xl font-bold tracking-tight text-slate-800 dark:text-slate-100">Actualitat</h2>
                        </div>
                        <div className="flex items-center space-x-1">
                            <button
                                onClick={handleSyncAll}
                                className={`p-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors ${loading ? "text-indigo-500 bg-indigo-50 dark:bg-indigo-500/15" : "text-slate-500 dark:text-slate-400"}`}
                                title="Sincronitzar actualitat"
                                disabled={loading}
                            >
                                <RotateCw size={18} className={loading ? "animate-spin" : ""} />
                            </button>
                        </div>
                    </div>

                    {/* Main Scrollable Area (Unified) */}
                    <div className="overflow-y-auto flex-1 pb-24">
                        
                        {/* Listen Card */}
                        <div className="p-4 mx-4 mt-4 rounded-2xl bg-[var(--gnosi-blue)] text-white shadow-lg shadow-indigo-500/30">
                            <div className="flex items-center justify-between mb-3">
                                <div className="flex items-center space-x-2">
                                    <Headphones size={20} className="text-indigo-100" />
                                    <h3 className="font-semibold tracking-wide text-sm uppercase text-indigo-50">Podcast Diari</h3>
                                </div>
                            </div>
                            {podcastInfo && (
                                <div className="text-xs text-indigo-200 mb-3 flex items-center space-x-1.5 opacity-90">
                                    <Clock size={12} />
                                    <span>Creat el {podcastInfo.formatted_date} a les {podcastInfo.formatted_time}</span>
                                </div>
                            )}
                            <p className="text-xs text-indigo-100 mb-4 opacity-90 leading-relaxed">
                                Sintitza l'actualitat amb IA perquè la puguis escoltar lliure de fatiga visual.
                            </p>

                            <div className="flex flex-col space-y-3">
                                {podcastUrl && (
                                    <audio controls className="w-full h-10 rounded-full" src={podcastUrl}>
                                        El teu navegador no suporta el element de audio.
                                    </audio>
                                )}
                                <button
                                    onClick={generatePodcast}
                                    disabled={generatingPodcast}
                                    className="flex items-center justify-center space-x-2 w-full py-2.5 px-4 bg-white/10 hover:bg-white/20 backdrop-blur-sm rounded-xl font-medium text-sm transition-all border border-white/10"
                                >
                                    {generatingPodcast ? <Loader size={16} className="animate-spin" /> : <Play size={16} fill="currentColor" />}
                                    <span>{generatingPodcast ? (podcastProgress || 'Sintetitzant...') : "Generar Nou Episodi"}</span>
                                </button>
                            </div>
                        </div>

                        {/* Filters Dropdown (Fieldset/Details) */}
                        {(() => {
                            const q = sourceSearch.trim().toLowerCase();
                            const visibleSources = q
                                ? sources.filter(s => (s.name || '').toLowerCase().includes(q) || (s.category || '').toLowerCase().includes(q))
                                : sources;
                            const selectedCount = selectedSourceIds.size;
                            return (
                                <div className="px-4 py-4">
                                    <details
                                        className="group bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-2xl overflow-hidden transition-all duration-300"
                                        open={filtersOpen}
                                        onToggle={(e) => setFiltersOpen(e.currentTarget.open)}
                                    >
                                        <summary className="flex items-center justify-between p-4 cursor-pointer font-semibold text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800">
                                            <div className="flex items-center space-x-2">
                                                <Filter size={16} className="text-slate-500 dark:text-slate-400" />
                                                <span>Filtres de contingut</span>
                                                {selectedCount > 0 && (
                                                    <span className="ml-2 inline-flex items-center justify-center min-w-[1.5rem] h-5 px-1.5 rounded-full bg-indigo-500 text-white text-[10px] font-bold">{selectedCount}</span>
                                                )}
                                            </div>
                                            <ChevronRight size={16} className="transform transition-transform group-open:rotate-90 text-slate-400 dark:text-slate-500" />
                                        </summary>

                                        <div className="p-4 pt-0 space-y-4">
                                            {/* Unread/History Toggle */}
                                            <div className="flex items-center gap-3">
                                                <button
                                                    onClick={() => setShowUnreadOnly(true)}
                                                    className={`btn flex-1 flex items-center justify-center space-x-2 ${showUnreadOnly ? 'btn-gnosi-primary' : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/50'}`}
                                                >
                                                    <BookOpen size={16} />
                                                    <span>Pendents</span>
                                                </button>
                                                <button
                                                    onClick={() => setShowUnreadOnly(false)}
                                                    className={`btn flex-1 flex items-center justify-center space-x-2 ${!showUnreadOnly ? 'btn-gnosi-primary' : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/50'}`}
                                                >
                                                    <History size={16} />
                                                    <span>Històric</span>
                                                </button>
                                            </div>

                                            {/* Source search box */}
                                            <div className="relative">
                                                <Search size={14} className="absolute top-1/2 -translate-y-1/2 left-3 text-slate-400 dark:text-slate-500 pointer-events-none" />
                                                <input
                                                    type="text"
                                                    value={sourceSearch}
                                                    onChange={(e) => setSourceSearch(e.target.value)}
                                                    placeholder="Cerca fonts per nom o categoria..."
                                                    className="w-full pl-9 pr-9 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-700 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 dark:focus:ring-indigo-500/20"
                                                />
                                                {sourceSearch && (
                                                    <button
                                                        type="button"
                                                        onClick={() => setSourceSearch('')}
                                                        className="absolute top-1/2 -translate-y-1/2 right-2 p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300"
                                                        aria-label="Netejar cerca"
                                                        title="Netejar cerca"
                                                    >
                                                        <X size={14} />
                                                    </button>
                                                )}
                                            </div>

                                            {/* Bulk actions row */}
                                            <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                                                <span>
                                                    {visibleSources.length} de {sources.length} font(s)
                                                    {selectedCount > 0 && <> · <span className="font-semibold text-indigo-600 dark:text-indigo-400">{selectedCount} seleccionada(es)</span></>}
                                                </span>
                                                <div className="flex items-center gap-2">
                                                    <button
                                                        onClick={() => selectAllVisibleSources(visibleSources)}
                                                        disabled={visibleSources.length === 0}
                                                        className="px-2 py-1 rounded text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-500/10 disabled:opacity-40 disabled:cursor-not-allowed"
                                                    >
                                                        Selecciona{q ? ' (visibles)' : ' totes'}
                                                    </button>
                                                    <button
                                                        onClick={clearSourceSelection}
                                                        disabled={selectedCount === 0}
                                                        className="px-2 py-1 rounded text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed"
                                                    >
                                                        Neteja
                                                    </button>
                                                </div>
                                            </div>

                                            {/* Source Filter Wrap Layout */}
                                            <div className="flex flex-wrap gap-2 max-h-72 overflow-y-auto pr-1">
                                                <button
                                                    onClick={clearSourceSelection}
                                                    className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${selectedCount === 0 ? 'bg-slate-800 dark:bg-slate-100 text-white dark:text-slate-900 border-slate-800 dark:border-slate-100 shadow-sm' : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'}`}
                                                >
                                                    Tots els mitjans
                                                </button>
                                                {visibleSources.map(source => {
                                                    const active = selectedSourceIds.has(source.id);
                                                    return (
                                                        <button
                                                            key={source.id}
                                                            onClick={() => toggleSourceSelection(source.id)}
                                                            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${active ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm' : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'}`}
                                                            title={source.url}
                                                        >
                                                            {source.name}
                                                        </button>
                                                    );
                                                })}
                                                {q && visibleSources.length === 0 && (
                                                    <span className="text-xs text-slate-400 dark:text-slate-500 italic px-3 py-1.5">Cap font coincideix amb «{sourceSearch}»</span>
                                                )}
                                            </div>
                                        </div>
                                    </details>
                                </div>
                            );
                        })()}

                        {/* List of articles */}
                        <div className="px-4 space-y-2 pb-12">
                            {loading && articles.length === 0 ? (
                                <div className="flex justify-center p-8 text-slate-400 dark:text-slate-500">Carregant articles...</div>
                            ) : articles.length === 0 ? (
                                <div className="text-center py-12 px-4">
                                    <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-slate-100 dark:bg-slate-800 mb-4">
                                        <CheckCircle size={28} className="text-slate-400 dark:text-slate-500" />
                                    </div>
                                    <p className="text-slate-600 dark:text-slate-300 font-medium">No tens articles pendents</p>
                                    <p className="text-slate-400 dark:text-slate-500 text-sm mt-1">Estàs al dia de l'actualitat.</p>
                                </div>
                            ) : (
                                articles.map((article) => (
                                    <div
                                        key={article.id}
                                        onClick={() => setSelectedArticle(article)}
                                        className={`group p-4 rounded-xl cursor-pointer transition-all duration-200 border-l-4 ${selectedArticle?.id === article.id ? 'bg-indigo-50/50 dark:bg-indigo-500/10 border-indigo-500 shadow-sm' : 'hover:bg-slate-50 dark:hover:bg-slate-800/60 border-transparent hover:border-slate-300 dark:hover:border-slate-600 bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800'}`}
                                    >
                                        <div className="flex justify-between items-start mb-2">
                                            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded-md">
                                                {new Date(article.published_at).toLocaleDateString('ca-ES')}
                                            </span>
                                            {article.source_name && (
                                                <span className="text-xs font-medium text-indigo-500 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-500/15 px-2 py-1 rounded-md truncate max-w-[160px]">
                                                    {article.source_name}
                                                </span>
                                            )}
                                            <button
                                                onClick={(e) => markAsRead(article.id, e)}
                                                className="text-slate-300 dark:text-slate-600 hover:text-green-500 dark:hover:text-green-400 transition-colors p-1"
                                                title="Marcar com a llegit"
                                            >
                                                <CheckCircle size={18} />
                                            </button>
                                        </div>
                                        <h3 className={`font-semibold leading-snug line-clamp-3 ${selectedArticle?.id === article.id ? 'text-indigo-900 dark:text-indigo-200' : 'text-slate-800 dark:text-slate-100'}`}>
                                            {article.title}
                                        </h3>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                </div>

                {/* Main Content Area (Reader) */}
                <div className={`w-full md:w-2/3 bg-[var(--bg-primary)] h-full overflow-y-auto ${!selectedArticle ? 'hidden md:block bg-[var(--bg-secondary)]/50' : 'block'}`}>
                    {selectedArticle ? (
                        <div className="max-w-3xl mx-auto py-12 px-6 md:px-12 relative animate-fade-in-up">
                            <button
                                onClick={() => setSelectedArticle(null)}
                                className="md:hidden mb-6 flex items-center space-x-2 text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-100 transition-colors"
                            >
                                <ArrowLeft size={20} />
                                <span>Tornar a la llista</span>
                            </button>
                            <div className="mb-10">
                                <span className="inline-block px-3 py-1 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-medium text-sm mb-4">
                                    {new Date(selectedArticle.published_at).toLocaleString('ca-ES')}
                                </span>
                                <h1 className="text-3xl md:text-5xl font-extrabold text-slate-900 dark:text-slate-100 leading-tight mb-6">
                                    {selectedArticle.title}
                                </h1>
                                <div className="flex items-center gap-4">
                                    <button
                                        onClick={() => markAsRead(selectedArticle.id)}
                                        className="flex items-center space-x-2 text-sm font-medium text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-500/10 hover:bg-green-100 dark:hover:bg-green-500/20 px-4 py-2 rounded-full transition-colors"
                                    >
                                        <CheckCircle size={16} />
                                        <span>Llegit & Arxiva</span>
                                    </button>
                                    <a href={selectedArticle.url} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 transition-colors">
                                        Veure font original &rarr;
                                    </a>
                                </div>
                            </div>

                            <div className="prose prose-lg prose-slate dark:prose-invert max-w-none
                  prose-headings:font-bold prose-headings:text-slate-800 dark:prose-headings:text-slate-100
                  prose-p:text-slate-700 dark:prose-p:text-slate-300 prose-p:leading-relaxed prose-p:mb-6
                  prose-a:text-indigo-600 dark:prose-a:text-indigo-400 prose-a:font-medium prose-a:underline-offset-2 hover:prose-a:text-indigo-800 dark:hover:prose-a:text-indigo-300
                  prose-strong:font-bold prose-strong:text-slate-900 dark:prose-strong:text-slate-100
                  prose-img:rounded-lg prose-img:max-w-full"
                            >
                                {selectedArticle.content && selectedArticle.content.includes('<') ? (
                                    // XSS prevention: el contingut RSS ve de fonts externes
                                    // (atacant-controlables). En lloc d'injectar amb
                                    // dangerouslySetInnerHTML al document principal —que
                                    // executaria scripts incrustats— el renderitzem dins
                                    // un iframe sandbox sense `allow-scripts`.
                                    (() => {
                                        const isDark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark');
                                        const fg = isDark ? '#e2e8f0' : '#1e293b';
                                        const bg = isDark ? '#0a0a0a' : 'transparent';
                                        const linkColor = isDark ? '#818cf8' : '#4f46e5';
                                        return (
                                            <iframe
                                                srcDoc={`<!DOCTYPE html><html><head><meta charset="utf-8"><base target="_blank"><style>body{font-family:Inter,system-ui,sans-serif;color:${fg};background:${bg};line-height:1.7;padding:0;margin:0;}img{max-width:100%;height:auto;border-radius:8px}a{color:${linkColor}}</style></head><body>${selectedArticle.content}</body></html>`}
                                                sandbox="allow-popups"
                                                title="article-content"
                                                style={{ width: '100%', minHeight: '600px', border: 'none' }}
                                            />
                                        );
                                    })()
                                ) : (
                                    selectedArticle.content?.split('\n').map((paragraph, idx) => (
                                        <p key={idx}>{paragraph}</p>
                                    ))
                                )}
                            </div>
                        </div>
                    ) : (
                        <div className="h-full flex flex-col items-center justify-center text-slate-400 dark:text-slate-500">
                            <div className="w-24 h-24 mb-6 rounded-3xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center rotate-3 shadow-inner">
                                <span className="text-4xl text-slate-300 dark:text-slate-600">📖</span>
                            </div>
                            <p className="text-xl font-medium text-slate-500 dark:text-slate-400">Selecciona un article per llegir</p>
                            <p className="text-sm mt-2 opacity-75">O bé tria escoltar el podcast diari d'avui.</p>
                        </div>
                    )}
                </div>
            </div>

            <FeedManagerModal
                isOpen={feedManagerOpen}
                onClose={() => setFeedManagerOpen(false)}
                onRefresh={fetchArticles}
            />
        </div>
    );
};

export default ReaderDashboard;
