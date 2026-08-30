import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import toast from '../../../lib/toast';
import { clearSchedulerHistory, fetchScheduledTasks, fetchSchedulerHistory, runScheduledTask, updateScheduledTask, type ScheduledTask, type ScheduledTaskUpdate, type SchedulerHistory } from '../../../shared/api/scheduler';
export function useDashboardSchedulers() {
const {t} = useTranslation();
    const [schedulers, setSchedulers] = useState<ScheduledTask[]>([]);
    const [schedulerLoading, setSchedulerLoading] = useState(true);
    const [taskHistory, setTaskHistory] = useState<SchedulerHistory["items"]>([]);
    const [taskHistoryTotal, setTaskHistoryTotal] = useState(0);
    const [taskHistoryPage, setTaskHistoryPage] = useState(0);
    const HISTORY_LIMIT = 15;
    const [taskHistoryLoading, setTaskHistoryLoading] = useState(false);
    const [executingTasks, setExecutingTasks] = useState(new Set<string>());
    const [confirmPurgeHistory, setConfirmPurgeHistory] = useState(false);
    const fetchSchedulers = useCallback(async (silent = false) => {
        await Promise.resolve();
        if (!silent) setSchedulerLoading(true);
        try {
            setSchedulers(await fetchScheduledTasks());
        } catch { /* Keep the last successful data on background failures. */ } finally {
            if (!silent) setSchedulerLoading(false);
        }
    }, []);
    const fetchTaskHistory = useCallback(async (p = 0) => {
        await Promise.resolve();
        const page = typeof p === 'number' ? p : 0;
        setTaskHistoryLoading(true);
        try {
            const offset = page * HISTORY_LIMIT;
            const data = await fetchSchedulerHistory({ limit: HISTORY_LIMIT, offset });
            setTaskHistory(data.items);
            setTaskHistoryTotal(data.total);
            setTaskHistoryPage(page);
        } catch { /* Keep the last successful data on background failures. */ } finally {
            setTaskHistoryLoading(false);
        }
    }, []);
    const handlePurgeHistory = () => { setConfirmPurgeHistory(true); };

    const doPurgeHistory = async () => {
        setConfirmPurgeHistory(false);
        try {
            await clearSchedulerHistory();
            toast.success(t('dashboard.history_purged'));
            void fetchTaskHistory(0);
        } catch {
            toast.error(t('dashboard.history_purge_error'));
        }
    };
    const updateScheduler = async (task: ScheduledTask, overrides: Partial<ScheduledTaskUpdate>) => {
        try {
            await updateScheduledTask({
                name: task.name,
                update: {
                    interval_minutes: overrides.interval_minutes ?? task.interval_minutes,
                    enabled: overrides.enabled ?? task.enabled,
                },
            });
            void fetchSchedulers(true);
        } catch { /* Keep the last successful data on background failures. */ }
    };

    const runSchedulerNow = async (taskName: string) => {
        if (executingTasks.has(taskName)) return;

        setExecutingTasks(prev => new Set(prev).add(taskName));
        const t_id = toast.loading(`${t('dashboard.running_task', "Running task")} ${taskName.replace(/_/g, ' ')}...`);

        try {
            await runScheduledTask(taskName);
            toast.success(t('dashboard.task_started', "Task started successfully"), { id: t_id });
            // We refresh after a short delay so the backend has processed the state change to "running"
            setTimeout(() => { void fetchSchedulers(true); }, 500);
        } catch (e) {
            toast.error(`${t('dashboard.run_error', "Run error")}: ${e instanceof Error ? e.message : String(e)}`, { id: t_id });
        } finally {
            setExecutingTasks(prev => {
                const next = new Set(prev);
                next.delete(taskName);
                return next;
            });
        }
    };


return { schedulers, schedulerLoading, taskHistory, taskHistoryTotal, taskHistoryPage, taskHistoryLoading, HISTORY_LIMIT, executingTasks, fetchSchedulers, fetchTaskHistory, updateScheduler, runSchedulerNow, confirmPurgeHistory, setConfirmPurgeHistory, handlePurgeHistory, doPurgeHistory };
}
