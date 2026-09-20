import type { TFunction } from 'i18next';
import type { SchedulerHistory } from '../../../shared/api/scheduler';

export function systemRunResult(t: TFunction, run: SchedulerHistory['items'][number], name: string): string {
    const message = run.message?.trim() || '';
    const counts = /^Completed: (\d+)\/(\d+) subtasks succeeded\.$/.exec(message);
    if (counts) return t('activity.subtasks_result', { completed: counts[1], total: counts[2] });
    if (['success', 'completed', 'succeeded'].includes(run.status)) {
        if (message && message !== `Task ${run.task_name} completed successfully.`) return message;
        return t('activity.system_completed', { name });
    }
    if (['failed', 'error'].includes(run.status)) return t('activity.system_failed', { name });
    return t('activity.system_pending', { name });
}
