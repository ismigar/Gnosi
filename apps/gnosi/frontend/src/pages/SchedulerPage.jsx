import React, { useState, useEffect } from 'react';
import { Clock, RefreshCw, AlertCircle } from 'lucide-react';

const SchedulerPage = () => {
    const [schedulers, setSchedulers] = useState([]);
    const [loading, setLoading] = useState(true);

    const loadSchedulers = async () => {
        setLoading(true);
        try {
            const res = await fetch('/api/schedulers');
            if (res.ok) {
                const data = await res.json();
                setSchedulers(data);
            }
        } catch (e) {
            console.error("Error loading schedulers", e);
        }
        setLoading(false);
    };

    useEffect(() => {
        loadSchedulers();
    }, []);

    const toggleTask = async (task) => {
        try {
            const res = await fetch(`/api/schedulers/${task.name}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...task, enabled: !task.enabled })
            });
            if (res.ok) {
                loadSchedulers();
            }
        } catch (e) {
            console.error("Error toggling task", e);
        }
    };

    return (
        <div className="p-8 bg-[#0a0a0c] min-h-screen text-white relative overflow-hidden">
            <div className="home-page__glow home-page__glow--1" style={{ opacity: 0.1 }} />
            <div className="home-page__glow home-page__glow--2" style={{ opacity: 0.1 }} />

            <header className="mb-12 relative z-10">
                <div className="flex items-center gap-3 mb-2">
                    <Clock className="text-blue-400" size={32} />
                    <h1 className="text-4xl font-extrabold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-white to-gray-500">
                        Task Scheduler
                    </h1>
                </div>
                <p className="text-gray-400">Gestiona les automatitzacions i tasques de fons de Gnosi.</p>
            </header>

            <div className="relative z-10 grid grid-cols-1 gap-6 max-w-4xl">
                {loading ? (
                    <div className="flex items-center gap-3 text-gray-400 p-8 glass-panel rounded-2xl justify-center">
                        <RefreshCw className="animate-spin" size={20} />
                        <span>Carregant tasques...</span>
                    </div>
                ) : schedulers.length > 0 ? (
                    schedulers.map(task => (
                        <div key={task.name} className="glass-panel p-6 rounded-2xl border border-white/5 flex justify-between items-center group hover:border-white/10 transition-all">
                            <div>
                                <div className="flex items-center gap-3 mb-1">
                                    <h3 className="text-lg font-bold text-white group-hover:text-blue-400 transition-colors">
                                        {task.name.replace(/_/g, ' ')}
                                    </h3>
                                    <span className={`px-2 py-0.5 rounded-full text-[10px] uppercase font-bold tracking-wider ${task.enabled ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
                                        {task.enabled ? 'Actiu' : 'Inactiu'}
                                    </span>
                                </div>
                                <p className="text-gray-400 text-sm max-w-xl">{task.description}</p>
                                {task.interval && (
                                    <div className="flex items-center gap-2 mt-3 text-xs text-gray-500">
                                        <Clock size={12} />
                                        <span>Interval: {task.interval}s</span>
                                    </div>
                                )}
                            </div>
                            
                            <div className="flex items-center gap-4">
                                <label className="relative inline-flex items-center cursor-pointer">
                                    <input 
                                        type="checkbox" 
                                        className="sr-only peer"
                                        checked={task.enabled}
                                        onChange={() => toggleTask(task)}
                                    />
                                    <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                                </label>
                            </div>
                        </div>
                    ))
                ) : (
                    <div className="text-center p-12 glass-panel rounded-2xl border border-white/5">
                        <AlertCircle className="mx-auto text-gray-600 mb-4" size={48} />
                        <p className="text-gray-400">No s'han trobat tasques programades.</p>
                    </div>
                )}
            </div>
        </div>
    );
};

export default SchedulerPage;
