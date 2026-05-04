import React, { useEffect, useState } from 'react';
import { Clock3, History, Play, RefreshCw } from 'lucide-react';

function Dashboard() {
    const [stats, setStats] = useState({ cpu: 0, ram_percent: 0, memory_items: 0, status: 'offline' });
    const [pendingTools, setPendingTools] = useState([]);
    const [approvedTools, setApprovedTools] = useState([]);
    const [approvedLoading, setApprovedLoading] = useState(true);
    const [analytics, setAnalytics] = useState(null);
    const [schedulers, setSchedulers] = useState([]);
    const [schedulerLoading, setSchedulerLoading] = useState(true);
    const [selectedControlTab, setSelectedControlTab] = useState('schedulers');

    useEffect(() => {
        const fetchStats = async () => {
            try {
                const res = await fetch('/api/system/stats');
                if (res.ok) {
                    const data = await res.json();
                    setStats(data);
                }
            } catch (e) {
                console.error("Error fetching stats", e);
            }
        };

        const fetchPendingTools = async () => {
            try {
                const res = await fetch('/api/tools/pending');
                if (res.ok) {
                    const data = await res.json();
                    setPendingTools(data);
                }
            } catch (e) {
                console.error("Error fetching pending tools", e);
            }
        };

        const fetchAnalytics = async () => {
            try {
                const res = await fetch('/api/analytics');
                if (res.ok) {
                    const data = await res.json();
                    setAnalytics(data);
                }
            } catch (e) {
                console.error("Error fetching analytics", e);
            }
        };

        const fetchSchedulers = async () => {
            setSchedulerLoading(true);
            try {
                const res = await fetch('/api/schedulers');
                if (res.ok) {
                    const data = await res.json();
                    setSchedulers(Array.isArray(data) ? data : []);
                }
            } catch (e) {
                console.error("Error fetching schedulers", e);
            } finally {
                setSchedulerLoading(false);
            }
        };

        const fetchApprovedTools = async () => {
            setApprovedLoading(true);
            try {
                const res = await fetch('/api/tools/approved');
                if (res.ok) {
                    const data = await res.json();
                    setApprovedTools(Array.isArray(data) ? data : []);
                }
            } catch (e) {
                console.error("Error fetching approved tools", e);
            } finally {
                setApprovedLoading(false);
            }
        };

        fetchStats();
        fetchPendingTools();
        fetchAnalytics();
        fetchSchedulers();
        fetchApprovedTools();
        const interval = setInterval(fetchStats, 2000);
        const toolsInterval = setInterval(fetchPendingTools, 5000);
        const analyticsInterval = setInterval(fetchAnalytics, 30000);
        const schedulersInterval = setInterval(fetchSchedulers, 30000);
        const approvedToolsInterval = setInterval(fetchApprovedTools, 30000);
        return () => {
            clearInterval(interval);
            clearInterval(toolsInterval);
            clearInterval(analyticsInterval);
            clearInterval(schedulersInterval);
            clearInterval(approvedToolsInterval);
        };
    }, []);

    const refreshSchedulers = async () => {
        setSchedulerLoading(true);
        try {
            const res = await fetch('/api/schedulers');
            if (res.ok) {
                const data = await res.json();
                setSchedulers(Array.isArray(data) ? data : []);
            }
        } catch (e) {
            console.error("Error refreshing schedulers", e);
        } finally {
            setSchedulerLoading(false);
        }
    };

    const updateScheduler = async (task, overrides) => {
        try {
            const payload = { ...task, ...overrides };
            const res = await fetch(`/api/schedulers/${task.name}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (res.ok) {
                await refreshSchedulers();
            }
        } catch (e) {
            console.error("Error updating scheduler", e);
        }
    };

    const runSchedulerNow = async (taskName) => {
        try {
            await fetch(`/api/schedulers/${taskName}/run`, { method: 'POST' });
            await refreshSchedulers();
        } catch (e) {
            console.error("Error running scheduler", e);
        }
    };

    const formatFrequency = (task) => {
        if (typeof task.interval_minutes === 'number' && task.interval_minutes > 0) {
            if (task.interval_minutes % 1440 === 0) {
                return `Cada ${task.interval_minutes / 1440} dia(s)`;
            }
            if (task.interval_minutes % 60 === 0) {
                return `Cada ${task.interval_minutes / 60} hora(s)`;
            }
            return `Cada ${task.interval_minutes} min`;
        }
        if (typeof task.interval === 'number' && task.interval > 0) {
            return `Cada ${task.interval}s`;
        }
        return 'No definida';
    };

    return (
        <div className="p-8 bg-[#0a0a0c] min-h-screen text-white relative overflow-hidden">
            {/* Background Glows */}
            <div className="home-page__glow home-page__glow--1" style={{ opacity: 0.1 }} />
            <div className="home-page__glow home-page__glow--2" style={{ opacity: 0.1 }} />

            <header className="mb-12 relative z-10 animate-in fade-in slide-in-from-top-4 duration-700">
                <h1 className="text-4xl font-extrabold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-white to-gray-500">
                    Gnosi Control Center
                </h1>
                <p className="text-gray-400 mt-2">Monitoritzant l'ecosistema de coneixement en temps real.</p>
            </header>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-6 relative z-10">
                {/* Status Card */}
                <div className="glass-panel p-6 rounded-2xl border border-white/5 hover:border-white/10 transition-all group">
                    <h3 className="text-gray-500 text-xs uppercase font-bold tracking-widest mb-4">System Status</h3>
                    <div className="flex items-center">
                        <div className={`w-3 h-3 rounded-full mr-3 animate-pulse ${stats.status === 'online' ? 'bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.5)]' : 'bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.5)]'}`}></div>
                        <span className="text-2xl font-bold capitalize tracking-tight group-hover:text-blue-400 transition-colors">{stats.status}</span>
                    </div>
                </div>

                {/* Memory Card */}
                <div className="glass-panel p-6 rounded-2xl border border-white/5 hover:border-white/10 transition-all group">
                    <h3 className="text-gray-500 text-xs uppercase font-bold tracking-widest mb-4">Long-Term Memory</h3>
                    <div className="flex items-baseline gap-2">
                        <span className="text-4xl font-black text-blue-400 tracking-tighter group-hover:scale-110 transition-transform origin-left duration-300">{stats.memory_items}</span>
                        <span className="text-gray-500 text-sm font-medium">memories stored</span>
                    </div>
                </div>

                {/* CPU Card */}
                <div className="glass-panel p-6 rounded-2xl border border-white/5 hover:border-white/10 transition-all">
                    <h3 className="text-gray-500 text-xs uppercase font-bold tracking-widest mb-4">CPU Usage</h3>
                    <div className="mt-2">
                        <span className="text-4xl font-black text-purple-400 tracking-tighter">{stats.cpu}%</span>
                    </div>
                    <div className="w-full bg-white/5 h-1.5 mt-4 rounded-full overflow-hidden">
                        <div className="bg-gradient-to-r from-purple-600 to-purple-400 h-full transition-all duration-1000" style={{ width: `${stats.cpu}%` }}></div>
                    </div>
                </div>

                {/* RAM Card */}
                <div className="glass-panel p-6 rounded-2xl border border-white/5 hover:border-white/10 transition-all">
                    <h3 className="text-gray-500 text-xs uppercase font-bold tracking-widest mb-4">RAM Usage</h3>
                    <div className="mt-2">
                        <span className="text-4xl font-black text-pink-400 tracking-tighter">{stats.ram_percent}%</span>
                    </div>
                    <div className="w-full bg-white/5 h-1.5 mt-4 rounded-full overflow-hidden">
                        <div className="bg-gradient-to-r from-pink-600 to-pink-400 h-full transition-all duration-1000" style={{ width: `${stats.ram_percent}%` }}></div>
                    </div>
                </div>
            </div>

            {/* Analytics Section */}
            {analytics && (
                <div className="mt-12 relative z-10">
                    <h2 className="text-xl font-bold mb-6 flex items-center gap-2">
                        <span className="w-1 h-6 bg-blue-500 rounded-full"></span>
                        Analytics Overview
                    </h2>
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                        {/* Tools Created */}
                        <div className="glass-panel p-6 rounded-2xl border border-white/5 hover:border-white/10 transition-all">
                            <h3 className="text-gray-500 text-xs uppercase font-bold tracking-widest mb-4">Eines Creades</h3>
                            <div className="text-4xl font-black text-green-400 tracking-tighter">{analytics.tools?.total_tools || 0}</div>
                            <div className="mt-4 flex gap-3 text-[10px] items-center">
                                <span className="bg-green-500/10 text-green-500 px-2 py-0.5 rounded-full font-bold">{analytics.tools?.approved || 0} APROVADES</span>
                                <span className="bg-yellow-500/10 text-yellow-500 px-2 py-0.5 rounded-full font-bold">{analytics.tools?.pending || 0} PENDENTS</span>
                            </div>
                        </div>

                        {/* Errors Prevented */}
                        <div className="glass-panel p-6 rounded-2xl border border-white/5 hover:border-white/10 transition-all">
                            <h3 className="text-gray-500 text-xs uppercase font-bold tracking-widest mb-4">Errors Evitats</h3>
                            <div className="text-4xl font-black text-red-400 tracking-tighter">{analytics.errors_prevented || 0}</div>
                            <div className="mt-4 text-[10px] font-bold text-gray-500 uppercase tracking-widest">Trampes documentades</div>
                        </div>

                        {/* Directives */}
                        <div className="glass-panel p-6 rounded-2xl border border-white/5 hover:border-white/10 transition-all">
                            <h3 className="text-gray-500 text-xs uppercase font-bold tracking-widest mb-4">Directives</h3>
                            <div className="text-4xl font-black text-cyan-400 tracking-tighter">{analytics.directives?.total || 0}</div>
                            <div className="mt-4 text-[10px] font-bold text-gray-500 uppercase tracking-widest">SOPs actives</div>
                        </div>

                        {/* Recent Activity */}
                        <div className="glass-panel p-6 rounded-2xl border border-white/5 hover:border-white/10 transition-all">
                            <h3 className="text-gray-500 text-xs uppercase font-bold tracking-widest mb-4">Última Setmana</h3>
                            <div className="text-4xl font-black text-orange-400 tracking-tighter">{analytics.tools?.created_last_7_days || 0}</div>
                            <div className="mt-4 text-[10px] font-bold text-gray-500 uppercase tracking-widest">Eines noves</div>
                        </div>
                    </div>
                </div>
            )}

            {/* Control Center Tabs */}
            <div className="mt-16 relative z-10">
                <div className="flex items-center gap-3 mb-6">
                    <button
                        onClick={() => setSelectedControlTab('schedulers')}
                        className={`px-4 py-2 rounded-xl text-sm font-semibold border transition-all ${selectedControlTab === 'schedulers'
                            ? 'bg-blue-500/20 border-blue-400/60 text-blue-200'
                            : 'bg-white/5 border-white/10 text-gray-300 hover:bg-white/10'
                            }`}
                    >
                        <span className="inline-flex items-center gap-2">
                            <Clock3 size={16} />
                            Processos Calendaritzables
                        </span>
                    </button>
                    <button
                        onClick={() => setSelectedControlTab('history')}
                        className={`px-4 py-2 rounded-xl text-sm font-semibold border transition-all ${selectedControlTab === 'history'
                            ? 'bg-blue-500/20 border-blue-400/60 text-blue-200'
                            : 'bg-white/5 border-white/10 text-gray-300 hover:bg-white/10'
                            }`}
                    >
                        <span className="inline-flex items-center gap-2">
                            <History size={16} />
                            Logs i Historial
                        </span>
                    </button>
                </div>

                {selectedControlTab === 'schedulers' && (
                    <div className="glass-panel p-6 rounded-2xl border border-white/5">
                        <div className="flex items-center justify-between mb-6">
                            <h2 className="text-xl font-bold flex items-center gap-2">
                                <span className="w-1 h-6 bg-blue-500 rounded-full"></span>
                                Processos Calendaritzables
                            </h2>
                            <button
                                onClick={refreshSchedulers}
                                className="inline-flex items-center gap-2 text-xs font-semibold px-3 py-2 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10"
                            >
                                <RefreshCw size={14} />
                                Refrescar
                            </button>
                        </div>

                        {schedulerLoading ? (
                            <p className="text-gray-400">Carregant tasques...</p>
                        ) : schedulers.length === 0 ? (
                            <p className="text-gray-500">No hi ha tasques programades.</p>
                        ) : (
                            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                                {schedulers.map(task => (
                                    <div
                                        key={task.name}
                                        className={`p-5 rounded-xl border transition-all h-full flex flex-col ${task.enabled ? 'border-green-500/40 bg-green-500/5' : 'border-white/10 bg-white/5'}`}
                                    >
                                        <div className="flex-1">
                                            <h3 className="text-sm font-bold uppercase tracking-wide">{task.name.replace(/_/g, ' ')}</h3>
                                            <p className="text-sm text-gray-400 mt-1">{task.description}</p>
                                            <p className="text-xs text-gray-500 mt-2">{formatFrequency(task)}</p>
                                            {task.last_run && (
                                                <p className="text-xs text-gray-500 mt-1">
                                                    Ultima execucio: {new Date(task.last_run).toLocaleString()}
                                                </p>
                                            )}
                                        </div>

                                        <div className="mt-4 flex flex-wrap items-center gap-3">
                                            <label className="inline-flex items-center gap-2 text-xs text-gray-300">
                                                <input
                                                    type="checkbox"
                                                    checked={task.enabled}
                                                    onChange={(e) => updateScheduler(task, { enabled: e.target.checked })}
                                                />
                                                {task.enabled ? 'Actiu' : 'Inactiu'}
                                            </label>

                                            {typeof task.interval_minutes === 'number' && (
                                                <select
                                                    className="text-xs bg-black/30 border border-white/10 rounded-lg px-2 py-1"
                                                    value={task.interval_minutes}
                                                    onChange={(e) => updateScheduler(task, { interval_minutes: Number(e.target.value) })}
                                                >
                                                    <option value={60}>1 hora</option>
                                                    <option value={120}>2 hores</option>
                                                    <option value={180}>3 hores</option>
                                                    <option value={360}>6 hores</option>
                                                    <option value={720}>12 hores</option>
                                                    <option value={1440}>1 dia</option>
                                                    <option value={10080}>1 setmana</option>
                                                </select>
                                            )}

                                            <button
                                                onClick={() => runSchedulerNow(task.name)}
                                                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-xs font-semibold"
                                            >
                                                <Play size={12} />
                                                Executar ara
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {selectedControlTab === 'history' && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                        <div className="glass-panel p-6 rounded-2xl border border-white/5">
                            <h3 className="text-gray-500 text-xs uppercase font-bold tracking-widest mb-4">Resum d'activitat</h3>
                            <div className="space-y-3 text-sm">
                                <div className="flex items-center justify-between border border-white/10 rounded-lg p-3 bg-white/5">
                                    <span className="text-gray-300">Eines pendents d'aprovacio</span>
                                    <span className="font-bold text-yellow-300">{pendingTools.length}</span>
                                </div>
                                <div className="flex items-center justify-between border border-white/10 rounded-lg p-3 bg-white/5">
                                    <span className="text-gray-300">Eines aprovades totals</span>
                                    <span className="font-bold text-green-300">{analytics?.tools?.approved ?? 0}</span>
                                </div>
                                <div className="flex items-center justify-between border border-white/10 rounded-lg p-3 bg-white/5">
                                    <span className="text-gray-300">Eines rebutjades totals</span>
                                    <span className="font-bold text-red-300">{analytics?.tools?.rejected ?? 0}</span>
                                </div>
                                <div className="flex items-center justify-between border border-white/10 rounded-lg p-3 bg-white/5">
                                    <span className="text-gray-300">Errors evitats</span>
                                    <span className="font-bold text-cyan-300">{analytics?.errors_prevented ?? 0}</span>
                                </div>
                            </div>

                            <h4 className="text-gray-500 text-xs uppercase font-bold tracking-widest mt-7 mb-4">Ultimes execucions programades</h4>
                            <div className="space-y-2 max-h-[260px] overflow-y-auto pr-1">
                                {schedulers
                                    .filter(task => task.last_run)
                                    .sort((a, b) => new Date(b.last_run) - new Date(a.last_run))
                                    .slice(0, 10)
                                    .map(task => (
                                        <div key={`${task.name}-last`} className="border border-white/10 rounded-lg p-3 bg-white/5">
                                            <p className="text-sm font-semibold text-white">{task.name.replace(/_/g, ' ')}</p>
                                            <p className="text-xs text-gray-400">{new Date(task.last_run).toLocaleString()}</p>
                                        </div>
                                    ))}
                                {schedulers.filter(task => task.last_run).length === 0 && (
                                    <p className="text-sm text-gray-500">Encara no hi ha execucions registrades.</p>
                                )}
                            </div>
                        </div>

                        <div className="glass-panel p-6 rounded-2xl border border-white/5">
                            <h3 className="text-gray-500 text-xs uppercase font-bold tracking-widest mb-4">Historial d'eines aprovades</h3>
                            {approvedLoading ? (
                                <p className="text-gray-400">Carregant historial...</p>
                            ) : approvedTools.length === 0 ? (
                                <p className="text-gray-500">No hi ha eines aprovades encara.</p>
                            ) : (
                                <div className="space-y-3 max-h-[520px] overflow-y-auto pr-1">
                                    {approvedTools
                                        .slice()
                                        .sort((a, b) => {
                                            const aTs = a.approved_at ? new Date(a.approved_at).getTime() : 0;
                                            const bTs = b.approved_at ? new Date(b.approved_at).getTime() : 0;
                                            return bTs - aTs;
                                        })
                                        .slice(0, 30)
                                        .map(tool => (
                                            <div key={tool.name} className="border border-white/10 rounded-lg p-3 bg-white/5">
                                                <div className="flex items-center justify-between gap-3">
                                                    <p className="text-sm font-semibold text-blue-300 truncate">{tool.name}</p>
                                                    <span className={`px-2 py-0.5 text-[10px] font-black rounded-full uppercase tracking-widest ${tool.risk_level === 'EXTERNAL_WRITE'
                                                        ? 'bg-red-500/20 text-red-400'
                                                        : 'bg-yellow-500/20 text-yellow-400'
                                                        }`}>
                                                        {tool.risk_level.replace(/_/g, ' ')}
                                                    </span>
                                                </div>
                                                <p className="text-xs text-gray-400 mt-1">{tool.approved_at ? new Date(tool.approved_at).toLocaleString() : 'Sense data d\'aprovacio'}</p>
                                                <p className="text-xs text-gray-500 mt-1 line-clamp-2">{tool.description}</p>
                                            </div>
                                        ))}
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>

            {/* Agent Topology */}
            <div className="mt-20 relative z-10 pb-20">
                <header className="mb-8">
                    <h2 className="text-xl font-bold flex items-center gap-2">
                        <span className="w-1 h-6 bg-purple-500 rounded-full"></span>
                        Architecture Topology
                    </h2>
                    <p className="text-gray-500 text-sm">Visualització de la jerarquia d'agents i fluxos de dades.</p>
                </header>
                
                <div className="glass-panel p-12 rounded-[2rem] border border-white/5 flex justify-center items-center h-80 relative overflow-hidden bg-gradient-to-b from-transparent to-white/5">
                    <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 text-center group">
                        <div className="w-24 h-24 bg-blue-600 rounded-3xl flex items-center justify-center text-4xl mb-4 mx-auto border-4 border-blue-400/50 shadow-[0_0_50px_rgba(59,130,246,0.3)] group-hover:scale-110 transition-transform duration-500 rotate-12">
                            👔
                        </div>
                        <div className="text-white font-black tracking-widest uppercase text-xs">Supervisor</div>
                    </div>

                    <div className="absolute top-1/2 left-1/4 transform -translate-x-1/2 -translate-y-1/2 text-center opacity-40 hover:opacity-100 transition-opacity">
                        <div className="w-16 h-16 bg-green-600 rounded-2xl flex items-center justify-center text-2xl mb-2 mx-auto grayscale group-hover:grayscale-0">
                            👷
                        </div>
                        <div className="text-gray-500 text-[10px] font-bold uppercase tracking-widest">Coder</div>
                    </div>

                    <div className="absolute top-1/2 left-3/4 transform -translate-x-1/2 -translate-y-1/2 text-center opacity-40 hover:opacity-100 transition-opacity">
                        <div className="w-16 h-16 bg-purple-600 rounded-2xl flex items-center justify-center text-2xl mb-2 mx-auto grayscale group-hover:grayscale-0">
                            🧠
                        </div>
                        <div className="text-gray-500 text-[10px] font-bold uppercase tracking-widest">Brain</div>
                    </div>

                    <svg className="absolute inset-0 w-full h-full pointer-events-none opacity-20">
                        <defs>
                            <linearGradient id="lineGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                                <stop offset="0%" stopColor="#4B5563" />
                                <stop offset="50%" stopColor="#60A5FA" />
                                <stop offset="100%" stopColor="#4B5563" />
                            </linearGradient>
                        </defs>
                        <path d="M 25% 50% L 75% 50%" stroke="url(#lineGrad)" strokeWidth="1" strokeDasharray="10,10" className="animate-pulse" />
                    </svg>
                </div>
                <div className="mt-6 flex justify-center">
                    <span className="px-4 py-1.5 rounded-full bg-white/5 text-[10px] font-bold text-gray-500 tracking-[0.2em] uppercase border border-white/5">
                        Active Agent Highlighting coming in v2.0
                    </span>
                </div>
            </div>
        </div >
    );
}

export default Dashboard;

