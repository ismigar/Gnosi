import React, { useEffect, useState, useCallback } from 'react';
import { Clock3, History, Play, RefreshCw, Users, Shield, Save, Gauge, X, Bug, FileText, AlertTriangle, Activity, Cpu, Layers, Database, ShieldCheck, Clock, Book, ShieldAlert, Check, Loader2, Eye, Edit2, Trash2, Sparkles } from 'lucide-react';
import toast from '../lib/toast';
import { AppHeader } from '../components/AppHeader';
import { useApi } from '../hooks/use-api';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../hooks/useTheme';
import { useConfigChanged } from '../lib/configEvents';
import { APP_VERSION } from '../lib/version';
import ConfirmModal from '../components/ConfirmModal';
import { DashboardPaginationControls } from '../components/DashboardPaginationControls';
import { SettingsSectionTabs } from '../components/SettingsSectionTabs';
import { ReleaseNotesDialog } from '../components/ReleaseNotesDialog';
import { usePlugins } from '../plugins/usePlugins';

const ROLE_CAPABILITIES = {
    viewer: ['read'],
    editor: ['read', 'write'],
    admin: ['read', 'write', 'delete', 'admin', 'analytics', 'tools'],
    owner: ['read', 'write', 'delete', 'admin', 'analytics', 'tools']
};

function Dashboard() {
    const { role: initialRole, apiFetch } = useApi();
    const { t } = useTranslation();
    const { isDark } = useTheme();
    const { isEnabled } = usePlugins();
    const automationsEnabled = isEnabled('automations');
    const aiEnabled = isEnabled('ai-platform');
    const [userRole, setUserRole] = useState(initialRole);
    const isAdmin = userRole === 'admin' || userRole === 'owner';

    const [approvedTools, setApprovedTools] = useState([]);
    const [pendingTools, setPendingTools] = useState([]);

    const [, setApprovedLoading] = useState(true);
    const [analytics, setAnalytics] = useState(null);
    const [schedulers, setSchedulers] = useState([]);
    const [notifications, setNotifications] = useState([]);
    const [schedulerLoading, setSchedulerLoading] = useState(true);
    const [notificationsLoading, setNotificationsLoading] = useState(false);
    const [notifPage, setNotifPage] = useState(0);
    const [notifTotal, setNotifTotal] = useState(0);
    const NOTIF_LIMIT = 20;

    // Task Execution History (DB Persistent)
    const [taskHistory, setTaskHistory] = useState([]);
    const [taskHistoryTotal, setTaskHistoryTotal] = useState(0);
    const [taskHistoryPage, setTaskHistoryPage] = useState(0);
    const HISTORY_LIMIT = 15;
    const [taskHistoryLoading, setTaskHistoryLoading] = useState(false);

    // Modernized Dashboard Features (Directives & Traps with pagination)
    const [directives, setDirectives] = useState([]);
    const [directivesTotal, setDirectivesTotal] = useState(0);
    const [directivesPage, setDirectivesPage] = useState(0);
    const DIRECTIVES_LIMIT = 12;

    const [traps, setTraps] = useState([]);
    const [trapsTotal, setTrapsTotal] = useState(0);
    const [trapsPage, setTrapsPage] = useState(0);
    const TRAPS_LIMIT = 15;
    const [selectedControlTab, setSelectedControlTab] = useState('schedulers');
    const [executingTasks, setExecutingTasks] = useState(new Set());
    
    // Admin state
    const [members, setMembers] = useState([]);
    const [membersLoading, setMembersLoading] = useState(false);
    const [isAddMemberModalOpen, setIsAddMemberModalOpen] = useState(false);
    const [isPermissionsModalOpen, setIsPermissionsModalOpen] = useState(false);

    const [selectedMember, setSelectedMember] = useState(null);
    const [newMemberEmail, setNewMemberEmail] = useState('');
    const [newMemberRole, setNewMemberRole] = useState('viewer');
    const [allVaults, setAllVaults] = useState([]);
    const [memberVaultAccess, setMemberVaultAccess] = useState([]);
    const [vaultAccessLoading, setVaultAccessLoading] = useState(false);
    
    // Traps drilldown state
    const [isTrapsModalOpen, setIsTrapsModalOpen] = useState(false);
    const [isTrapsLoading, setIsTrapsLoading] = useState(false);
    const [isDirectivesModalOpen, setIsDirectivesModalOpen] = useState(false);
    const [isDirectivesLoading, setIsDirectivesLoading] = useState(false);
    const [editingDirective, setEditingDirective] = useState(null);
    const [isEditorSaving, setIsEditorSaving] = useState(false);
    const [editorContent, setEditorContent] = useState('');

    // States for the confirmation modals (replace window.confirm)
    const [confirmDeleteDirective, setConfirmDeleteDirective] = useState(null); // directive to delete
    const [confirmPurgeHistory, setConfirmPurgeHistory] = useState(false);
    const [confirmPurgeLogs, setConfirmPurgeLogs] = useState(false);
    
    // New states for drill-down modals
    const [isToolsModalOpen, setIsToolsModalOpen] = useState(false);
    const [isReleaseNotesOpen, setIsReleaseNotesOpen] = useState(false);
    
    const activeWorkspaceId = localStorage.getItem('gnosi_workspace_id') || 'personal';

    const [gnosiMode, setGnosiMode] = useState('personal');
    const fetchConfig = useCallback(async () => {
        try {
            const config = await apiFetch('/api/config');
            if (config.settings && config.settings.gnosi_mode) {
                setGnosiMode(config.settings.gnosi_mode);
            }
        } catch (error) {
            console.error("Error fetching config", error);
        }
    }, [apiFetch]);

    // Re-fetch when the Settings modal has saved changes (without a reload).
    useConfigChanged(fetchConfig);

    const fetchPendingTools = useCallback(async () => {
        try {
            const data = await apiFetch('/api/tools/pending');
            setPendingTools(data);
        } catch (error) {
            console.error("Error fetching pending tools", error);
        }
    }, [apiFetch]);

    const fetchAnalytics = async () => {
        try {
            const data = await apiFetch('/api/analytics/');
            if (data) setAnalytics(data);
        } catch (error) {
            console.error('Error fetching analytics:', error);
        }
    };

    const fetchSchedulers = useCallback(async (silent = false) => {
        if (!silent) setSchedulerLoading(true);
        try {
            const data = await apiFetch('/api/schedulers');
            setSchedulers(Array.isArray(data) ? data : []);
        } catch (error) {
            console.error("Error fetching schedulers", error);
        } finally {
            if (!silent) setSchedulerLoading(false);
        }
    }, [apiFetch]);

    const fetchApprovedTools = useCallback(async () => {
        setApprovedLoading(true);
        try {
            const data = await apiFetch('/api/analytics/directives');
            const mature = (data.directives || []).filter(d => d.path.includes('pipeline/skills/') && d.path.endsWith('SKILL.md'));
            setApprovedTools(mature);
        } catch (error) {
            console.error("Error fetching approved tools", error);
        } finally {
            setApprovedLoading(false);
        }
    }, [apiFetch]);

    const fetchNotifications = async (p = 0) => {
        const page = typeof p === 'number' ? p : 0;
        setNotificationsLoading(true);
        try {
            const offset = page * NOTIF_LIMIT;
            const data = await apiFetch(`/api/system/notifications?limit=${NOTIF_LIMIT}&offset=${offset}`);
            if (data && data.items) {
                setNotifications(data.items);
                setNotifTotal(data.total);
                setNotifPage(page);
            }
        } catch (error) {
            console.error('Error fetching notifications:', error);
        } finally {
            setNotificationsLoading(false);
        }
    };

    const fetchTaskHistory = async (p = 0) => {
        const page = typeof p === 'number' ? p : 0;
        setTaskHistoryLoading(true);
        try {
            const offset = page * HISTORY_LIMIT;
            const data = await apiFetch(`/api/schedulers/history?limit=${HISTORY_LIMIT}&offset=${offset}`);
            if (data && data.items) {
                setTaskHistory(data.items);
                setTaskHistoryTotal(data.total);
                setTaskHistoryPage(page);
            }
        } catch (error) {
            console.error('Error fetching task history:', error);
        } finally {
            setTaskHistoryLoading(false);
        }
    };

    const fetchTraps = async (p = 0) => {
        const page = typeof p === 'number' ? p : 0;
        setIsTrapsLoading(true);
        try {
            const offset = page * TRAPS_LIMIT;
            const data = await apiFetch(`/api/analytics/traps?limit=${TRAPS_LIMIT}&offset=${offset}`);
            if (data && data.traps) {
                setTraps(data.traps);
                setTrapsTotal(data.total);
                setTrapsPage(page);
            }
        } catch (error) {
            console.error('Error fetching traps:', error);
        } finally {
            setIsTrapsLoading(false);
        }
    };

    const fetchDirectives = async (p = 0) => {
        const page = typeof p === 'number' ? p : 0;
        setIsDirectivesLoading(true);
        try {
            const offset = page * DIRECTIVES_LIMIT;
            const data = await apiFetch(`/api/analytics/directives?limit=${DIRECTIVES_LIMIT}&offset=${offset}`);
            if (data && data.directives) {
                setDirectives(data.directives);
                setDirectivesTotal(data.total);
                setDirectivesPage(page);
            }
        } catch (error) {
            console.error('Error fetching directives:', error);
        } finally {
            setIsDirectivesLoading(false);
        }
    };

    const handleEditDirective = useCallback(async (directive) => {
        try {
            const data = await apiFetch(`/api/analytics/directives/content?path=${encodeURIComponent(directive.path)}`);
            setEditorContent(data.content);
            setEditingDirective(directive);
        } catch (_error) {
            toast.error(t('dashboard.directive_load_error'));
        }
    }, [apiFetch, t]);

    const handleSaveDirective = useCallback(async () => {
        if (!editingDirective) return;
        setIsEditorSaving(true);
        try {
            await apiFetch('/api/analytics/directives/content', {
                method: 'POST',
                body: JSON.stringify({
                    path: editingDirective.path,
                    content: editorContent
                })
            });
            toast.success(t('dashboard.directive_saved'));
            setEditingDirective(null);
            fetchDirectives(directivesPage);
            fetchApprovedTools();
            fetchAnalytics();
        } catch (_error) {
            toast.error(t('dashboard.directive_save_error'));
        } finally {
            setIsEditorSaving(false);
        }
    }, [editingDirective, editorContent, directivesPage, fetchApprovedTools, fetchAnalytics, apiFetch, t]);

    const handleDeleteDirective = (directive) => setConfirmDeleteDirective(directive);

    const doDeleteDirective = async () => {
        const directive = confirmDeleteDirective;
        setConfirmDeleteDirective(null);
        if (!directive) return;
        const isSkill = directive.path?.includes("pipeline/skills");
        try {
            await apiFetch(`/api/analytics/directives?path=${encodeURIComponent(directive.path)}`, {
                method: 'DELETE'
            });
            toast.success(isSkill ? t('dashboard.skill_deleted') : t('dashboard.directive_deleted'));
            fetchDirectives(directivesPage);
            fetchApprovedTools();
            fetchAnalytics();
        } catch (_error) {
            toast.error(isSkill ? t('dashboard.skill_delete_error') : t('dashboard.directive_delete_error'));
        }
    };

    const handlePurgeHistory = () => setConfirmPurgeHistory(true);

    const doPurgeHistory = async () => {
        setConfirmPurgeHistory(false);
        try {
            await apiFetch('/api/schedulers/history', { method: 'DELETE' });
            toast.success(t('dashboard.history_purged'));
            fetchTaskHistory(0);
        } catch (_error) {
            toast.error(t('dashboard.history_purge_error'));
        }
    };

    const handlePurgeLogs = () => setConfirmPurgeLogs(true);

    const doPurgeLogs = async () => {
        setConfirmPurgeLogs(false);
        try {
            await apiFetch('/api/system/notifications', { method: 'DELETE' });
            toast.success(t('dashboard.logs_purged'));
            fetchNotifications(0);
        } catch (_error) {
            toast.error(t('dashboard.logs_purge_error'));
        }
    };

    useEffect(() => {
        const fetchWorkspaceData = async () => {
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

        const fetchSystemStatus = () => {
            fetchConfig();
            if (aiEnabled) fetchPendingTools();
            fetchAnalytics();
        };

        fetchWorkspaceData();
        fetchAnalytics();
        fetchDirectives(0);
        fetchTraps(0);
        fetchSystemStatus();
        if (automationsEnabled) fetchSchedulers();
        fetchNotifications(0);
        if (automationsEnabled) fetchTaskHistory(0);

        const toolsInterval = aiEnabled ? setInterval(fetchPendingTools, 15000) : null;
        const schedulersInterval = automationsEnabled
            ? setInterval(() => fetchSchedulers(true), 30000)
            : null;
        
        return () => {
            if (toolsInterval) clearInterval(toolsInterval);
            if (schedulersInterval) clearInterval(schedulersInterval);
        };
    }, [fetchSchedulers, apiFetch, activeWorkspaceId, automationsEnabled, aiEnabled]); // eslint-disable-line react-hooks/exhaustive-deps

    // Secondary polling for history when tab is active
    useEffect(() => {
        if (automationsEnabled && selectedControlTab === 'history') {
            const historyInterval = setInterval(() => {
                fetchTaskHistory(taskHistoryPage);
                fetchNotifications(notifPage);
            }, 20000);
            return () => clearInterval(historyInterval);
        }
    }, [selectedControlTab, taskHistoryPage, notifPage, automationsEnabled]);

    useEffect(() => {
        if (!automationsEnabled && ['schedulers', 'history'].includes(selectedControlTab)) {
            setSelectedControlTab(isAdmin && gnosiMode === 'org' ? 'admin' : 'overview');
        }
    }, [automationsEnabled, gnosiMode, isAdmin, selectedControlTab]);



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

    const handleAddMember = useCallback(async () => {
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
    }, [newMemberEmail, activeWorkspaceId, newMemberRole, fetchMembers, apiFetch]);

    const [confirmDeleteMember, setConfirmDeleteMember] = useState(null);
    const handleDeleteMember = (userId) => setConfirmDeleteMember(userId);
    const doDeleteMember = async () => {
        const userId = confirmDeleteMember;
        setConfirmDeleteMember(null);
        try {
            await apiFetch(`/api/workspaces/${activeWorkspaceId}/members/${userId}`, {
                method: 'DELETE'
            });
            fetchMembers();
        } catch (e) {
            console.error("Error deleting member", e);
        }
    };

    const handleUpdatePermissions = useCallback(async (userId, permissions, role) => {
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
    }, [activeWorkspaceId, fetchMembers, apiFetch]);

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

    const updateScheduler = async (task, overrides) => {
        try {
            const payload = { ...task, ...overrides };
            await apiFetch(`/api/schedulers/${task.name}`, {
                method: 'PUT',
                body: JSON.stringify(payload)
            });
            fetchSchedulers(true);
        } catch (e) {
            console.error("Error updating scheduler", e);
        }
    };

    const runSchedulerNow = async (taskName) => {
        if (executingTasks.has(taskName)) return;
        
        setExecutingTasks(prev => new Set(prev).add(taskName));
        const t_id = toast.loading(`${t('dashboard.running_task', "Running task")} ${taskName.replace(/_/g, ' ')}...`);
        
        try {
            const data = await apiFetch(`/api/schedulers/${taskName}/run`, { method: 'POST' });
            if (data.success) {
                toast.success(t('dashboard.task_started', "Task started successfully"), { id: t_id });
            } else {
                toast.error(data.error || t('dashboard.unknown_error'), { id: t_id });
            }
            // We refresh after a short delay so the backend has processed the state change to "running"
            setTimeout(() => fetchSchedulers(true), 500);
        } catch (e) {
            console.error("Error running scheduler", e);
            toast.error(`${t('dashboard.run_error', "Run error")}: ${e.message}`, { id: t_id });
        } finally {
            setExecutingTasks(prev => {
                const next = new Set(prev);
                next.delete(taskName);
                return next;
            });
        }
    };


    // Unified keyboard handler for all Dashboard modals
    useEffect(() => {
        const anyModalOpen = isAddMemberModalOpen || isPermissionsModalOpen || isTrapsModalOpen || isDirectivesModalOpen || isToolsModalOpen || editingDirective;
        if (!anyModalOpen) return;

        const handleKeyDown = (e) => {
            if (e.key === 'Escape') {
                setIsAddMemberModalOpen(false);
                setIsPermissionsModalOpen(false);
                setIsTrapsModalOpen(false);
                setIsDirectivesModalOpen(false);
                setIsToolsModalOpen(false);
                setEditingDirective(null);
            } else if (e.key === 'Enter') {
                if (document.activeElement.tagName === 'TEXTAREA') return;
                
                // If we're editing a directive, could Enter save it? 
                // We usually prefer it not to close if we're editing text, but the requirement is Enter = Confirm.
                // In this case, since there's a Sauve button, we leave it like this.
                if (editingDirective) handleSaveDirective();
                else if (isAddMemberModalOpen) handleAddMember();
                else if (isPermissionsModalOpen) handleUpdatePermissions(selectedMember.user_id, selectedMember.permissions, selectedMember.role);
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isAddMemberModalOpen, isPermissionsModalOpen, isTrapsModalOpen, isDirectivesModalOpen, isToolsModalOpen, editingDirective, selectedMember, handleAddMember, handleSaveDirective, handleUpdatePermissions]);

    const formatFrequency = (task) => {
        if (typeof task.interval_minutes === 'number' && task.interval_minutes > 0) {
            if (task.interval_minutes % 1440 === 0) {
                return t('dashboard.frequency_days', { count: task.interval_minutes / 1440 });
            }
            if (task.interval_minutes % 60 === 0) {
                return t('dashboard.frequency_hours', { count: task.interval_minutes / 60 });
            }
            const hours = task.interval_minutes / 60;
            if (hours > 1 && Number.isFinite(hours)) {
                return t('dashboard.frequency_hours', { count: Math.round(hours * 100) / 100 });
            }
            return t('dashboard.frequency_minutes', { count: Math.round(task.interval_minutes) });
        }
        if (typeof task.interval === 'number' && task.interval > 0) {
            return t('dashboard.frequency_seconds', { count: task.interval });
        }
        return t('dashboard.frequency_none');
    };

    return (
        <div className="h-full bg-[var(--bg-primary)] overflow-hidden flex flex-col">
            <AppHeader icon={Gauge} title={t('dashboard.control_center', 'Control Center')}>
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={() => setIsReleaseNotesOpen(true)}
                        className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border-primary)] bg-[var(--bg-tertiary)] px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
                        aria-label={t('release_notes.open_aria', { version: APP_VERSION })}
                    >
                        <Sparkles size={12} aria-hidden="true" />
                        v{APP_VERSION}
                    </button>
                </div>
            </AppHeader>

            <ReleaseNotesDialog
                open={isReleaseNotesOpen}
                onClose={() => setIsReleaseNotesOpen(false)}
                initialVersion={APP_VERSION}
            />

            <div className="flex-1 overflow-y-auto">
                <div className="home-page animate-in fade-in duration-700 !text-left !items-start" style={{ minHeight: 'unset', paddingTop: '2rem' }}>
                    {/* Glow Backgrounds - More subtle in light mode */}
                    <div className={`home-page__glow home-page__glow--1 ${isDark ? 'opacity-20' : 'opacity-10 opacity-60 grayscale'}`}></div>
                    <div className={`home-page__glow home-page__glow--2 ${isDark ? 'opacity-20' : 'opacity-10 opacity-60 grayscale'}`}></div>

                    <div className="w-full">
            {/* Control Center Tabs */}
            {(automationsEnabled || (isAdmin && gnosiMode === 'org')) && <div>
                <SettingsSectionTabs
                    ariaLabel={t('dashboard.control_center')}
                    activeId={selectedControlTab}
                    onChange={setSelectedControlTab}
                    items={[
                        ...(automationsEnabled ? [
                            { id: 'schedulers', icon: Clock3, label: t('dashboard.tab_schedulers') },
                            { id: 'history', icon: History, label: t('dashboard.tab_history') },
                        ] : []),
                        ...(isAdmin && gnosiMode === 'org'
                            ? [{ id: 'admin', icon: Users, label: t('dashboard.tab_admin') }]
                            : [])
                    ]}
                />

                {automationsEnabled && selectedControlTab === 'schedulers' && (
                    <div className="glass-panel p-6 rounded-2xl border border-[var(--border-primary)]">
                        <div className="flex items-center mb-6">
                            <h2 className="text-xl font-bold flex items-center gap-2">
                                <span className="w-1 h-6 bg-blue-500 rounded-full"></span>
                                {t('dashboard.tab_schedulers')}
                            </h2>
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
                                                    <option value={15}>{t('dashboard.time_15_min')}</option>
                                                    <option value={30}>{t('dashboard.time_30_min')}</option>
                                                    <option value={45}>{t('dashboard.time_45_min')}</option>
                                                    <option value={60}>{t('dashboard.time_1_hour')}</option>
                                                    <option value={90}>{t('dashboard.time_1_5_hours')}</option>
                                                    <option value={120}>{t('dashboard.time_2_hours')}</option>
                                                    <option value={180}>{t('dashboard.time_3_hours')}</option>
                                                    <option value={300}>{t('dashboard.time_5_hours')}</option>
                                                    <option value={360}>{t('dashboard.time_6_hours')}</option>
                                                    <option value={720}>{t('dashboard.time_12_hours')}</option>
                                                    <option value={1440}>{t('dashboard.time_1_day')}</option>
                                                    <option value={10080}>{t('dashboard.time_1_week')}</option>
                                                </select>
                                            )}

                                            <button
                                                onClick={() => runSchedulerNow(task.name)}
                                                disabled={executingTasks.has(task.name)}
                                                className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-xs font-semibold transition-all ${
                                                    executingTasks.has(task.name) ? 'opacity-50 cursor-not-allowed' : ''
                                                }`}
                                            >
                                                {executingTasks.has(task.name) ? (
                                                    <Loader2 size={12} className="animate-spin" />
                                                ) : (
                                                    <Play size={12} />
                                                )}
                                                {t('dashboard.run_now')}
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {automationsEnabled && selectedControlTab === 'history' && (
                    <>
                        <div className="grid grid-cols-1 gap-8">
                            <div className="glass-panel p-6 rounded-2xl border border-[var(--border-primary)]">
                                <div className="flex items-center justify-between mb-4">
                                    <h3 className="text-gray-500 text-xs uppercase font-bold tracking-widest flex items-center gap-2">
                                        <Clock size={14} className="text-blue-500" />
                                        {t('dashboard.latest_scheduled_runs')}
                                    </h3>
                                    <button 
                                        onClick={handlePurgeHistory}
                                        className="text-[10px] flex items-center gap-1 text-red-400 hover:bg-red-500/10 px-2 py-1 rounded transition-all"
                                    >
                                        <Trash2 size={12} />
                                        {t('dashboard.purge_history')}
                                    </button>
                                </div>
                                <div className="space-y-2">
                                    {taskHistoryLoading && taskHistory.length === 0 ? (
                                        <p className="text-center py-10"><Loader2 className="animate-spin mx-auto text-blue-500" /></p>
                                    ) : taskHistory.length === 0 ? (
                                        <p className="text-sm text-gray-500 py-10 text-center italic">{t('dashboard.no_runs_recorded')}</p>
                                    ) : (
                                        taskHistory.map(history => (
                                            <div key={history.id} className={`border border-[var(--border-primary)] rounded-lg p-3 bg-[var(--bg-tertiary)] flex items-center justify-between group hover:border-${history.status === 'error' ? 'red' : 'cyan'}-500/30 transition-all`}>
                                                <div>
                                                    <div className="flex items-center gap-2">
                                                        <p className="text-sm font-semibold text-[var(--text-primary)] group-hover:text-cyan-400 transition-colors">{history.task_name.replace(/_/g, ' ')}</p>
                                                        {history.status === 'running' && <Loader2 size={10} className="animate-spin text-blue-400" />}
                                                    </div>
                                                    <p className="text-[10px] text-[var(--text-secondary)] mt-0.5">
                                                        {new Date(history.started_at).toLocaleString()} 
                                                        {history.duration_seconds && ` • ${history.duration_seconds.toFixed(1)}s`}
                                                    </p>
                                                    {history.message && <p className="text-[10px] text-[var(--text-secondary)] mt-1 italic line-clamp-1">{history.message}</p>}
                                                </div>
                                                <div className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${
                                                    history.status === 'success' ? 'bg-green-500/10 text-green-500' :
                                                    history.status === 'error' ? 'bg-red-500/10 text-red-500' :
                                                    'bg-blue-500/10 text-blue-500'
                                                }`}>
                                                    {history.status.toUpperCase()}
                                                </div>
                                            </div>
                                        ))
                                    )}
                                </div>
                                <DashboardPaginationControls
                                    total={taskHistoryTotal}
                                    limit={HISTORY_LIMIT}
                                    page={taskHistoryPage}
                                    onPageChange={fetchTaskHistory}
                                    loading={taskHistoryLoading}
                                />
                            </div>
                        </div>

                            <div className="mt-8 glass-panel p-6 rounded-2xl border border-[var(--border-primary)]">
                                <div className="flex items-center justify-between mb-4">
                                    <h3 className="text-gray-500 text-xs uppercase font-bold tracking-widest flex items-center gap-2">
                                        <Activity size={14} className="text-blue-500" />
                                        {t('dashboard.system_logs', "System Logs")}
                                        <span className="text-[10px] text-blue-500 bg-blue-500/10 px-2 py-0.5 rounded-full">{notifTotal} {t('common.entries', "entries")}</span>
                                    </h3>
                                    <div className="flex items-center gap-2">
                                        <button 
                                            onClick={() => fetchNotifications(notifPage)}
                                            className="p-1 hover:bg-blue-500/10 text-blue-400 rounded transition-all"
                                            title={t('dashboard.refresh_logs')}
                                        >
                                            <RefreshCw size={14} className={notificationsLoading ? "animate-spin" : ""} />
                                        </button>
                                        <button 
                                            onClick={handlePurgeLogs}
                                            className="text-[10px] flex items-center gap-1 text-red-400 hover:bg-red-500/10 px-2 py-1 rounded transition-all border border-red-500/10"
                                        >
                                            <Trash2 size={12} />
                                            {t('dashboard.purge_logs')}
                                        </button>
                                    </div>
                                </div>
                            
                            {notificationsLoading && notifications.length === 0 ? (
                                <p className="text-gray-400">{t('dashboard.loading_logs', "Loading logs...")}</p>
                            ) : notifications.length === 0 ? (
                                <p className="text-gray-500 italic">{t('dashboard.no_logs', "There are no recorded logs.")}</p>
                            ) : (
                                <>
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-left text-xs">
                                            <thead>
                                                <tr className="border-b border-[var(--border-primary)] text-[var(--text-secondary)] font-bold">
                                                    <th className="pb-2 w-32">{t('common.time', "Time")}</th>
                                                    <th className="pb-2 w-20">{t('common.level', "Level")}</th>
                                                    <th className="pb-2">{t('common.event', "Event")}</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-[var(--border-primary)]">
                                                {notifications.map(notif => (
                                                    <tr key={notif.id} className="hover:bg-[var(--bg-tertiary)] transition-colors">
                                                        <td className="py-2 text-gray-400 font-mono">
                                                            {new Date(notif.created_at).toLocaleString([], { 
                                                                day: '2-digit', 
                                                                month: '2-digit', 
                                                                year: '2-digit', 
                                                                hour: '2-digit', 
                                                                minute: '2-digit', 
                                                                second: '2-digit' 
                                                            })}
                                                        </td>
                                                        <td className="py-2">
                                                            <span className={`px-2 py-0.5 rounded-full font-bold uppercase text-[9px] ${
                                                                notif.level === 'ERROR' ? 'bg-red-500/20 text-red-400' :
                                                                notif.level === 'WARNING' ? 'bg-yellow-500/20 text-yellow-500' :
                                                                notif.level === 'SUCCESS' ? 'bg-green-500/20 text-green-400' :
                                                                'bg-blue-500/20 text-blue-400'
                                                            }`}>
                                                                {notif.level}
                                                            </span>
                                                        </td>
                                                        <td className="py-2">
                                                            <div className="font-bold text-[var(--text-primary)]">{notif.title}</div>
                                                            <div className="text-[var(--text-secondary)] mt-0.5">{notif.message}</div>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                    <DashboardPaginationControls
                                        total={notifTotal}
                                        limit={NOTIF_LIMIT}
                                        page={notifPage}
                                        onPageChange={fetchNotifications}
                                        loading={notificationsLoading}
                                    />
                                </>
                            )}
                        </div>
                    </>
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
            </div>}
        </div>
    </div>

            {/* Modals moved outside animated container for better positioning */}
            {/* Traps Detail Modal */}
            {isTrapsModalOpen && (
                <div className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-300">
                    <div className="bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-3xl w-full max-w-6xl max-h-[85vh] overflow-hidden flex flex-col shadow-2xl">
                        <div className="p-6 border-b border-[var(--border-primary)] flex items-center justify-between bg-[var(--bg-primary)]/50">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-2xl bg-red-500/10 text-red-400 flex items-center justify-center">
                                    <Bug size={24} />
                                </div>
                                <div>
                                    <h3 className="text-xl font-bold text-[var(--text-primary)] font-gnosi">{t('dashboard.documented_pitfalls_modal', "Documented Pitfalls")}</h3>
                                    <p className="text-xs text-[var(--text-secondary)]">{t('dashboard.errors_prevented_desc', "Errors prevented thanks to the directives.")}</p>
                                </div>
                            </div>
                            <button 
                                onClick={() => setIsTrapsModalOpen(false)}
                                className="p-2 hover:bg-[var(--bg-tertiary)] rounded-xl transition-colors text-[var(--text-secondary)]"
                            >
                                <X size={20} />
                            </button>
                        </div>
                        
                        <div className="flex-1 overflow-y-auto p-6">
                            {isTrapsLoading ? (
                                <div className="flex flex-col items-center justify-center py-20 gap-4">
                                    <RefreshCw className="animate-spin text-blue-500" size={32} />
                                    <p className="text-[var(--text-secondary)] font-medium">{t('dashboard.loading_details')}</p>
                                </div>
                            ) : traps.length === 0 ? (
                                <div className="text-center py-20 text-[var(--text-secondary)]">
                                    <AlertTriangle className="mx-auto mb-4 opacity-20" size={48} />
                                    <p>{t('dashboard.no_traps')}</p>
                                </div>
                            ) : (
                                <>
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-left table-fixed">
                                            <thead>
                                                <tr className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider border-b border-[var(--border-primary)]">
                                                    <th className="px-4 py-3 w-32">{t('common.date', "Date")}</th>
                                                    <th className="px-4 py-3 w-40">{t('common.source', "Source")}</th>
                                                    <th className="px-4 py-3 w-1/3">{t('common.trap', "Pitfall / Error")}</th>
                                                    <th className="px-4 py-3">{t('common.solution', "Applied Solution")}</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-[var(--border-primary)]">
                                                {traps.map((t, i) => (
                                                    <tr key={i} className="hover:bg-[var(--bg-tertiary)] transition-all group">
                                                        <td className="px-4 py-4 text-[11px] font-mono text-[var(--text-secondary)] whitespace-nowrap">{t.date}</td>
                                                        <td className="px-4 py-4">
                                                            <div className="flex flex-col gap-1">
                                                                <span className={`text-[9px] font-black uppercase tracking-tighter px-1.5 py-0.5 rounded w-fit ${
                                                                    t.category === 'Agent' ? 'bg-purple-500/20 text-purple-400 border border-purple-500/30' :
                                                                    t.category === 'Skill' ? 'bg-green-500/20 text-green-400 border border-green-500/30' :
                                                                    'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                                                                }`}>
                                                                    {t.category || 'Memory'}
                                                                </span>
                                                                <span className="text-[10px] font-bold text-[var(--text-secondary)] truncate max-w-[120px]" title={t.source}>
                                                                    {t.source}
                                                                </span>
                                                            </div>
                                                        </td>
                                                        <td className="px-4 py-4">
                                                            <div className="text-sm font-semibold text-[var(--text-primary)] leading-tight break-words overflow-hidden">
                                                                {t.trap}
                                                            </div>
                                                        </td>
                                                        <td className="px-4 py-4">
                                                            <div className="text-xs text-green-500 italic leading-relaxed bg-green-500/5 p-3 rounded-xl border border-green-500/10 break-words overflow-hidden">
                                                                {t.solution}
                                                            </div>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                    <DashboardPaginationControls
                                        total={trapsTotal}
                                        limit={TRAPS_LIMIT}
                                        page={trapsPage}
                                        onPageChange={fetchTraps}
                                        loading={isTrapsLoading}
                                    />
                                </>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Directives Detail Modal */}
            {isDirectivesModalOpen && (
                <div className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-300">
                    <div className="bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-3xl w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col shadow-2xl">
                        <div className="p-6 border-b border-[var(--border-primary)] flex items-center justify-between bg-[var(--bg-primary)]/50">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-2xl bg-cyan-500/10 text-cyan-400 flex items-center justify-center">
                                    <FileText size={20} />
                                </div>
                                <div>
                                    <h3 className="text-xl font-bold text-[var(--text-primary)] font-gnosi">{t('dashboard.directives_modal', "System Directives")}</h3>
                                    <p className="text-xs text-[var(--text-secondary)]">{t('dashboard.directives_desc', "Active SOPs and lessons learned by the system.")}</p>
                                </div>
                            </div>
                            <button 
                                onClick={() => setIsDirectivesModalOpen(false)}
                                className="p-2 hover:bg-[var(--bg-tertiary)] rounded-xl transition-colors text-[var(--text-secondary)]"
                            >
                                <X size={20} />
                            </button>
                        </div>
                        
                        <div className="flex-1 overflow-y-auto p-6">
                            {isDirectivesLoading ? (
                                <div className="flex flex-col items-center justify-center py-20 gap-4">
                                    <RefreshCw className="animate-spin text-blue-500" size={32} />
                                    <p className="text-[var(--text-secondary)] font-medium">{t('dashboard.loading_details')}</p>
                                </div>
                            ) : (
                                <>
                                    <div className="grid grid-cols-1 gap-3">
                                        {directives.map((d, i) => (
                                            <div key={i} className="p-4 bg-[var(--bg-tertiary)] border border-[var(--border-primary)] rounded-2xl flex items-center justify-between hover:border-cyan-500/30 transition-all cursor-default group">
                                                <div className="flex items-center gap-4">
                                                    <div className="text-cyan-500/50 group-hover:text-cyan-400 transition-colors">
                                                        <Shield size={24} />
                                                    </div>
                                                    <div>
                                                        <span className="text-sm font-bold text-[var(--text-primary)] uppercase tracking-wide block">{d.name.replace(/_/g, ' ')}</span>
                                                        <div className="flex items-center gap-2">
                                                            <span className="text-[10px] text-[var(--text-secondary)] font-mono">{(d.size_bytes / 1024).toFixed(1)} KB</span>
                                                            <span className="text-[10px] text-cyan-500/60 font-medium px-1.5 py-0.5 bg-cyan-500/5 rounded uppercase">{d.category}</span>
                                                        </div>
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-4">
                                                    <span className="text-[10px] font-bold text-red-400 bg-red-400/10 px-2 py-1 rounded-md">
                                                        {d.trap_count} {t('dashboard.traps', "pitfalls")}
                                                    </span>
                                                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                        <button 
                                                            onClick={() => handleEditDirective(d)}
                                                            className="p-1.5 hover:bg-cyan-500/10 text-cyan-400 rounded-lg transition-colors"
                                                            title={t('dashboard.edit_directive')}
                                                        >
                                                            <Edit2 size={16} />
                                                        </button>
                                                        <button 
                                                            onClick={() => handleDeleteDirective(d)}
                                                            className="p-1.5 hover:bg-red-500/10 text-red-400 rounded-lg transition-colors"
                                                            title={t('dashboard.delete_directive')}
                                                        >
                                                            <Trash2 size={16} />
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                    <DashboardPaginationControls
                                        total={directivesTotal}
                                        limit={DIRECTIVES_LIMIT}
                                        page={directivesPage}
                                        onPageChange={fetchDirectives}
                                        loading={isDirectivesLoading}
                                    />
                                </>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Directive Editor Modal */}
            {editingDirective && (
                <div className="fixed inset-0 z-[var(--z-modal-dropdown)] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in zoom-in duration-300">
                    <div className="bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-3xl w-full max-w-4xl h-[85vh] overflow-hidden flex flex-col shadow-2xl">
                        <div className="p-6 border-b border-[var(--border-primary)] flex items-center justify-between bg-[var(--bg-primary)]/50">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-2xl bg-cyan-500/10 text-cyan-400 flex items-center justify-center">
                                    <Edit2 size={20} />
                                </div>
                                <div>
                                    <h3 className="text-xl font-bold text-[var(--text-primary)] font-gnosi">{t('dashboard.editing')}: {editingDirective.name}</h3>
                                    <p className="text-xs text-[var(--text-secondary)] font-mono opacity-60">{editingDirective.path}</p>
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                <button 
                                    onClick={handleSaveDirective}
                                    disabled={isEditorSaving}
                                    className="flex items-center gap-2 px-4 py-2 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white rounded-xl transition-all shadow-lg active:scale-95 text-sm font-bold"
                                >
                                    {isEditorSaving ? <RefreshCw className="animate-spin" size={16} /> : <Save size={16} />}
                                    {t('common.save_changes')}
                                </button>
                                <button 
                                    onClick={() => setEditingDirective(null)}
                                    className="p-2 hover:bg-[var(--bg-tertiary)] rounded-xl transition-colors text-[var(--text-secondary)]"
                                >
                                    <X size={20} />
                                </button>
                            </div>
                        </div>
                        
                        <div className="flex-1 p-6 flex flex-col gap-4 overflow-hidden bg-[var(--bg-primary)]">
                            <textarea
                                value={editorContent}
                                onChange={(e) => setEditorContent(e.target.value)}
                                className="flex-1 w-full bg-[var(--bg-secondary)] text-[var(--text-primary)] font-mono text-sm p-6 rounded-2xl border border-[var(--border-primary)] focus:border-cyan-500/50 outline-none resize-none shadow-inner"
                                placeholder={t('dashboard.directive_placeholder')}
                                spellCheck="false"
                            />
                            
                            <div className="flex items-center justify-between text-[10px] text-[var(--text-secondary)] px-2">
                                <p>{t('dashboard.directive_tip')}</p>
                                <p>{t('dashboard.chars_lines', { chars: editorContent.length, lines: editorContent.split('\n').length })}</p>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Tools Detail Modal */}
            {aiEnabled && isToolsModalOpen && (
                <div className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-300">
                    <div className="bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-3xl w-full max-w-4xl max-h-[85vh] overflow-hidden flex flex-col shadow-2xl">
                        <div className="p-6 border-b border-[var(--border-primary)] flex items-center justify-between bg-[var(--bg-primary)]/50">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-2xl bg-green-500/10 text-green-400 flex items-center justify-center">
                                    <ShieldCheck size={20} />
                                </div>
                                <div>
                                    <h3 className="text-xl font-bold text-[var(--text-primary)] font-gnosi">{t('dashboard.intelligence_details', "Intelligence Details")}</h3>
                                    <p className="text-xs text-[var(--text-secondary)]">{t('dashboard.tools_and_capabilities', "Tools and Capabilities")}</p>
                                </div>
                            </div>
                            <button 
                                onClick={() => setIsToolsModalOpen(false)}
                                className="p-2 hover:bg-[var(--bg-tertiary)] rounded-xl transition-colors text-[var(--text-secondary)]"
                            >
                                <X size={20} />
                            </button>
                        </div>
                        
                        <div className="flex-1 overflow-y-auto p-6">
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                                <div className="bg-green-500/5 border border-green-500/20 p-4 rounded-2xl text-center">
                                    <span className="text-[var(--text-secondary)] text-[10px] uppercase font-bold tracking-widest block mb-1">{t('dashboard.approved')}</span>
                                    <span className="text-3xl font-black text-green-400">{Math.max(analytics?.tools?.approved || 0, approvedTools.length)}</span>
                                </div>
                                <div className="bg-yellow-500/5 border border-yellow-500/20 p-4 rounded-2xl text-center">
                                    <span className="text-[var(--text-secondary)] text-[10px] uppercase font-bold tracking-widest block mb-1">{t('dashboard.pending')}</span>
                                    <span className="text-3xl font-black text-yellow-400">{Math.max(analytics?.tools?.pending || 0, pendingTools.length)}</span>
                                </div>
                                <div className="bg-blue-500/5 border border-blue-500/20 p-4 rounded-2xl text-center">
                                    <span className="text-[var(--text-secondary)] text-[10px] uppercase font-bold tracking-widest block mb-1">{t('dashboard.last_7_days')}</span>
                                    <span className="text-3xl font-black text-blue-400">
                                        {Math.max(analytics?.tools?.created_last_7_days || 0, approvedTools.filter(t => {
                                            const d = new Date(t.approved_at || t.created_at);
                                            const weekAgo = new Date();
                                            weekAgo.setDate(weekAgo.getDate() - 7);
                                            return d >= weekAgo;
                                        }).length)}
                                    </span>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                <div>
                                    <h4 className="text-sm font-bold text-[var(--text-secondary)] uppercase tracking-widest mb-4 flex items-center gap-2">
                                        <ShieldAlert size={14} className="text-yellow-500" />
                                        {t('dashboard.pending_approval')}
                                    </h4>
                                    <div className="space-y-3 max-h-[40vh] overflow-y-auto pr-2 custom-scrollbar">
                                        {pendingTools.length === 0 ? (
                                            <p className="text-xs text-[var(--text-secondary)] italic py-4">{t('dashboard.no_pending_tools')}</p>
                                        ) : (
                                            pendingTools.map(tool => (
                                                <div key={tool.name} className="p-3 rounded-xl border border-yellow-500/10 bg-[var(--bg-tertiary)]/50">
                                                    <div className="flex items-center justify-between mb-1">
                                                        <span className="text-sm font-bold text-yellow-400 font-gnosi">{tool.name}</span>
                                                        <span className="text-[8px] bg-yellow-500/10 text-yellow-500 px-2 py-0.5 rounded-full font-bold uppercase tracking-widest">{t('dashboard.status_pending')}</span>
                                                    </div>
                                                    <p className="text-[10px] text-[var(--text-secondary)] line-clamp-1 italic">{tool.description}</p>
                                                </div>
                                            ))
                                        )}
                                    </div>
                                </div>
                                <div>
                                    <h4 className="text-sm font-bold text-[var(--text-secondary)] uppercase tracking-widest mb-4 flex items-center gap-2">
                                        <ShieldCheck size={14} className="text-green-500" />
                                        {t('dashboard.recent_approved', "Recently Approved")}
                                    </h4>
                                    <div className="space-y-3 max-h-[40vh] overflow-y-auto pr-2 custom-scrollbar">
                                        {approvedTools.length === 0 ? (
                                            <p className="text-xs text-[var(--text-secondary)] italic py-4">{t('dashboard.no_approved_tools')}</p>
                                        ) : (
                                            approvedTools.slice(0, 10).map(tool => (
                                                <div key={tool.name} className="p-3 rounded-xl border border-blue-500/10 bg-[var(--bg-tertiary)]/50 hover:border-blue-500/30 transition-all flex items-center justify-between group">
                                                    <div className="flex-1">
                                                        <div className="flex items-center justify-between mb-1">
                                                            <span className="text-sm font-bold text-blue-300 font-gnosi">{tool.name}</span>
                                                            <span className="text-[8px] italic text-[var(--text-secondary)]">{tool.approved_at ? new Date(tool.approved_at).toLocaleDateString() : t('dashboard.recent')}</span>
                                                        </div>
                                                        <p className="text-[10px] text-[var(--text-secondary)] line-clamp-1">{tool.description}</p>
                                                    </div>
                                                    {tool.path && (
                                                        <div className="flex gap-1">
                                                            <button 
                                                                onClick={() => handleEditDirective(tool)}
                                                                className="p-2 hover:bg-blue-500/10 text-blue-400 rounded-lg transition-all opacity-0 group-hover:opacity-100"
                                                                title={t('dashboard.edit_skill')}
                                                            >
                                                                <Edit2 size={16} />
                                                            </button>
                                                            <button 
                                                                onClick={() => handleDeleteDirective(tool)}
                                                                className="p-2 hover:bg-red-500/10 text-red-400 rounded-lg transition-all opacity-0 group-hover:opacity-100"
                                                                title={t('dashboard.delete_skill')}
                                                            >
                                                                <Trash2 size={16} />
                                                            </button>
                                                        </div>
                                                    )}
                                                </div>
                                            ))
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Add Member modal */}
            {isAddMemberModalOpen && (
                <div className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-300">
                    <div className="w-full max-w-md bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-2xl shadow-2xl p-6 zoom-in animate-in duration-300">
                        <h3 className="text-xl font-bold text-[var(--text-primary)] mb-4">{t('dashboard.add_new_member')}</h3>
                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">{t('dashboard.user_email')}</label>
                                <input 
                                    type="email"
                                    value={newMemberEmail}
                                    onChange={(e) => setNewMemberEmail(e.target.value)}
                                    className="w-full bg-[var(--bg-tertiary)] border border-[var(--border-primary)] rounded-lg px-4 py-3 text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all"
                                    placeholder={t('dashboard.email_placeholder')}
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">{t('dashboard.initial_role')}</label>
                                <select 
                                    value={newMemberRole}
                                    onChange={(e) => setNewMemberRole(e.target.value)}
                                    className="w-full bg-[var(--bg-tertiary)] border border-[var(--border-primary)] rounded-lg px-4 py-3 text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all"
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
                <div className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-300">
                    <div className="w-full max-w-xl bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-2xl shadow-2xl p-6">
                        <div className="flex items-center justify-between mb-6">
                            <h3 className="text-xl font-bold text-[var(--text-primary)]">{t('dashboard.configure_permissions')}: {selectedMember.name || selectedMember.email}</h3>
                            <button onClick={() => setIsPermissionsModalOpen(false)} className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors">
                                <X size={20} />
                            </button>
                        </div>

                        <div className="space-y-6">
                            <div>
                                <h4 className="text-sm font-bold text-[var(--text-secondary)] uppercase tracking-wider mb-4">{t('dashboard.member_role')}</h4>
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
                                                    : 'bg-[var(--bg-tertiary)] border-[var(--border-primary)] text-[var(--text-secondary)] hover:border-blue-500/20'
                                            }`}
                                        >
                                            <div className="font-bold text-sm uppercase">{role.label}</div>
                                            <div className="text-[10px] opacity-70">{role.desc}</div>
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div>
                                <h4 className="text-sm font-bold text-[var(--text-secondary)] uppercase tracking-wider mb-4">{t('dashboard.system_capabilities')}</h4>
                                <div className="grid grid-cols-2 gap-4">
                                    {[
                                        { id: 'read', label: t('dashboard.cap_read'), icon: <FileText size={16} /> },
                                        { id: 'write', label: t('dashboard.cap_write'), icon: <FileText size={16} /> },
                                        { id: 'delete', label: t('dashboard.cap_delete'), icon: <Bug size={16} /> },
                                        { id: 'admin', label: t('dashboard.cap_admin'), icon: <Users size={16} /> },
                                        { id: 'analytics', label: t('dashboard.cap_analytics'), icon: <Database size={16} /> },
                                        { id: 'tools', label: t('dashboard.cap_tools'), icon: <Layers size={16} /> }
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
                                                        : 'bg-[var(--bg-tertiary)] border-[var(--border-primary)] text-[var(--text-secondary)] hover:border-blue-500/20'
                                                }`}
                                            >
                                                {cap.icon}
                                                <span className="text-sm font-medium">{cap.label}</span>
                                                {hasCap && <Check size={14} className="ml-auto" />}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>

                            <div>
                                <h4 className="text-sm font-bold text-[var(--text-secondary)] uppercase tracking-wider mb-2">{t('dashboard.specific_data_access')}</h4>
                                <p className="text-xs text-[var(--text-secondary)] mb-4 italic">{t('dashboard.limit_access_desc')}</p>
                                
                                {vaultAccessLoading ? (
                                    <div className="text-[var(--text-secondary)] text-xs animate-pulse">{t('dashboard.loading_access')}</div>
                                ) : allVaults.length === 0 ? (
                                    <p className="text-xs text-[var(--text-secondary)]">{t('dashboard.no_vaults')}</p>
                                ) : (
                                    <div className="space-y-2">
                                        {allVaults.map(v => {
                                            const hasAccess = memberVaultAccess.some(acc => acc.vault_id === v.id);
                                            return (
                                                <div key={v.id} className="flex items-center justify-between p-3 bg-[var(--bg-tertiary)] border border-[var(--border-primary)] rounded-xl hover:border-[var(--border-primary)] transition-colors">
                                                    <div className="flex items-center gap-3">
                                                        <Layers size={16} className="text-blue-400/50" />
                                                        <span className="text-sm font-medium text-[var(--text-primary)]">{v.name}</span>
                                                    </div>
                                                    <button 
                                                        onClick={() => toggleVaultAccess(selectedMember.user_id, v.id)}
                                                        className={`px-3 py-1 rounded-lg text-[10px] font-bold uppercase transition-all ${
                                                            hasAccess 
                                                                ? 'bg-green-500/20 text-green-400 border border-green-500/30' 
                                                                : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] border border-[var(--border-primary)] hover:bg-[var(--bg-primary)]'
                                                        }`}
                                                    >
                                                        {hasAccess ? t('dashboard.with_access') : t('dashboard.without_access')}
                                                    </button>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>

                            <div className="flex gap-3 mt-8">
                                <button 
                                    onClick={() => setIsPermissionsModalOpen(false)}
                                    className="px-4 py-3 bg-[var(--bg-tertiary)] hover:bg-[var(--bg-primary)] text-[var(--text-primary)] border border-[var(--border-primary)] rounded-xl transition-all font-medium flex-1"
                                >
                                    {t('common.cancel')}
                                </button>
                                <button 
                                    onClick={() => handleUpdatePermissions(selectedMember.user_id, selectedMember.permissions, selectedMember.role)}
                                    className="px-4 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl transition-all font-medium flex-1 shadow-lg shadow-blue-900/20"
                                >
                                    {t('common.save_changes')}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            <ConfirmModal
                isOpen={confirmDeleteDirective != null}
                onClose={() => setConfirmDeleteDirective(null)}
                onConfirm={doDeleteDirective}
                title={t('common.delete')}
                message={confirmDeleteDirective ? t('dashboard.confirm_delete_item_msg', { type: confirmDeleteDirective.path?.includes("pipeline/skills") ? t('dashboard.type_skill') : t('dashboard.type_directive'), name: confirmDeleteDirective.name }) : ''}
                confirmText={t('common.erase')}
                cancelText={t('common.cancel')}
                isDestructive
            />

            <ConfirmModal
                isOpen={confirmPurgeHistory}
                onClose={() => setConfirmPurgeHistory(false)}
                onConfirm={doPurgeHistory}
                title={t('dashboard.purge_history_title')}
                message={t('dashboard.confirm_purge_history')}
                confirmText={t('common.erase')}
                cancelText={t('common.cancel')}
                isDestructive
            />

            <ConfirmModal
                isOpen={confirmPurgeLogs}
                onClose={() => setConfirmPurgeLogs(false)}
                onConfirm={doPurgeLogs}
                title={t('dashboard.purge_logs_title')}
                message={t('dashboard.confirm_purge_logs')}
                confirmText={t('common.erase')}
                cancelText={t('common.cancel')}
                isDestructive
            />

            <ConfirmModal
                isOpen={confirmDeleteMember != null}
                onClose={() => setConfirmDeleteMember(null)}
                onConfirm={doDeleteMember}
                title={t('dashboard.delete_member_title')}
                message={t('dashboard.confirm_delete_member')}
                confirmText={t('common.erase')}
                cancelText={t('common.cancel')}
                isDestructive
            />
        </div>
    </div>
);
};

export default Dashboard;
