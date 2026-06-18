import React, { useState, useEffect } from 'react';
import { Clock, RefreshCw, AlertCircle, Edit2, Check, X } from 'lucide-react';

const formatInterval = (minutes) => {
    if (!minutes && minutes !== 0) return null;
    if (minutes < 1) {
        return `${Math.round(minutes * 60)} min`;
    }
    const hours = minutes / 60;
    if (Number.isInteger(hours) || Math.abs(hours - Math.round(hours * 4) / 4) < 0.001) {
        const rounded = Math.round(hours * 4) / 4;
        if (rounded === 1) return '1 h';
        return `${rounded} h`;
    }
    return `${minutes} min`;
};

const minutesToHours = (minutes) => {
    if (!minutes && minutes !== 0) return '';
    const val = minutes / 60;
    return parseFloat(val.toFixed(4)).toString();
};

const hoursToMinutes = (hours) => {
    const parsed = parseFloat(hours);
    if (isNaN(parsed) || parsed <= 0) return null;
    return parseFloat((parsed * 60).toFixed(4));
};

const SchedulerPage = () => {
    const [schedulers, setSchedulers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [editingInterval, setEditingInterval] = useState({});

    const loadSchedulers = async (silent = false) => {
        if (!silent) setLoading(true);
        try {
            const res = await fetch('/api/schedulers');
            if (res.ok) {
                const data = await res.json();
                setSchedulers(data);
            }
        } catch (e) {
            console.error("Error loading schedulers", e);
        }
        if (!silent) setLoading(false);
    };

    useEffect(() => {
        loadSchedulers();
    }, []);

    const toggleTask = async (task) => {
        try {
            const res = await fetch(`/api/schedulers/${task.name}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ interval_minutes: task.interval_minutes, enabled: !task.enabled })
            });
            if (res.ok) loadSchedulers(true);
        } catch (e) {
            console.error("Error toggling task", e);
        }
    };

    const startEditingInterval = (task) => {
        setEditingInterval(prev => ({
            ...prev,
            [task.name]: minutesToHours(task.interval_minutes)
        }));
    };

    const cancelEditingInterval = (taskName) => {
        setEditingInterval(prev => {
            const next = { ...prev };
            delete next[taskName];
            return next;
        });
    };

    const saveInterval = async (task) => {
        const newMinutes = hoursToMinutes(editingInterval[task.name]);
        if (newMinutes === null) return;
        try {
            const res = await fetch(`/api/schedulers/${task.name}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ interval_minutes: newMinutes, enabled: task.enabled })
            });
            if (res.ok) {
                cancelEditingInterval(task.name);
                loadSchedulers(true);
            }
        } catch (e) {
            console.error("Error saving interval", e);
        }
    };

    const handleIntervalKeyDown = (e, task) => {
        if (e.key === 'Enter') saveInterval(task);
        if (e.key === 'Escape') cancelEditingInterval(task.name);
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
                    schedulers.map(task => {
                        const isEditing = task.name in editingInterval;
                        const intervalDisplay = formatInterval(task.interval_minutes);
                        return (
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
                                    {intervalDisplay && (
                                        <div className="flex items-center gap-2 mt-3 text-xs text-gray-500">
                                            <Clock size={12} />
                                            {isEditing ? (
                                                <div className="flex items-center gap-1">
                                                    <input
                                                        type="number"
                                                        min="0.0167"
                                                        step="0.25"
                                                        value={editingInterval[task.name]}
                                                        onChange={e => setEditingInterval(prev => ({ ...prev, [task.name]: e.target.value }))}
                                                        onKeyDown={e => handleIntervalKeyDown(e, task)}
                                                        autoFocus
                                                        className="w-20 bg-white/5 border border-white/20 rounded px-2 py-0.5 text-white text-xs focus:outline-none focus:border-blue-500"
                                                    />
                                                    <span className="text-gray-400">h</span>
                                                    <button onClick={() => saveInterval(task)} className="text-green-400 hover:text-green-300 ml-1">
                                                        <Check size={12} />
                                                    </button>
                                                    <button onClick={() => cancelEditingInterval(task.name)} className="text-red-400 hover:text-red-300">
                                                        <X size={12} />
                                                    </button>
                                                </div>
                                            ) : (
                                                <div className="flex items-center gap-1">
                                                    <span>Interval: {intervalDisplay}</span>
                                                    <button
                                                        onClick={() => startEditingInterval(task)}
                                                        className="opacity-0 group-hover:opacity-100 transition-opacity text-gray-400 hover:text-blue-400 ml-1"
                                                    >
                                                        <Edit2 size={11} />
                                                    </button>
                                                </div>
                                            )}
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
                        );
                    })
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
