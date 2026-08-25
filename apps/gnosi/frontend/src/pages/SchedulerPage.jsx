import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Clock, RefreshCw, AlertCircle, Edit2, Check, X } from 'lucide-react';
import { AppHeader } from '../components/AppHeader';

const formatInterval = (minutes) => {
    if (!minutes && minutes !== 0) return null;
    if (minutes < 1) {
        // Sub-minute: `minutes * 60` is SECONDS, not minutes (previously it was labeled
        // incorrectly as "min", so an interval of 0,5 min was displayed
        // as "30 min" instead of "30 s").
        return `${Math.round(minutes * 60)} s`;
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
    const { t } = useTranslation();
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
        <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[var(--bg-primary)] text-[var(--text-primary)]">
            <AppHeader
                icon={Clock}
                title={t('scheduler.title', 'Task scheduler')}
                subtitle={t('scheduler.subtitle', "Manage Gnosi's automations and background tasks.")}
            />
            <div className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
            <div className="mx-auto grid max-w-4xl grid-cols-1 gap-4">
                {loading ? (
                    <div className="gnosi-panel flex items-center justify-center gap-3 p-8 text-[var(--text-secondary)]" role="status" aria-live="polite">
                        <RefreshCw className="animate-spin" size={20} />
                        <span>{t('dashboard.loading_tasks', "Loading tasks...")}</span>
                    </div>
                ) : schedulers.length > 0 ? (
                    schedulers.map(task => {
                        const isEditing = task.name in editingInterval;
                        const intervalDisplay = formatInterval(task.interval_minutes);
                        return (
                            <div key={task.name} className="gnosi-panel group flex items-center justify-between gap-4 p-5 transition-all hover:border-[var(--gnosi-blue)]">
                                <div>
                                    <div className="flex items-center gap-3 mb-1">
                                        <h3 className="text-lg font-bold text-[var(--text-primary)] transition-colors group-hover:text-[var(--gnosi-blue)]">
                                            {task.name.replace(/_/g, ' ')}
                                        </h3>
                                        <span className={`px-2 py-0.5 rounded-full text-[10px] uppercase font-bold tracking-wider ${task.enabled ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
                                            {task.enabled ? t('dashboard.active', "Active") : t('dashboard.inactive', "Inactive")}
                                        </span>
                                    </div>
                                    <p className="max-w-xl text-sm text-[var(--text-secondary)]">{task.description}</p>
                                    {intervalDisplay && (
                                        <div className="mt-3 flex items-center gap-2 text-xs text-[var(--text-tertiary)]">
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
                                                        className="w-20 rounded border border-[var(--border-primary)] bg-[var(--bg-primary)] px-2 py-0.5 text-xs text-[var(--text-primary)] focus:border-[var(--gnosi-blue)] focus:outline-none"
                                                    />
                                                    <span className="text-[var(--text-secondary)]">h</span>
                                                    <button onClick={() => saveInterval(task)} className="text-green-400 hover:text-green-300 ml-1">
                                                        <Check size={12} />
                                                    </button>
                                                    <button onClick={() => cancelEditingInterval(task.name)} className="text-red-400 hover:text-red-300">
                                                        <X size={12} />
                                                    </button>
                                                </div>
                                            ) : (
                                                <div className="flex items-center gap-1">
                                                    <span>{t('scheduler.interval_label', 'Interval: {{value}}', { value: intervalDisplay })}</span>
                                                    <button
                                                        onClick={() => startEditingInterval(task)}
                                                        className="ml-1 text-[var(--text-secondary)] transition-opacity hover:text-[var(--gnosi-blue)] sm:opacity-0 sm:group-hover:opacity-100"
                                                        aria-label={t('common.edit', 'Edit')}
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
                                        <div className="peer h-6 w-11 rounded-full bg-[var(--border-primary)] peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-[var(--gnosi-blue)]/30 peer-checked:bg-[var(--gnosi-blue)] peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full after:absolute after:start-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all after:content-['']"></div>
                                    </label>
                                </div>
                            </div>
                        );
                    })
                ) : (
                    <div className="gnosi-panel p-12 text-center">
                        <AlertCircle className="mx-auto mb-4 text-[var(--text-tertiary)]" size={48} />
                        <p className="text-[var(--text-secondary)]">{t('scheduler.no_tasks', "No scheduled tasks found.")}</p>
                    </div>
                )}
            </div>
            </div>
        </div>
    );
};

export default SchedulerPage;
