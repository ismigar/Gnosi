import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { toast } from 'react-hot-toast';
import { Play, RotateCw, CheckCircle, Headphones, ArrowLeft, Loader, Clock, BookOpen, Filter, History, ChevronRight } from 'lucide-react';
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
    const [selectedSourceId, setSelectedSourceId] = useState(null);
    const [showUnreadOnly, setShowUnreadOnly] = useState(true);
    const [feedManagerOpen, setFeedManagerOpen] = useState(false);

    useEffect(() => {
        fetchSources();
        fetchArticles();
        checkPodcast();
    }, [selectedSourceId, showUnreadOnly]);

    const fetchSources = async () => {
        try {
            const res = await axios.get(`${API_BASE}/reader/sources`);
            setSources(res.data);
        } catch (error) {
            console.error("Error fetching sources:", error);
        }
    };

    const fetchArticles = async () => {
        setLoading(true);
        try {
            let url = `${API_BASE}/reader/articles?unread_only=${showUnreadOnly}`;
            if (selectedSourceId) {
                url += `&source_id=${selectedSourceId}`;
            }
            const res = await axios.get(url);
            setArticles(res.data);
        } catch (error) {
            console.error("Error fetching articles:", error);
        } finally {
            setLoading(false);
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
            // Errors aquí (404 podcast no generat encara, 5xx) són esperats
            // — el podcast info és opcional. Loggeja sense alarmar.
            console.debug('podcast info fetch failed:', error?.message);
        }
    };

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
                            <h2 className="text-xl font-bold tracking-tight text-slate-800">Actualitat</h2>
                        </div>
                        <div className="flex items-center space-x-1">
                            <button
                                onClick={handleSyncAll}
                                className={`p-2 rounded-full hover:bg-slate-100 transition-colors ${loading ? "text-indigo-500 bg-indigo-50" : "text-slate-500"}`}
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
                        <div className="px-4 py-4">
                            <details className="group bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-2xl overflow-hidden transition-all duration-300" open={selectedSourceId !== null}>
                                <summary className="flex items-center justify-between p-4 cursor-pointer font-semibold text-sm text-slate-700 hover:bg-slate-100">
                                    <div className="flex items-center space-x-2">
                                        <Filter size={16} className="text-slate-500" />
                                        <span>Filtres de contingut</span>
                                        {selectedSourceId && <span className="ml-2 w-2 h-2 rounded-full bg-indigo-500 animate-pulse"></span>}
                                    </div>
                                    <ChevronRight size={16} className="transform transition-transform group-open:rotate-90 text-slate-400" />
                                </summary>
                                
                                <div className="p-4 pt-0 space-y-4">
                                    {/* Unread/History Toggle */}
                                    <div className="flex items-center gap-3">
                                        <button 
                                            onClick={() => setShowUnreadOnly(true)}
                                            className={`btn flex-1 flex items-center justify-center space-x-2 ${showUnreadOnly ? 'btn-gnosi-primary' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'}`}
                                        >
                                            <BookOpen size={16} />
                                            <span>Pendents</span>
                                        </button>
                                        <button 
                                            onClick={() => setShowUnreadOnly(false)}
                                            className={`btn flex-1 flex items-center justify-center space-x-2 ${!showUnreadOnly ? 'btn-gnosi-primary' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'}`}
                                        >
                                            <History size={16} />
                                            <span>Històric</span>
                                        </button>
                                    </div>

                                    {/* Source Filter Wrap Layout */}
                                    <div className="flex flex-wrap gap-2">
                                        <button
                                            onClick={() => setSelectedSourceId(null)}
                                            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${!selectedSourceId ? 'bg-slate-800 text-white border-slate-800 shadow-sm' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'}`}
                                        >
                                            Tots els mitjans
                                        </button>
                                        {sources.map(source => (
                                            <button
                                                key={source.id}
                                                onClick={() => setSelectedSourceId(source.id)}
                                                className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${selectedSourceId === source.id ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'}`}
                                            >
                                                {source.name}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            </details>
                        </div>

                        {/* List of articles */}
                        <div className="px-4 space-y-2 pb-12">
                            {loading && articles.length === 0 ? (
                                <div className="flex justify-center p-8 text-slate-400">Carregant articles...</div>
                            ) : articles.length === 0 ? (
                                <div className="text-center py-12 px-4">
                                    <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-slate-100 mb-4">
                                        <CheckCircle size={28} className="text-slate-400" />
                                    </div>
                                    <p className="text-slate-600 font-medium">No tens articles pendents</p>
                                    <p className="text-slate-400 text-sm mt-1">Estàs al dia de l'actualitat.</p>
                                </div>
                            ) : (
                                articles.map((article) => (
                                    <div
                                        key={article.id}
                                        onClick={() => setSelectedArticle(article)}
                                        className={`group p-4 rounded-xl cursor-pointer transition-all duration-200 border-l-4 ${selectedArticle?.id === article.id ? 'bg-indigo-50/50 border-indigo-500 shadow-sm' : 'hover:bg-slate-50 border-transparent hover:border-slate-300 bg-white border border-slate-100'}`}
                                    >
                                        <div className="flex justify-between items-start mb-2">
                                            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 bg-slate-100 px-2 py-1 rounded-md">
                                                {new Date(article.published_at).toLocaleDateString('ca-ES')}
                                            </span>
                                            {article.source_name && (
                                                <span className="text-xs font-medium text-indigo-500 bg-indigo-50 px-2 py-1 rounded-md truncate max-w-[160px]">
                                                    {article.source_name}
                                                </span>
                                            )}
                                            <button
                                                onClick={(e) => markAsRead(article.id, e)}
                                                className="text-slate-300 hover:text-green-500 transition-colors p-1"
                                                title="Marcar com a llegit"
                                            >
                                                <CheckCircle size={18} />
                                            </button>
                                        </div>
                                        <h3 className={`font-semibold text-slate-800 leading-snug line-clamp-3 ${selectedArticle?.id === article.id ? 'text-indigo-900' : ''}`}>
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
                                className="md:hidden mb-6 flex items-center space-x-2 text-slate-500 hover:text-slate-800 transition-colors"
                            >
                                <ArrowLeft size={20} />
                                <span>Tornar a la llista</span>
                            </button>
                            <div className="mb-10">
                                <span className="inline-block px-3 py-1 rounded-full bg-slate-100 text-slate-600 font-medium text-sm mb-4">
                                    {new Date(selectedArticle.published_at).toLocaleString('ca-ES')}
                                </span>
                                <h1 className="text-3xl md:text-5xl font-extrabold text-slate-900 leading-tight mb-6">
                                    {selectedArticle.title}
                                </h1>
                                <div className="flex items-center gap-4">
                                    <button
                                        onClick={() => markAsRead(selectedArticle.id)}
                                        className="flex items-center space-x-2 text-sm font-medium text-green-600 bg-green-50 hover:bg-green-100 px-4 py-2 rounded-full transition-colors"
                                    >
                                        <CheckCircle size={16} />
                                        <span>Llegit & Arxiva</span>
                                    </button>
                                    <a href={selectedArticle.url} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-indigo-600 hover:text-indigo-800 transition-colors">
                                        Veure font original &rarr;
                                    </a>
                                </div>
                            </div>

                            <div className="prose prose-lg prose-slate max-w-none 
                  prose-headings:font-bold prose-headings:text-slate-800 
                  prose-p:text-slate-700 prose-p:leading-relaxed prose-p:mb-6
                  prose-a:text-indigo-600 prose-a:font-medium prose-a:underline-offset-2 hover:prose-a:text-indigo-800
                  prose-strong:font-bold prose-strong:text-slate-900
                  prose-img:rounded-lg prose-img:max-w-full"
                            >
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
                                    selectedArticle.content?.split('\n').map((paragraph, idx) => (
                                        <p key={idx}>{paragraph}</p>
                                    ))
                                )}
                            </div>
                        </div>
                    ) : (
                        <div className="h-full flex flex-col items-center justify-center text-slate-400">
                            <div className="w-24 h-24 mb-6 rounded-3xl bg-slate-100 flex items-center justify-center rotate-3 shadow-inner">
                                <span className="text-4xl text-slate-300">📖</span>
                            </div>
                            <p className="text-xl font-medium text-slate-500">Selecciona un article per llegir</p>
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
