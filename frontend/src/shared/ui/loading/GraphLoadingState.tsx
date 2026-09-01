import { useTranslation } from 'react-i18next';

export interface GraphLoadingStateProps {
    readonly progress?: number | null;
}

export function GraphLoadingState({ progress = null }: GraphLoadingStateProps) {
    const { t } = useTranslation();
    const normalizedProgress = typeof progress === 'number' && Number.isFinite(progress)
        ? Math.min(100, Math.max(0, progress))
        : null;
    const isDeterminate = normalizedProgress !== null;

    return (
        <div
            className="flex h-full flex-col items-center justify-center gap-3 bg-[var(--bg-secondary)] text-[var(--text-primary)]"
            role="status"
            aria-live="polite"
        >
            <div className="text-sm font-medium text-[var(--text-secondary)]">
                {t('graph.loading.title', 'Loading...')}
            </div>
            <div
                className="overflow-hidden rounded-full"
                role="progressbar"
                aria-label={t('graph.loading.progress', 'Graph loading progress')}
                aria-valuemin={isDeterminate ? 0 : undefined}
                aria-valuemax={isDeterminate ? 100 : undefined}
                aria-valuenow={isDeterminate ? Math.round(normalizedProgress) : undefined}
                style={{
                    backgroundColor: 'var(--border-primary)',
                    width: '16rem',
                    height: '0.5rem',
                }}
            >
                <div
                    className={`h-full rounded-full ${isDeterminate ? 'transition-[width] duration-300' : 'animate-pulse'}`}
                    style={{
                        backgroundColor: 'var(--gnosi-blue)',
                        width: isDeterminate ? `${String(normalizedProgress)}%` : '35%',
                        height: '100%',
                    }}
                />
            </div>
        </div>
    );
}
