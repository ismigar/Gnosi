import React, { useEffect, useState } from 'react';

function Dashboard() {
    const [stats, setStats] = useState({ cpu: 0, ram_percent: 0, memory_items: 0, status: 'offline' });
    const [pendingTools, setPendingTools] = useState([]);
    const [selectedTool, setSelectedTool] = useState(null);
    const [approving, setApproving] = useState(false);
    const [analytics, setAnalytics] = useState(null);

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

        fetchStats();
        fetchPendingTools();
        fetchAnalytics();
        const interval = setInterval(fetchStats, 2000);
        const toolsInterval = setInterval(fetchPendingTools, 5000);
        const analyticsInterval = setInterval(fetchAnalytics, 30000);
        return () => {
            clearInterval(interval);
            clearInterval(toolsInterval);
            clearInterval(analyticsInterval);
        };
    }, []);

    const handleApprove = async (name) => {
        setApproving(true);
        try {
            const res = await fetch('/api/tools/approve', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name })
            });
            if (res.ok) {
                setPendingTools(prev => prev.filter(t => t.name !== name));
                setSelectedTool(null);
            }
        } catch (e) {
            console.error("Error approving tool", e);
        }
        setApproving(false);
    };

    const handleReject = async (name, reason = '') => {
        setApproving(true);
        try {
            const res = await fetch('/api/tools/reject', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, reason })
            });
            if (res.ok) {
                setPendingTools(prev => prev.filter(t => t.name !== name));
                setSelectedTool(null);
            }
        } catch (e) {
            console.error("Error rejecting tool", e);
        }
        setApproving(false);
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

            {/* Pending Tools Section */}
            {pendingTools.length > 0 && (
                <div className="mt-16 relative z-10">
                    <h2 className="text-xl font-bold mb-6 flex items-center gap-2">
                        <span className="w-1 h-6 bg-red-500 rounded-full animate-pulse"></span>
                        Aprovació d'Eines
                    </h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                        {/* Tool List */}
                        <div className="glass-panel p-6 rounded-2xl border border-white/5">
                            <h3 className="text-gray-500 text-xs uppercase font-bold tracking-widest mb-6">Cua de Revisió</h3>
                            <div className="space-y-4">
                                {pendingTools.map(tool => (
                                    <div
                                        key={tool.name}
                                        onClick={() => setSelectedTool(tool)}
                                        className={`p-5 rounded-2xl cursor-pointer transition-all duration-300 border ${selectedTool?.name === tool.name
                                            ? 'bg-blue-500/10 border-blue-500/50 shadow-lg shadow-blue-500/10'
                                            : 'bg-white/5 border-transparent hover:bg-white/10'
                                            }`}
                                    >
                                        <div className="flex justify-between items-start mb-2">
                                            <span className="font-mono text-sm font-bold text-blue-400">{tool.name}</span>
                                            <span className={`px-2 py-0.5 text-[10px] font-black rounded-full uppercase tracking-widest ${tool.risk_level === 'EXTERNAL_WRITE'
                                                ? 'bg-red-500/20 text-red-400'
                                                : 'bg-yellow-500/20 text-yellow-400'
                                                }`}>
                                                {tool.risk_level.replace(/_/g, ' ')}
                                            </span>
                                        </div>
                                        <p className="text-gray-400 text-sm line-clamp-2 leading-relaxed">{tool.description}</p>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Tool Details */}
                        <div className="glass-panel p-8 rounded-2xl border border-white/5 overflow-hidden">
                            {selectedTool ? (
                                <div className="animate-in fade-in slide-in-from-right-4 duration-500">
                                    <h4 className="text-2xl font-mono font-bold text-white mb-4">{selectedTool.name}</h4>
                                    <p className="text-gray-400 mb-8 leading-relaxed">{selectedTool.description}</p>

                                    <div className="mb-8 group">
                                        <div className="flex items-center justify-between mb-2">
                                            <span className="text-gray-500 text-xs font-bold uppercase tracking-widest">Codi Font</span>
                                            <span className="text-blue-500 text-[10px] font-bold">PYTHON SCRIPT</span>
                                        </div>
                                        <div className="relative">
                                            <div className="absolute inset-0 bg-blue-500/5 blur-2xl rounded-full opacity-0 group-hover:opacity-100 transition-opacity" />
                                            <pre className="relative p-6 bg-black/40 rounded-2xl overflow-x-auto text-sm text-blue-300 font-mono border border-white/5 max-h-[300px] scrollbar-thin scrollbar-thumb-white/10">
                                                <code>{selectedTool.code}</code>
                                            </pre>
                                        </div>
                                    </div>

                                    <div className="flex gap-4">
                                        <button
                                            onClick={() => handleApprove(selectedTool.name)}
                                            disabled={approving}
                                            className="flex-1 bg-white text-black hover:bg-gray-200 disabled:bg-gray-800 disabled:text-gray-500 py-4 px-6 rounded-2xl font-black transition-all transform active:scale-95 shadow-xl shadow-white/5"
                                        >
                                            APROVAR
                                        </button>
                                        <button
                                            onClick={() => handleReject(selectedTool.name, "Rebutjat per l'usuari")}
                                            disabled={approving}
                                            className="flex-1 bg-red-600/10 text-red-500 hover:bg-red-600 hover:text-white border border-red-500/20 disabled:border-transparent py-4 px-6 rounded-2xl font-black transition-all transform active:scale-95"
                                        >
                                            REBUTJAR
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <div className="h-full flex flex-col items-center justify-center text-center p-12">
                                    <div className="w-16 h-16 bg-white/5 rounded-full flex items-center justify-center mb-4 text-gray-600">
                                        <Gauge size={32} />
                                    </div>
                                    <p className="text-gray-500 font-medium">Selecciona una eina per validar el seu codi i autoritzar l'execució.</p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )
            }

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

