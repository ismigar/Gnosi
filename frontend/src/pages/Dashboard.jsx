import React, { useEffect, useState, useCallback } from 'react';
import { Clock3, History, Play, RefreshCw, Users, Shield, Save, Gauge } from 'lucide-react';
import { AppHeader } from '../components/AppHeader';
import { useApi } from '../hooks/use-api';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../hooks/useTheme';

function Dashboard() {
    const { role: initialRole, apiFetch } = useApi();
    const { t } = useTranslation();
    const { isDark } = useTheme();
    const [userRole, setUserRole] = useState(initialRole);
    const isAdmin = userRole === 'admin' || userRole === 'owner';
    
    const [stats, setStats] = useState({ cpu: 0, ram_percent: 0, memory_items: 0, status: 'offline' });
    const [pendingTools, setPendingTools] = useState([]);
    const [approvedTools, setApprovedTools] = useState([]);
    const [approvedLoading, setApprovedLoading] = useState(true);
    const [analytics, setAnalytics] = useState(null);
    const [schedulers, setSchedulers] = useState([]);
    const [schedulerLoading, setSchedulerLoading] = useState(true);
    const [selectedControlTab, setSelectedControlTab] = useState('schedulers');
    
    // Admin state
    const [members, setMembers] = useState([]);
    const [membersLoading, setMembersLoading] = useState(false);
    const [isAddMemberModalOpen, setIsAddMemberModalOpen] = useState(false);
    const [isPermissionsModalOpen, setIsPermissionsModalOpen] = useState(false);

    // Role mapping to capabilities (Presets)
    const ROLE_CAPABILITIES = {
        viewer: ['read'],
        editor: ['read', 'write'],
        admin: ['read', 'write', 'delete', 'admin', 'analytics', 'tools'],
        owner: ['read', 'write', 'delete', 'admin', 'analytics', 'tools']
    };
    const [selectedMember, setSelectedMember] = useState(null);
    const [newMemberEmail, setNewMemberEmail] = useState('');
    const [newMemberRole, setNewMemberRole] = useState('viewer');
    const [allVaults, setAllVaults] = useState([]);
    const [memberVaultAccess, setMemberVaultAccess] = useState([]);
    const [vaultAccessLoading, setVaultAccessLoading] = useState(false);
    
    // Suprimir advertència d'unused variable si realment no s'usa
    // setUpdatingUserId(null); 

    const activeWorkspaceId = localStorage.getItem('gnosi_workspace_id') || 'personal';

    const [gnosiMode, setGnosiMode] = useState('personal');

    const fetchStats = async () => {
        try {
            const data = await apiFetch('/api/system/stats');
            setStats(data);
        } catch (e) {
            console.error("Error fetching stats", e);
        }
    };

    const fetchConfig = async () => {
        try {
            const config = await apiFetch('/api/config');
            if (config.settings && config.settings.gnosi_mode) {
                setGnosiMode(config.settings.gnosi_mode);
            }
        } catch (e) {
            console.error("Error fetching config", e);
        }
    };

    const fetchPendingTools = async () => {
        try {
            const data = await apiFetch('/api/tools/pending');
            setPendingTools(data);
        } catch (e) {
            console.error("Error fetching pending tools", e);
        }
    };

    const fetchAnalytics = async () => {
        try {
            const data = await apiFetch('/api/analytics');
            setAnalytics(data);
        } catch (e) {
            console.error("Error fetching analytics", e);
        }
    };

    const fetchSchedulers = useCallback(async (silent = false) => {
        if (!silent) setSchedulerLoading(true);
        try {
            const data = await apiFetch('/api/schedulers');
            setSchedulers(Array.isArray(data) ? data : []);
        } catch (e) {
            console.error("Error fetching schedulers", e);
        } finally {
            if (!silent) setSchedulerLoading(false);
        }
    }, [apiFetch]);

    const fetchApprovedTools = async () => {
        setApprovedLoading(true);
        try {
            const data = await apiFetch('/api/tools/approved');
            setApprovedTools(Array.isArray(data) ? data : []);
        } catch (e) {
            console.error("Error fetching approved tools", e);
        } finally {
            setApprovedLoading(false);
        }
    };

    const handleGlobalRefresh = async () => {
        // Run all fetches in parallel
        await Promise.all([
            fetchStats(),
            fetchAnalytics(),
            fetchSchedulers(false),
            fetchApprovedTools(),
            fetchPendingTools()
        ]);
    };

    useEffect(() => {
        const fetchCurrentRole = async () => {
            try {
                const workspaces = await apiFetch('/api/workspaces');
                const current = workspaces.find(w => w.id === activeWorkspaceId) || workspaces[0];
                if (current && current.role) {
                    localStorage.setItem('gnosi_role', current.role);
                    setUserRole(current.role);
                }
            } catch (e) {
                console.error("Error updating role context", e);
            }
        };

        fetchStats();
        fetchConfig();
        fetchPendingTools();
        fetchAnalytics();
        fetchSchedulers();
        fetchApprovedTools();
        fetchCurrentRole();
        const interval = setInterval(fetchStats, 2000);
        const toolsInterval = setInterval(fetchPendingTools, 5000);
        const analyticsInterval = setInterval(fetchAnalytics, 30000);
        const schedulersInterval = setInterval(() => fetchSchedulers(true), 30000);
        const approvedToolsInterval = setInterval(fetchApprovedTools, 30000);
        return () => {
            clearInterval(interval);
            clearInterval(toolsInterval);
            clearInterval(analyticsInterval);
            clearInterval(schedulersInterval);
            clearInterval(approvedToolsInterval);
        };
    }, [fetchSchedulers]); // eslint-disable-line react-hooks/exhaustive-deps



    const fetchMembers = useCallback(async () => {
        setMembersLoading(true);
        try {
            const res = await apiFetch(`/api/workspaces/${activeWorkspaceId}/members`);
            setMembers(res);
        } catch (e) {
            console.error("Error fetching members", e);
        } finally {
            setMembersLoading(false);
        }
    }, [activeWorkspaceId, apiFetch]);

    const handleAddMember = async () => {
        if (!newMemberEmail) return;
        try {
            await apiFetch(`/api/workspaces/${activeWorkspaceId}/members`, {
                method: 'POST',
                body: JSON.stringify({ email: newMemberEmail, role: newMemberRole })
            });
            setIsAddMemberModalOpen(false);
            setNewMemberEmail('');
            fetchMembers();
        } catch (e) {
            console.error("Error adding member", e);
        }
    };

    const handleDeleteMember = async (userId) => {
        if (!confirm(t('dashboard.confirm_delete_member'))) return;
        try {
            await apiFetch(`/api/workspaces/${activeWorkspaceId}/members/${userId}`, {
                method: 'DELETE'
            });
            fetchMembers();
        } catch (e) {
            console.error("Error deleting member", e);
        }
    };

    const handleUpdatePermissions = async (userId, permissions, role) => {
        try {
            await apiFetch(`/api/workspaces/${activeWorkspaceId}/members/${userId}/role`, {
                method: 'PUT',
                body: JSON.stringify({ permissions, role })
            });
            fetchMembers();
            setIsPermissionsModalOpen(false);
        } catch (e) {
            console.error("Error updating permissions", e);
        }
    };

    const fetchVaults = useCallback(async () => {
        try {
            const res = await apiFetch(`/api/workspaces/${activeWorkspaceId}/vaults`);
            setAllVaults(res);
        } catch (e) {
            console.error("Error fetching vaults", e);
        }
    }, [activeWorkspaceId, apiFetch]);

    const fetchMemberVaultAccess = useCallback(async (userId) => {
        setVaultAccessLoading(true);
        try {
            const res = await apiFetch(`/api/workspaces/${activeWorkspaceId}/members/${userId}/vaults`);
            setMemberVaultAccess(res);
        } catch (e) {
            console.error("Error fetching member vault access", e);
        } finally {
            setVaultAccessLoading(false);
        }
    }, [activeWorkspaceId, apiFetch]);

    const toggleVaultAccess = async (userId, vaultId) => {
        const hasAccess = memberVaultAccess.some(a => a.vault_id === vaultId);
        try {
            if (hasAccess) {
                await apiFetch(`/api/workspaces/${activeWorkspaceId}/members/${userId}/vaults/${vaultId}`, {
                    method: 'DELETE'
                });
            } else {
                await apiFetch(`/api/workspaces/${activeWorkspaceId}/members/${userId}/vaults`, {
                    method: 'POST',
                    body: JSON.stringify({ vault_id: vaultId, permissions: { capabilities: ["read"] } })
                });
            }
            fetchMemberVaultAccess(userId);
        } catch (e) {
            console.error("Error toggling vault access", e);
        }
    };

    useEffect(() => {
        if (selectedControlTab === 'admin' && isAdmin) {
            fetchMembers();
            fetchVaults();
        }
    }, [selectedControlTab, isAdmin, fetchMembers, fetchVaults]);

    useEffect(() => {
        if (isPermissionsModalOpen && selectedMember) {
            fetchMemberVaultAccess(selectedMember.user_id);
        }
    }, [isPermissionsModalOpen, selectedMember, fetchMemberVaultAccess]);

    const updateMemberRole = async (userId, newRole) => {
        try {
            await apiFetch(`/api/workspaces/${activeWorkspaceId}/members/${userId}/role`, {
                method: 'PUT',
                body: JSON.stringify({ role: newRole, permissions: ROLE_CAPABILITIES[newRole] })
            });
            fetchMembers();
        } catch (e) {
            console.error("Error updating role", e);
        }
    };

    const refreshSchedulers = async (silent = false) => {
        if (!silent) setSchedulerLoading(true);
        try {
            const data = await apiFetch('/api/schedulers');
            setSchedulers(Array.isArray(data) ? data : []);
        } catch (e) {
            console.error("Error refreshing schedulers", e);
        } finally {
            if (!silent) setSchedulerLoading(false);
        }
    };

    const updateScheduler = async (task, overrides) => {
        try {
            const payload = { ...task, ...overrides };
            await apiFetch(`/api/schedulers/${task.name}`, {
                method: 'PUT',
                body: JSON.stringify(payload)
            });
            refreshSchedulers(true);
        } catch (e) {
            console.error("Error updating scheduler", e);
        }
    };

    const runSchedulerNow = async (taskName) => {
        try {
            await fetch(`/api/schedulers/${taskName}/run`, { method: 'POST' });
            await refreshSchedulers(true);
        } catch (e) {
            console.error("Error running scheduler", e);
        }
    };

    const formatFrequency = (task) => {
        if (typeof task.interval_minutes === 'number' && task.interval_minutes > 0) {
            if (task.interval_minutes % 1440 === 0) {
                return t('dashboard.frequency_days', { count: task.interval_minutes / 1440 });
            }
            if (task.interval_minutes % 60 === 0) {
                return t('dashboard.frequency_hours', { count: task.interval_minutes / 60 });
            }
            return t('dashboard.frequency_minutes', { count: task.interval_minutes });
        }
        if (typeof task.interval === 'number' && task.interval > 0) {
            return t('dashboard.frequency_seconds', { count: task.interval });
        }
        return t('dashboard.frequency_none');
    };

    return (
        <div className="h-full bg-[var(--bg-primary)] overflow-hidden flex flex-col">
            <AppHeader icon={Gauge} title="Control Center">
                <div className="flex items-center gap-2">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-secondary)] bg-[var(--bg-tertiary)] px-2 py-1 rounded-md border border-[var(--border-primary)]">
                        v1.2.4
                    </span>
                </div>
            </AppHeader>

            <div className="flex-1 overflow-y-auto">
                <div className="home-page animate-in fade-in duration-700 !text-left !items-start" style={{ minHeight: 'unset', paddingTop: '2rem' }}>
                    {/* Glow Backgrounds - More subtle in light mode */}
                    <div className={`home-page__glow home-page__glow--1 ${isDark ? 'opacity-20' : 'opacity-10 opacity-60 grayscale'}`}></div>
                    <div className={`home-page__glow home-page__glow--2 ${isDark ? 'opacity-20' : 'opacity-10 opacity-60 grayscale'}`}></div>

                    <div className="w-full">
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-12">
                {/* Status Card */}
                <div className="glass-panel p-6 rounded-2xl border border-[var(--border-primary)] hover:border-blue-500/20 transition-all group">
                    <h3 className="text-[var(--text-secondary)] text-xs uppercase font-bold tracking-widest mb-4">{t('dashboard.status_title')}</h3>
                    <div className="flex items-center">
                        <div className={`w-3 h-3 rounded-full mr-3 animate-pulse ${stats.status === 'online' ? 'bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.5)]' : 'bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.5)]'}`}></div>
                        <span className="text-2xl font-bold capitalize tracking-tight group-hover:text-blue-400 transition-colors">{stats.status}</span>
                    </div>
                </div>

                {/* Memory Card */}
                <div className="glass-panel p-6 rounded-2xl border border-[var(--border-primary)] hover:border-blue-500/20 transition-all group">
                    <h3 className="text-[var(--text-secondary)] text-xs uppercase font-bold tracking-widest mb-4">{t('dashboard.memory_title')}</h3>
                    <div className="flex items-baseline gap-2">
                        <span className="text-4xl font-black text-blue-400 tracking-tighter group-hover:scale-110 transition-transform origin-left duration-300">{stats.memory_items}</span>
                        <span className="text-gray-500 text-sm font-medium">{t('dashboard.memories_stored')}</span>
                    </div>
                </div>

                {/* CPU Card */}
                <div className="glass-panel p-6 rounded-2xl border border-[var(--border-primary)] hover:border-blue-500/20 transition-all">
                    <h3 className="text-[var(--text-secondary)] text-xs uppercase font-bold tracking-widest mb-4">{t('dashboard.cpu_usage')}</h3>
                    <div className="mt-2">
                        <span className="text-4xl font-black text-purple-400 tracking-tighter">{stats.cpu}%</span>
                    </div>
                    <div className="w-full bg-[var(--bg-tertiary)] h-1.5 mt-4 rounded-full overflow-hidden">
                        <div className="bg-gradient-to-r from-purple-600 to-purple-400 h-full transition-all duration-1000" style={{ width: `${stats.cpu}%` }}></div>
                    </div>
                </div>

                {/* RAM Card */}
                <div className="glass-panel p-6 rounded-2xl border border-[var(--border-primary)] hover:border-blue-500/20 transition-all">
                    <h3 className="text-[var(--text-secondary)] text-xs uppercase font-bold tracking-widest mb-4">{t('dashboard.ram_usage')}</h3>
                    <div className="mt-2">
                        <span className="text-4xl font-black text-pink-400 tracking-tighter">{stats.ram_percent}%</span>
                    </div>
                    <div className="w-full bg-[var(--bg-tertiary)] h-1.5 mt-4 rounded-full overflow-hidden">
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
                        <div 
                            onClick={() => setSelectedControlTab('history')}
                            className="glass-panel p-6 rounded-2xl border border-[var(--border-primary)] hover:border-blue-500/40 hover:bg-blue-500/5 transition-all group cursor-pointer"
                        >
                            <h3 className="text-gray-500 text-xs uppercase font-bold tracking-widest mb-4 flex justify-between items-center">
                                {t('dashboard.tools_title')}
                                <span className="text-[10px] text-blue-500 group-hover:underline">Veure detalls →</span>
                            </h3>
                            <div className="text-4xl font-black text-green-400 tracking-tighter group-hover:scale-105 transition-transform origin-left">{analytics.tools?.total_tools || 0}</div>
                            <div className="mt-4 flex gap-3 text-[10px] items-center">
                                <span className="bg-green-500/10 text-green-500 px-2 py-0.5 rounded-full font-bold">{analytics.tools?.approved || 0} {t('dashboard.approved')}</span>
                                <span className="bg-yellow-500/10 text-yellow-500 px-2 py-0.5 rounded-full font-bold">{analytics.tools?.pending || 0} {t('dashboard.pending')}</span>
                            </div>
                        </div>

                        {/* Errors Prevented */}
                        <div 
                            onClick={() => setSelectedControlTab('history')}
                            className="glass-panel p-6 rounded-2xl border border-[var(--border-primary)] hover:border-red-500/40 hover:bg-red-500/5 transition-all group cursor-pointer"
                        >
                            <h3 className="text-gray-500 text-xs uppercase font-bold tracking-widest mb-4 flex justify-between items-center">
                                {t('dashboard.errors_prevented_title')}
                                <span className="text-[10px] text-red-500 group-hover:underline">Resum →</span>
                            </h3>
                            <div className="text-4xl font-black text-red-400 tracking-tighter group-hover:scale-105 transition-transform origin-left">{analytics.errors_prevented || 0}</div>
                            <div className="mt-4 text-[10px] font-bold text-gray-500 uppercase tracking-widest">{t('dashboard.documented_pitfalls')}</div>
                        </div>

                        {/* Directives */}
                        <div 
                            className="glass-panel p-6 rounded-2xl border border-[var(--border-primary)] hover:border-cyan-500/20 transition-all opacity-80"
                        >
                            <h3 className="text-gray-500 text-xs uppercase font-bold tracking-widest mb-4">{t('dashboard.directives')}</h3>
                            <div className="text-4xl font-black text-cyan-400 tracking-tighter">{analytics.directives?.total || 0}</div>
                            <div className="mt-4 text-[10px] font-bold text-gray-500 uppercase tracking-widest text-cyan-500/60">Gestionat al Vault</div>
                        </div>

                        {/* Recent Activity */}
                        <div className="glass-panel p-6 rounded-2xl border border-[var(--border-primary)] hover:border-blue-500/20 transition-all">
                            <h3 className="text-gray-500 text-xs uppercase font-bold tracking-widest mb-4">{t('dashboard.last_7_days')}</h3>
                            <div className="text-4xl font-black text-orange-400 tracking-tighter">{analytics.tools?.created_last_7_days || 0}</div>
                            <div className="mt-4 text-[10px] font-bold text-gray-500 uppercase tracking-widest">{t('dashboard.new_tools')}</div>
                        </div>
                    </div>
                </div>
            )}

            {/* Control Center Tabs */}
            <div className="mt-16">
                <div className="flex items-center gap-3 mb-6">
                    <button
                        onClick={() => setSelectedControlTab('schedulers')}
                        className={`px-4 py-2 rounded-xl text-sm font-semibold border transition-all ${selectedControlTab === 'schedulers'
                            ? 'bg-blue-600 border-blue-500 text-white shadow-lg shadow-blue-500/20'
                            : 'bg-[var(--bg-tertiary)] border-[var(--border-primary)] text-[var(--text-secondary)] hover:bg-[var(--bg-primary)]'
                            }`}
                    >
                        <span className="inline-flex items-center gap-2">
                            <Clock3 size={16} />
                            {t('dashboard.tab_schedulers')}
                        </span>
                    </button>
                    <button
                        onClick={() => setSelectedControlTab('history')}
                        className={`px-4 py-2 rounded-xl text-sm font-semibold border transition-all ${selectedControlTab === 'history'
                            ? 'bg-blue-600 border-blue-500 text-white shadow-lg shadow-blue-500/20'
                            : 'bg-[var(--bg-tertiary)] border-[var(--border-primary)] text-[var(--text-secondary)] hover:bg-[var(--bg-primary)]'
                            }`}
                    >
                        <span className="inline-flex items-center gap-2">
                            <History size={16} />
                            {t('dashboard.tab_history')}
                        </span>
                    </button>
                    {isAdmin && gnosiMode === 'org' && (
                        <button
                            onClick={() => setSelectedControlTab('admin')}
                            className={`px-4 py-2 rounded-xl text-sm font-semibold border transition-all ${selectedControlTab === 'admin'
                                ? 'bg-purple-600 border-purple-500 text-white shadow-lg shadow-purple-500/20'
                                : 'bg-[var(--bg-tertiary)] border-[var(--border-primary)] text-[var(--text-secondary)] hover:bg-[var(--bg-primary)]'
                                }`}
                        >
                            <span className="inline-flex items-center gap-2">
                                <Users size={16} />
                                {t('dashboard.tab_admin')}
                            </span>
                        </button>
                    )}
                </div>

                {selectedControlTab === 'schedulers' && (
                    <div className="glass-panel p-6 rounded-2xl border border-[var(--border-primary)]">
                        <div className="flex items-center justify-between mb-6">
                            <h2 className="text-xl font-bold flex items-center gap-2">
                                <span className="w-1 h-6 bg-blue-500 rounded-full"></span>
                                {t('dashboard.tab_schedulers')}
                            </h2>
                            <button
                                onClick={handleGlobalRefresh}
                                className="inline-flex items-center gap-2 text-xs font-semibold px-3 py-2 rounded-lg border border-blue-500/30 bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 transition-all hover:scale-105"
                            >
                                <RefreshCw size={14} />
                                {t('common.refresh', 'Refresh All')}
                            </button>
                        </div>

                        {schedulerLoading ? (
                            <p className="text-gray-400">{t('dashboard.loading_tasks')}</p>
                        ) : schedulers.length === 0 ? (
                            <p className="text-gray-500">{t('dashboard.no_tasks')}</p>
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
                                                    {t('dashboard.last_run')}: {new Date(task.last_run).toLocaleString()}
                                                </p>
                                            )}
                                        </div>

                                        <div className="mt-4 flex flex-wrap items-center gap-3">
                                            <div className="flex items-center gap-3">
                                                <label className="relative inline-flex items-center cursor-pointer">
                                                    <input 
                                                        type="checkbox" 
                                                        className="sr-only peer"
                                                        checked={task.enabled}
                                                        onChange={(e) => updateScheduler(task, { enabled: e.target.checked })}
                                                    />
                                                    <div className="w-10 h-5 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-5 peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></div>
                                                </label>
                                                <span className={`text-[10px] font-bold uppercase tracking-widest ${task.enabled ? 'text-green-400' : 'text-gray-500'}`}>
                                                    {task.enabled ? t('dashboard.active') : t('dashboard.inactive')}
                                                </span>
                                            </div>

                                            {typeof task.interval_minutes === 'number' && (
                                                <select
                                                    className="text-xs bg-black/30 border border-white/10 rounded-lg px-2 py-1"
                                                    value={task.interval_minutes}
                                                    onChange={(e) => updateScheduler(task, { interval_minutes: Number(e.target.value) })}
                                                >
                                                    <option value={60}>{t('dashboard.time_1_hour')}</option>
                                                    <option value={120}>{t('dashboard.time_2_hours')}</option>
                                                    <option value={180}>{t('dashboard.time_3_hours')}</option>
                                                    <option value={360}>{t('dashboard.time_6_hours')}</option>
                                                    <option value={720}>{t('dashboard.time_12_hours')}</option>
                                                    <option value={1440}>{t('dashboard.time_1_day')}</option>
                                                    <option value={10080}>{t('dashboard.time_1_week')}</option>
                                                </select>
                                            )}

                                            <button
                                                onClick={() => runSchedulerNow(task.name)}
                                                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-xs font-semibold"
                                            >
                                                <Play size={12} />
                                                {t('dashboard.run_now')}
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
                        <div className="glass-panel p-6 rounded-2xl border border-[var(--border-primary)]">
                            <h3 className="text-gray-500 text-xs uppercase font-bold tracking-widest mb-4">{t('dashboard.activity_summary')}</h3>
                            <div className="space-y-3 text-sm">
                                <div className="flex items-center justify-between border border-[var(--border-primary)] rounded-lg p-3 bg-[var(--bg-tertiary)]">
                                    <p className="text-gray-400">{t('dashboard.errors_prevented_sops')}</p>
                                    <p className="font-bold text-red-400">{analytics.errors_prevented || 0}</p>
                                </div>
                                <div className="flex items-center justify-between border border-[var(--border-primary)] rounded-lg p-3 bg-[var(--bg-tertiary)]">
                                    <p className="text-gray-400">{t('dashboard.active_processes')}</p>
                                    <p className="font-bold text-blue-400">{schedulers.filter(s => s.status === 'active').length}</p>
                                </div>
                                <div className="flex items-center justify-between border border-[var(--border-primary)] rounded-lg p-3 bg-[var(--bg-tertiary)]">
                                    <p className="text-gray-400">{t('dashboard.total_memories')}</p>
                                    <p className="font-bold text-cyan-400">{stats.memory_items}</p>
                                </div>
                                <div className="flex items-center justify-between border border-[var(--border-primary)] rounded-lg p-3 bg-[var(--bg-tertiary)]">
                                    <span className="text-gray-300">{t('dashboard.tools_pending_approval')}</span>
                                    <span className="font-bold text-yellow-300">{pendingTools.length}</span>
                                </div>
                                <div className="flex items-center justify-between border border-[var(--border-primary)] rounded-lg p-3 bg-[var(--bg-tertiary)]">
                                    <span className="text-gray-300">{t('dashboard.total_approved_tools')}</span>
                                    <span className="font-bold text-green-300">{analytics?.tools?.approved ?? 0}</span>
                                </div>
                            </div>

                            <h4 className="text-gray-500 text-xs uppercase font-bold tracking-widest mt-7 mb-4">{t('dashboard.latest_scheduled_runs')}</h4>
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
                                    <p className="text-sm text-gray-500">{t('dashboard.no_runs_recorded')}</p>
                                )}
                            </div>
                        </div>

                        <div className="glass-panel p-6 rounded-2xl border border-[var(--border-primary)]">
                            <h3 className="text-gray-500 text-xs uppercase font-bold tracking-widest mb-4">{t('dashboard.approved_tools_history')}</h3>
                            {approvedLoading ? (
                                <p className="text-gray-400">{t('dashboard.loading_history')}</p>
                            ) : approvedTools.length === 0 ? (
                                <p className="text-gray-500">{t('dashboard.no_approved_tools')}</p>
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
                                            <div key={tool.name} className="border border-[var(--border-primary)] rounded-lg p-3 bg-[var(--bg-tertiary)]">
                                                <div className="flex items-center justify-between gap-3">
                                                    <p className="text-sm font-semibold text-blue-300 truncate">{tool.name}</p>
                                                    <span className={`px-2 py-0.5 text-[10px] font-black rounded-full uppercase tracking-widest ${tool.risk_level === 'EXTERNAL_WRITE'
                                                        ? 'bg-red-500/20 text-red-400'
                                                        : 'bg-yellow-500/20 text-yellow-400'
                                                        }`}>
                                                        {tool.risk_level.replace(/_/g, ' ')}
                                                    </span>
                                                </div>
                                                <p className="text-xs text-gray-400 mt-1">{tool.approved_at ? new Date(tool.approved_at).toLocaleString() : t('dashboard.no_approval_date')}</p>
                                                <p className="text-xs text-gray-500 mt-1 line-clamp-2">{tool.description}</p>
                                            </div>
                                        ))}
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {selectedControlTab === 'admin' && isAdmin && gnosiMode === 'org' && (
                    <div className="glass-panel p-6 rounded-2xl border border-[var(--border-primary)]">
                        <div className="flex items-center justify-between mb-6">
                            <div>
                                <h3 className="text-xl font-bold text-[var(--text-primary)] mb-2">{t('dashboard.workspace_members')}</h3>
                                <p className="text-[var(--text-secondary)] text-sm">{t('dashboard.manage_access_desc')}</p>
                            </div>
                            <button 
                                onClick={() => setIsAddMemberModalOpen(true)}
                                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg flex items-center gap-2 transition-colors font-medium shadow-lg shadow-blue-900/20"
                            >
                                <i className="pi pi-user-plus text-sm"></i>
                                {t('dashboard.add_member')}
                            </button>
                        </div>

                        <div className="bg-[var(--bg-secondary)] rounded-xl border border-[var(--border-primary)] overflow-hidden shadow-2xl">
                            <table className="w-full text-left">
                                <thead>
                                    <tr className="border-b border-[var(--border-primary)] bg-[var(--bg-tertiary)]">
                                        <th className="px-6 py-4 text-xs font-bold text-gray-400 uppercase tracking-wider">{t('dashboard.user')}</th>
                                        <th className="px-6 py-4 text-xs font-bold text-gray-400 uppercase tracking-wider">{t('dashboard.email')}</th>
                                        <th className="px-6 py-4 text-xs font-bold text-gray-400 uppercase tracking-wider">{t('dashboard.join_date')}</th>
                                        <th className="px-6 py-4 text-xs font-bold text-gray-400 uppercase tracking-wider">{t('dashboard.current_role')}</th>
                                        <th className="px-6 py-4 text-xs font-bold text-gray-400 uppercase tracking-wider text-right">{t('dashboard.actions')}</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-[var(--border-primary)]">
                                    {membersLoading ? (
                                        <tr>
                                            <td colSpan="5" className="px-6 py-12 text-center text-gray-500">
                                                <i className="pi pi-spin pi-spinner text-2xl mb-4 block"></i>
                                                {t('dashboard.loading_members')}
                                            </td>
                                        </tr>
                                    ) : members.length === 0 ? (
                                        <tr>
                                            <td colSpan="5" className="px-6 py-12 text-center text-gray-500 italic">{t('dashboard.no_members')}</td>
                                        </tr>
                                    ) : members.map(m => (
                                        <tr key={m.user_id} className="hover:bg-[var(--bg-tertiary)] transition-colors group">
                                            <td className="px-6 py-4 flex items-center gap-3">
                                                <div className="w-8 h-8 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center font-bold text-xs ring-1 ring-blue-500/30">
                                                    {m.name?.[0]?.toUpperCase() || 'U'}
                                                </div>
                                                <span className="text-[var(--text-primary)] font-medium">{m.name || t('dashboard.unnamed_user')}</span>
                                            </td>
                                            <td className="px-6 py-4 text-gray-300 text-sm font-mono">{m.email}</td>
                                            <td className="px-6 py-4 text-gray-400 text-sm">
                                                {new Date(m.joined_at).toLocaleDateString()}
                                            </td>
                                            <td className="px-6 py-4">
                                                <span className={`px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wide border ${
                                                    m.role === 'owner' ? 'bg-purple-500/10 text-purple-400 border-purple-500/20' :
                                                    m.role === 'admin' ? 'bg-red-500/10 text-red-400 border-red-500/20' :
                                                    m.role === 'editor' ? 'bg-blue-500/10 text-blue-400 border-blue-500/20' :
                                                    'bg-gray-500/10 text-gray-400 border-gray-500/20'
                                                }`}>
                                                    {m.role}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4 text-right">
                                                <div className="flex items-center justify-end gap-3">
                                                    <button 
                                                        onClick={() => {
                                                            setSelectedMember(m);
                                                            setIsPermissionsModalOpen(true);
                                                        }}
                                                        className="px-3 py-1.5 bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 rounded-lg transition-all text-xs font-bold flex items-center gap-2 border border-blue-500/20"
                                                    >
                                                        <i className="pi pi-cog"></i>
                                                        {t('dashboard.manage')}
                                                    </button>
                                                    {m.role !== 'owner' && (
                                                        <button 
                                                            onClick={() => handleDeleteMember(m.user_id)}
                                                            className="p-2 text-gray-500 hover:text-red-500 hover:bg-red-500/10 rounded-lg transition-all"
                                                            title={t('dashboard.delete_member')}
                                                        >
                                                            <i className="pi pi-trash"></i>
                                                        </button>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}
            </div>


                {/* Modal Afegir Membre */}
                {isAddMemberModalOpen && (
                    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
                        <div className="w-full max-w-md bg-[var(--bg-secondary)] rounded-2xl border border-[var(--border-primary)] shadow-2xl p-6 shadow-blue-500/10 zoom-in animate-in duration-200">
                            <h3 className="text-xl font-bold text-[var(--text-primary)] mb-4">{t('dashboard.add_new_member')}</h3>
                            <div className="space-y-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-400 mb-1">{t('dashboard.user_email')}</label>
                                    <input 
                                        type="email"
                                        value={newMemberEmail}
                                        onChange={(e) => setNewMemberEmail(e.target.value)}
                                        className="w-full bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg px-4 py-3 text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all"
                                        placeholder="exemple@correu.com"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-400 mb-1">{t('dashboard.initial_role')}</label>
                                    <select 
                                        value={newMemberRole}
                                        onChange={(e) => setNewMemberRole(e.target.value)}
                                        className="w-full bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg px-4 py-3 text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all"
                                    >
                                        <option value="viewer">{t('dashboard.role_viewer_full')}</option>
                                        <option value="editor">{t('dashboard.role_editor_full')}</option>
                                        <option value="admin">{t('dashboard.role_admin_full')}</option>
                                    </select>
                                </div>
                                <div className="flex gap-3 mt-8">
                                    <button 
                                        onClick={() => setIsAddMemberModalOpen(false)}
                                        className="flex-1 px-4 py-3 bg-[var(--bg-tertiary)] hover:bg-[var(--bg-primary)] text-[var(--text-primary)] border border-[var(--border-primary)] rounded-xl transition-all font-medium"
                                    >
                                        {t('common.cancel')}
                                    </button>
                                    <button 
                                        onClick={handleAddMember}
                                        className="flex-1 px-4 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl transition-all font-medium shadow-lg shadow-blue-900/20"
                                    >
                                        {t('dashboard.send_invitation')}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* Modal Permisos Granulars */}
                {isPermissionsModalOpen && selectedMember && (
                    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
                        <div className="w-full max-w-xl bg-[var(--bg-secondary)] rounded-2xl border border-[var(--border-primary)] shadow-2xl p-6">
                            <div className="flex items-center justify-between mb-6">
                                <h3 className="text-xl font-bold text-[var(--text-primary)]">{t('dashboard.configure_permissions')}: {selectedMember.name || selectedMember.email}</h3>
                                <button onClick={() => setIsPermissionsModalOpen(false)} className="text-gray-400 hover:text-white transition-colors">
                                    <i className="pi pi-times"></i>
                                </button>
                            </div>

                            <div className="space-y-6">
                                <div>
                                    <h4 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-4">{t('dashboard.member_role')}</h4>
                                    <div className="grid grid-cols-2 gap-3">
                                        {[
                                            { id: 'viewer', label: t('dashboard.role_viewer'), desc: t('dashboard.role_viewer_desc') },
                                            { id: 'editor', label: t('dashboard.role_editor'), desc: t('dashboard.role_editor_desc') },
                                            { id: 'admin', label: t('dashboard.role_admin'), desc: t('dashboard.role_admin_desc') },
                                            { id: 'owner', label: t('dashboard.role_owner'), desc: t('dashboard.role_owner_desc') }
                                        ].map(role => (
                                            <button 
                                                key={role.id}
                                                onClick={() => {
                                                    const newCaps = ROLE_CAPABILITIES[role.id] || [];
                                                    setSelectedMember({ 
                                                        ...selectedMember, 
                                                        role: role.id,
                                                        permissions: { 
                                                            ...selectedMember.permissions, 
                                                            capabilities: newCaps 
                                                        }
                                                    });
                                                }}
                                                className={`p-3 rounded-xl border text-left transition-all ${
                                                    selectedMember.role === role.id 
                                                        ? 'bg-blue-500/10 border-blue-500/30 text-blue-400' 
                                                        : 'bg-[var(--bg-primary)] border-[var(--border-primary)] text-[var(--text-secondary)] hover:border-blue-500/20'
                                                }`}
                                            >
                                                <div className="font-bold text-sm uppercase">{role.label}</div>
                                                <div className="text-[10px] opacity-70">{role.desc}</div>
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                <div>
                                    <h4 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-4">Capacitats del Sistema</h4>
                                    <div className="grid grid-cols-2 gap-4">
                                        {[
                                            { id: 'read', label: 'Llegir Documents', icon: 'pi-eye' },
                                            { id: 'write', label: 'Editar Documents', icon: 'pi-pencil' },
                                            { id: 'delete', label: 'Eliminar Documents', icon: 'pi-trash' },
                                            { id: 'admin', label: 'Administrar Membres', icon: 'pi-users' },
                                            { id: 'analytics', label: 'Veure Analítics', icon: 'pi-chart-bar' },
                                            { id: 'tools', label: 'Executar Eines AI', icon: 'pi-bolt' }
                                        ].map(cap => {
                                            const hasCap = selectedMember.permissions?.capabilities?.includes(cap.id);
                                            return (
                                                <button 
                                                    key={cap.id}
                                                    onClick={() => {
                                                        const currentCaps = selectedMember.permissions?.capabilities || [];
                                                        const newCaps = hasCap 
                                                            ? currentCaps.filter(c => c !== cap.id)
                                                            : [...currentCaps, cap.id];
                                                        
                                                        const newMember = {
                                                            ...selectedMember,
                                                            permissions: { ...selectedMember.permissions, capabilities: newCaps }
                                                        };
                                                        setSelectedMember(newMember);
                                                    }}
                                                    className={`flex items-center gap-3 p-3 rounded-xl border transition-all text-left ${
                                                        hasCap 
                                                            ? 'bg-blue-500/10 border-blue-500/30 text-blue-400' 
                                                            : 'bg-[var(--bg-primary)] border-[var(--border-primary)] text-[var(--text-secondary)] hover:border-blue-500/20'
                                                    }`}
                                                >
                                                    <i className={`pi ${cap.icon} text-sm`}></i>
                                                    <span className="text-sm font-medium">{cap.label}</span>
                                                    {hasCap && <i className="pi pi-check text-[10px] ml-auto"></i>}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>

                                <div>
                                    <h4 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-2">Accés a Dades Específiques</h4>
                                    <p className="text-xs text-gray-500 mb-4 italic">Limita l'accés a carpetes (Vaults) específiques dins d'aquest workspace.</p>
                                    
                                    {vaultAccessLoading ? (
                                        <div className="text-gray-500 text-xs animate-pulse">Carregant accessos...</div>
                                    ) : allVaults.length === 0 ? (
                                        <p className="text-xs text-gray-500">No hi ha vaults configurats en aquest workspace.</p>
                                    ) : (
                                        <div className="space-y-2">
                                            {allVaults.map(v => {
                                                const hasAccess = memberVaultAccess.some(acc => acc.vault_id === v.id);
                                                return (
                                                    <div key={v.id} className="flex items-center justify-between p-3 bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-xl hover:border-white/10 transition-colors">
                                                        <div className="flex items-center gap-3">
                                                            <i className="pi pi-folder text-blue-400/50"></i>
                                                            <span className="text-sm font-medium text-gray-300">{v.name}</span>
                                                        </div>
                                                        <button 
                                                            onClick={() => toggleVaultAccess(selectedMember.user_id, v.id)}
                                                            className={`px-3 py-1 rounded-lg text-[10px] font-bold uppercase transition-all ${
                                                                hasAccess 
                                                                    ? 'bg-green-500/20 text-green-400 border border-green-500/30' 
                                                                    : 'bg-white/5 text-gray-500 border border-white/10 hover:bg-white/10'
                                                            }`}
                                                        >
                                                            {hasAccess ? 'Amb Accés' : 'Sense Accés'}
                                                        </button>
                                                    </div>
                                                );
                                            })}
                                            {memberVaultAccess.length === 0 && (
                                                <div className="p-3 bg-blue-500/5 border border-blue-500/10 rounded-xl flex items-start gap-3">
                                                    <i className="pi pi-info-circle text-blue-500/50 mt-1"></i>
                                                    <p className="text-[10px] text-blue-500/70 leading-relaxed">
                                                        Si no se selecciona cap Vault, l'usuari tindrà accés total a tots els Vaults per defecte.
                                                    </p>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>

                                <div className="flex gap-3 mt-8">
                                    <button 
                                        onClick={() => setIsPermissionsModalOpen(false)}
                                        className="px-4 py-3 bg-[var(--bg-tertiary)] hover:bg-[var(--bg-primary)] text-[var(--text-primary)] border border-[var(--border-primary)] rounded-xl transition-all font-medium flex-1"
                                    >
                                        Cancel·lar
                                    </button>
                                    <button 
                                        onClick={() => handleUpdatePermissions(selectedMember.user_id, selectedMember.permissions, selectedMember.role)}
                                        className="px-4 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl transition-all font-medium flex-1 shadow-lg shadow-blue-900/20"
                                    >
                                        Guardar Canvis
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>
           </div>
          </div>
        </div>
    );
};

export default Dashboard;
