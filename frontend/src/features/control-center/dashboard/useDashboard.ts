import {useCallback, useEffect, useRef, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {useApi} from '../../../shared/api/use-api';
import {usePlugins} from '../../../shared/plugins/usePlugins';
import {useConfigChanged} from '../../../shared/platform/configEvents';
import toast from '../../../shared/notifications/toast';
import {fetchConfiguration} from '../../../shared/api/configuration';
import type {WorkspaceCatalogEntry} from '../../../shared/api/workspaces';
import type {ScheduledTask} from '../../../shared/api/scheduler';
import {WORKSPACE_ID_STORAGE_KEY, USER_ROLE_STORAGE_KEY} from '../../../shared/api/request-context';
import {readStorage, writeStorage} from '../../../shared/platform/browser-storage';
import {useClearSystemNotifications, useSystemNotifications} from '../../../shared/api/useSystemData';
import {useDashboardSchedulers} from './useDashboardSchedulers';
import {useDashboardMemory} from './useDashboardMemory';
import {useDashboardMembers} from './useDashboardMembers';
import {formatFrequency as formatTaskFrequency} from './model';

export function useDashboard() {
    const {t} = useTranslation();
    const {role: initialRole, apiFetch} = useApi();
    const {isEnabled} = usePlugins();
    const automationsEnabled = isEnabled('automations');
    const aiEnabled = isEnabled('ai-platform');
    const [userRole, setUserRole] = useState(initialRole);
    const isAdmin = userRole === 'admin' || userRole === 'owner';
    const activeWorkspaceId = readStorage(WORKSPACE_ID_STORAGE_KEY) || 'personal';
    const [gnosiMode, setGnosiMode] = useState('personal');
    const [selectedControlTab, setSelectedControlTab] = useState('schedulers');
    const [isReleaseNotesOpen, setIsReleaseNotesOpen] = useState(false);
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const schedulers = useDashboardSchedulers();
    const memory = useDashboardMemory();
    const members = useDashboardMembers(activeWorkspaceId, selectedControlTab, isAdmin);
    const {fetchSchedulers, fetchTaskHistory, taskHistoryPage} = schedulers;
    const {fetchPendingTools, fetchAnalytics, fetchDirectives, fetchTraps} = memory;
    const [notifPage, setNotifPage] = useState(0);
    const NOTIF_LIMIT = 20;
    const {data: notificationPage, isFetching: notificationsLoading, refetch: refetchNotifications} =
        useSystemNotifications({limit: NOTIF_LIMIT, offset: notifPage * NOTIF_LIMIT});
    const clearNotifications = useClearSystemNotifications();
    const notifications = notificationPage?.items || [];
    const notifTotal = notificationPage?.total || 0;
    const [confirmPurgeLogs, setConfirmPurgeLogs] = useState(false);
    const handlePurgeLogs = () => { setConfirmPurgeLogs(true); };
    const doPurgeLogs = async () => {
        setConfirmPurgeLogs(false);
        try {
            await clearNotifications.mutateAsync();
            toast.success(t('dashboard.logs_purged'));
            setNotifPage(0);
        } catch { toast.error(t('dashboard.logs_purge_error')); }
    };
    const fetchConfig = useCallback(async () => {
        try {
            const config = await fetchConfiguration();
            const settings = config.settings;
            if (settings && typeof settings === 'object' && 'gnosi_mode' in settings && typeof settings.gnosi_mode === 'string' && settings.gnosi_mode) {
                setGnosiMode(settings.gnosi_mode);
            }
        } catch { /* Preserve the current mode after a background failure. */ }
    }, []);
    useConfigChanged(useCallback(() => { void fetchConfig(); }, [fetchConfig]));
    useEffect(() => {
        const fetchWorkspaceData = async () => {
            try {
                const workspaces = await apiFetch<WorkspaceCatalogEntry[]>('/api/workspaces');
                const current = workspaces.find(workspace => workspace.id === activeWorkspaceId) || workspaces[0];
                if (current?.role) {
                    writeStorage(USER_ROLE_STORAGE_KEY, current.role);
                    setUserRole(current.role);
                }
            } catch { /* Preserve the current role after a background failure. */ }
        };
        void fetchWorkspaceData();
        void fetchAnalytics();
        void Promise.resolve().then(() => { void fetchDirectives(0); void fetchTraps(0); });

        void Promise.resolve().then(() => { void fetchConfig(); });
        if (aiEnabled) void fetchPendingTools();
        void fetchAnalytics();
        if (automationsEnabled) {
            void Promise.resolve().then(() => { void fetchSchedulers(); void fetchTaskHistory(0); });
        }
        const toolsInterval = aiEnabled ? setInterval(() => { void fetchPendingTools(); }, 15000) : null;
        const schedulersInterval = automationsEnabled ? setInterval(() => { void fetchSchedulers(true); }, 30000) : null;
        return () => {
            if (toolsInterval) clearInterval(toolsInterval);
            if (schedulersInterval) clearInterval(schedulersInterval);
        };
    }, [activeWorkspaceId, apiFetch, automationsEnabled, aiEnabled, fetchAnalytics,
        fetchDirectives, fetchTraps, fetchConfig, fetchPendingTools, fetchSchedulers, fetchTaskHistory]);
    useEffect(() => {
        if (!automationsEnabled || selectedControlTab !== 'history') return;
        const interval = setInterval(() => {
            void fetchTaskHistory(taskHistoryPage);
            void refetchNotifications();
        }, 20000);
        return () => { clearInterval(interval); };
    }, [automationsEnabled, selectedControlTab, taskHistoryPage, fetchTaskHistory, refetchNotifications]);
    useEffect(() => {
        if (!automationsEnabled && ['schedulers', 'history'].includes(selectedControlTab)) {
            void Promise.resolve().then(() => { setSelectedControlTab(isAdmin && gnosiMode === 'org' ? 'admin' : 'overview'); });
        }
    }, [automationsEnabled, gnosiMode, isAdmin, selectedControlTab]);
    const formatFrequency = (task: ScheduledTask) => formatTaskFrequency(task, t);
    const getTaskTitle = (task: ScheduledTask) => {
        const key = `dashboard.tasks.${task.name}.title`;
        const translated = t(key);
        return translated && translated !== key ? translated : task.name.replace(/_/g, ' ');
    };
    const getTaskDescription = (task: ScheduledTask) => {
        const key = `dashboard.tasks.${task.name}.desc`;
        const translated = t(key);
        return translated && translated !== key ? translated : task.description;
    };
    return {...schedulers, ...memory, ...members, t, automationsEnabled, aiEnabled,
        isAdmin, scrollContainerRef, selectedControlTab, setSelectedControlTab, gnosiMode,
        isReleaseNotesOpen, setIsReleaseNotesOpen, notifications, notificationsLoading,
        notifTotal, notifPage, setNotifPage, refetchNotifications, NOTIF_LIMIT,
        confirmPurgeLogs, setConfirmPurgeLogs, handlePurgeLogs, doPurgeLogs,
        formatFrequency, getTaskTitle, getTaskDescription};
}
export type DashboardState = ReturnType<typeof useDashboard>;
