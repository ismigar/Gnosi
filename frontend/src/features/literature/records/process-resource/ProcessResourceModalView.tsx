import type { RefObject } from 'react';
import { ProcessResourcePreflight } from './ProcessResourcePreflight';
import { AlertTriangle, BrainCircuit, CheckCircle2, Loader2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { ResourceProcessingJob, ResourceProcessingEstimate } from '../../../../shared/api/resource-processing';
import {
    countTouchedPages,
    getProcessPhase,
    getProgressPercent,
    isProviderRateLimit,
    type ProcessResourceState,
} from './processResourceModel';


interface ProcessResourceModalViewProps {
    readonly estimate: ResourceProcessingEstimate | null;
    readonly estimateError: string;
    readonly budgetLimit: number;
    readonly onBudgetLimit: (value: number) => void;
    readonly batchSize: number;
    readonly onBatchSize: (value: number) => void;
    readonly canStart: boolean;
    readonly fresh: boolean;
    readonly onReprocess: () => void;
    readonly error: string;
    readonly force: boolean;
    readonly job: ResourceProcessingJob | null;
    readonly modalRef: RefObject<HTMLDivElement | null>;
    readonly onCancel: () => void;
    readonly onDismiss: () => void;
    readonly onStart: () => void;
    readonly state: ProcessResourceState;
    readonly title?: string | null;
}


export function ProcessResourceModalView({
    estimate, estimateError, budgetLimit, onBudgetLimit, batchSize, onBatchSize, canStart,
    fresh, onReprocess,
    error,
    force,
    job,
    modalRef,
    onCancel,
    onDismiss,
    onStart,
    state,
    title,
}: ProcessResourceModalViewProps) {
    const { t } = useTranslation();
    const translate = (
        key: string,
        defaultValue: string,
        values: Readonly<Record<string, string | number>> = {},
    ): string => t(`llm_wiki.${key}`, { defaultValue, ...values });
    const incompatible = (estimate?.incompatible_saved_chunks ?? 0) > 0;
    const phase = getProcessPhase(job);
    const touched = countTouchedPages(job);
    const progress = getProgressPercent(job);
    const created = job?.created ?? [];
    const updated = job?.updated ?? [];
    const warnings = [...new Set(job?.warnings ?? [])];
    const ResultIcon = warnings.length ? AlertTriangle : CheckCircle2;

    return (
        <div
            aria-modal="true"
            aria-label={translate('modal_title', 'Process resource into the Brain')}
            className="fixed inset-0 bg-black/60 flex items-center justify-center z-[var(--z-modal)] p-4 font-sans backdrop-blur-sm"
            role="dialog"
        >
            <div
                ref={modalRef}
                className="bg-[var(--bg-primary)] rounded-xl shadow-2xl w-full max-w-md max-h-[85vh] overflow-hidden flex flex-col border border-[var(--border-primary)]"
                onMouseDown={(event) => {
                    event.stopPropagation();
                }}
            >
                <div className="px-5 py-3 border-b border-[var(--border-primary)] flex justify-between items-center bg-[var(--bg-secondary)] shrink-0">
                    <h2 className="text-base font-bold text-[var(--text-primary)] flex items-center gap-2">
                        <BrainCircuit
                            className="text-[var(--gnosi-primary)]"
                            size={18}
                        />
                        {translate(
                            'modal_title',
                            'Process resource into the Brain',
                        )}
                    </h2>
                    <button
                        aria-label={t('common.close', 'Close')}
                        className="gnosi-close-btn"
                        onClick={onDismiss}
                    >
                        <X />
                    </button>
                </div>

                <div className="p-5 space-y-3 overflow-y-auto min-h-0 min-w-0">
                    {title ? (
                        <p className="text-sm font-semibold text-[var(--text-primary)] truncate">
                            {title}
                        </p>
                    ) : null}

                    {state === 'confirm' ? (
                        <p className="text-xs text-[var(--text-secondary)]/80 leading-relaxed">
                            {translate(
                                'modal_intro',
                                'The agent will read every configured attachment and URL, build a global overview, and review reading notes before saving them to the Brain.',
                            )}
                            {force ? (
                                <span className="block mt-2 font-semibold">
                                    {translate(
                                        'modal_reprocess_intro',
                                        'All configured sources will be processed again without duplicating managed notes.',
                                    )}
                                </span>
                            ) : null}
                        </p>
                    ) : null}

                    {state === 'confirm' || state === 'error' ? (
                        <ProcessResourcePreflight estimate={estimate} estimateError={estimateError}
                            budgetLimit={budgetLimit} onBudgetLimit={onBudgetLimit}
                            batchSize={batchSize} onBatchSize={onBatchSize} />
                    ) : null}

                    {state === 'running' ? (
                        <div className="flex items-center gap-3 rounded-lg border border-[var(--border-primary)] p-3">
                            <Loader2
                                className="text-[var(--gnosi-primary)] animate-spin shrink-0"
                                size={18}
                            />
                            <div className="min-w-0 flex-1">
                                <div className="flex items-center justify-between gap-2 text-sm font-semibold text-[var(--text-primary)]">
                                    <span>{translate(
                                        `phase_${phase.key}`,
                                        phase.defaultLabel,
                                    )}</span>
                                    {progress !== null && <span className="text-[var(--text-secondary)] tabular-nums">{progress}%</span>}
                                </div>
                                {(job?.chunks_total ?? 0) > 0 ? (
                                    <div className="text-xs text-[var(--text-secondary)]/70">
                                        {translate(
                                            'fragments_progress',
                                            '{{count}} of {{total}} fragments completed',
                                            { count: job?.chunks_done ?? 0, total: job?.chunks_total ?? 0 },
                                        )}
                                    </div>
                                ) : null}
                                {touched > 0 ? (
                                    <div className="text-xs text-[var(--text-secondary)]/70">
                                        {translate(
                                            'pages_touched',
                                            '{{count}} pages',
                                            { count: touched },
                                        )}
                                    </div>
                                ) : null}
                                {progress !== null ? (
                                    <div className="mt-2 h-1.5 rounded-full bg-[var(--border-primary)] overflow-hidden"
                                        role="progressbar" aria-label={translate(`phase_${phase.key}`, phase.defaultLabel)}
                                        aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
                                        <div
                                            className="h-full bg-[var(--gnosi-primary)] transition-[width]"
                                            style={{ width: `${String(progress)}%` }}
                                        />
                                    </div>
                                ) : null}
                            </div>
                        </div>
                    ) : null}

                    {state === 'done' ? (
                        <div className={`flex items-start gap-3 rounded-lg border p-3 ${warnings.length ? 'border-[var(--status-warning)]' : 'border-green-500/30 bg-green-500/5'}`}>
                            <ResultIcon
                                className={`shrink-0 mt-0.5 ${warnings.length ? 'text-[var(--status-warning)]' : 'text-green-500'}`}
                                size={18}
                            />
                            <div className="text-xs text-[var(--text-secondary)]">
                                <div className="text-sm font-semibold text-[var(--text-primary)] mb-1">
                                    {translate(
                                        warnings.length ? 'done_with_warnings' : 'done_title',
                                        warnings.length ? 'Saved with observations to review' : 'Resource processed',
                                    )}
                                </div>
                                {created.length > 0 ? (
                                    <div>
                                        {translate('created', 'Created')}: {created.join(', ')}
                                    </div>
                                ) : null}
                                {updated.length > 0 ? (
                                    <div>
                                        {translate('updated', 'Enriched')}: {updated.join(', ')}
                                    </div>
                                ) : null}
                                {warnings.length > 0 ? (
                                    <div className="mt-2">
                                        <div className="font-semibold">
                                            {translate('reading_warnings', 'Reading observations')}
                                        </div>
                                        <ul className="list-disc pl-4">
                                            {warnings.map((warning, index) => (
                                                <li key={`${String(index)}-${warning}`}>{warning}</li>
                                            ))}
                                        </ul>
                                    </div>
                                ) : null}
                            </div>
                        </div>
                    ) : null}

                    {state === 'error' ? (
                        <div className="flex items-start gap-3 rounded-lg border border-red-500/30 bg-red-500/5 p-3">
                            <AlertTriangle
                                className="text-red-500 shrink-0 mt-0.5"
                                size={18}
                            />
                            <div className="text-xs text-red-500 min-w-0 flex-1 [overflow-wrap:anywhere]">
                                {isProviderRateLimit(error) ? translate(
                                    'error_rate_limit',
                                    'The AI provider is limiting requests. Wait a few minutes or check your account limits, then retry.',
                                ) : error}
                                {job?.error && job.error !== error ? (
                                    <details className="mt-2">
                                        <summary>{translate('error_details', 'Technical details')}</summary>
                                        <p className="mt-2 whitespace-pre-wrap">{job.error}</p>
                                    </details>
                                ) : null}
                                {(job?.chunks_done ?? 0) > 0 ? (
                                    <p className="mt-2">
                                        {translate(
                                            'resume_hint',
                                            'Completed fragments are saved and will be reused if the source and processing instructions have not changed.',
                                        )}
                                    </p>
                                ) : null}
                            </div>
                        </div>
                    ) : null}
                </div>

                <div className="px-5 py-3 border-t border-[var(--border-primary)] bg-[var(--bg-secondary)] flex justify-end gap-2">
                    {state === 'confirm' ? (
                        <>
                            <button
                                className="px-4 py-2 border border-[var(--border-primary)] rounded-md text-sm font-bold text-[var(--text-secondary)]/80 hover:bg-[var(--bg-primary)] transition-colors"
                                onClick={onCancel}
                            >
                                {t('common.cancel', 'Cancel')}
                            </button>
                            <button
                                className="px-4 py-2 rounded-md text-sm font-bold text-white bg-[var(--gnosi-primary)] hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
                                disabled={!incompatible && !canStart}
                                data-autofocus="true"
                                onClick={incompatible ? onReprocess : onStart}
                            >
                                {incompatible || fresh ? translate('reprocess', 'Reprocess') : translate('modal_confirm', 'Process')}
                            </button>
                        </>
                    ) : null}
                    {state === 'done' || state === 'error' ? (
                        <button
                            className="px-4 py-2 rounded-md text-sm font-bold text-white bg-[var(--gnosi-primary)] hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
                            onClick={onCancel}
                        >
                            {t('common.close', 'Close')}
                        </button>
                    ) : null}
                    {state === 'error' ? (
                        <button
                            disabled={!incompatible && !canStart}
                            className="px-4 py-2 rounded-md text-sm font-bold text-white bg-[var(--gnosi-primary)] hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
                            onClick={incompatible ? onReprocess : onStart}
                        >
                            {incompatible || fresh ? translate('reprocess', 'Reprocess') : translate('retry', 'Retry')}
                        </button>
                    ) : null}
                    {state === 'running' ? (
                        <span className="text-xs text-[var(--text-secondary)]/60 self-center">
                            {translate(
                                'running_hint',
                                'You can close; follow progress in the corner of the window.',
                            )}
                        </span>
                    ) : null}
                </div>
            </div>
        </div>
    );
}
