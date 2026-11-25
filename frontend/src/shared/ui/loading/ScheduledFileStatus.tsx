import { useTranslation } from 'react-i18next';
import type { ScheduledTask } from '../../api/scheduler';

export function ScheduledFileStatus({ task, className }: { task: ScheduledTask; className?: string }) {
    const { t, i18n } = useTranslation();
    if (!['waiting', 'error'].includes(task.status) || !task.wait_reason) return null;

    const file = task.waiting_file || t('dashboard.cloud_files.file');
    const provider = task.waiting_provider || t('dashboard.cloud_files.provider');
    const message = t(`dashboard.cloud_files.${task.wait_reason}`, {
        file, provider,
        defaultValue: t('dashboard.cloud_files.unavailable', { file, provider }),
    });
    const retry = task.status === 'waiting' && task.retry_at ? new Date(task.retry_at) : null;
    return (
        <p className={className} role="status">
            {message}
            {retry && Number.isFinite(retry.getTime()) && <>
                {' '}
                <time dateTime={task.retry_at ?? undefined}>
                    {t('dashboard.cloud_files.retry', {
                        time: retry.toLocaleString(i18n.resolvedLanguage, { dateStyle: 'short', timeStyle: 'short' }),
                    })}
                </time>
            </>}
        </p>
    );
}
