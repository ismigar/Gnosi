import type { RefObject } from 'react';
import { AlertTriangle, BrainCircuit, CheckCircle2, Loader2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { ResourceProcessingJob } from '../../../shared/api/resource-processing';
import {
    countTouchedPages,
    getProcessPhase,
    getProgressPercent,
    type ProcessResourceState,
} from './processResourceModel';


interface ProcessResourceModalViewProps {
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
    const phase = getProcessPhase(job);
    const touched = countTouchedPages(job);
    const progress = getProgressPercent(job);
    const created = job?.created ?? [];
    const updated = job?.updated ?? [];

    return (
        <div
            aria-modal="true"
            className="fixed inset-0 bg-black/60 flex items-center justify-center z-[110] p-4 font-sans backdrop-blur-sm"
            role="dialog"
        >
            <div
                ref={modalRef}
                className="bg-[var(--bg-primary)] rounded-xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col border border-[var(--border-primary)]"
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

                <div className="p-5 space-y-3">
                    {title ? (
                        <p className="text-sm font-semibold text-[var(--text-primary)] truncate">
                            {title}
                        </p>
                    ) : null}

                    {state === 'confirm' ? (
                        <p className="text-xs text-[var(--text-secondary)]/80 leading-relaxed">
                            {translate(
                                'modal_intro',
                                'The AI will process every configured attachment and URL, create atomic notes, and update the Brain indexes.',
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

                    {state === 'running' ? (
                        <div className="flex items-center gap-3 rounded-lg border border-[var(--border-primary)] p-3">
                            <Loader2
                                className="text-[var(--gnosi-primary)] animate-spin shrink-0"
                                size={18}
                            />
                            <div className="min-w-0">
                                <div className="text-sm font-semibold text-[var(--text-primary)]">
                                    {translate(
                                        `phase_${phase.key}`,
                                        phase.defaultLabel,
                                    )}
                                </div>
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
                                    <div className="mt-2 h-1.5 rounded-full bg-[var(--border-primary)] overflow-hidden">
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
                        <div className="flex items-start gap-3 rounded-lg border border-green-500/30 bg-green-500/5 p-3">
                            <CheckCircle2
                                className="text-green-500 shrink-0 mt-0.5"
                                size={18}
                            />
                            <div className="text-xs text-[var(--text-secondary)]">
                                <div className="text-sm font-semibold text-[var(--text-primary)] mb-1">
                                    {translate(
                                        'done_title',
                                        'Resource processed',
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
                            </div>
                        </div>
                    ) : null}

                    {state === 'error' ? (
                        <div className="flex items-start gap-3 rounded-lg border border-red-500/30 bg-red-500/5 p-3">
                            <AlertTriangle
                                className="text-red-500 shrink-0 mt-0.5"
                                size={18}
                            />
                            <div className="text-xs text-red-500 break-words">
                                {error}
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
                                className="px-4 py-2 rounded-md text-sm font-bold text-white bg-[var(--gnosi-primary)] hover:opacity-90 transition-opacity"
                                data-autofocus="true"
                                onClick={onStart}
                            >
                                {translate('modal_confirm', 'Process')}
                            </button>
                        </>
                    ) : null}
                    {state === 'done' || state === 'error' ? (
                        <button
                            className="px-4 py-2 rounded-md text-sm font-bold text-white bg-[var(--gnosi-primary)] hover:opacity-90 transition-opacity"
                            onClick={onCancel}
                        >
                            {t('common.close', 'Close')}
                        </button>
                    ) : null}
                    {state === 'running' ? (
                        <span className="text-xs text-[var(--text-secondary)]/60 self-center">
                            {translate(
                                'running_hint',
                                'You can close; it will continue in the background.',
                            )}
                        </span>
                    ) : null}
                </div>
            </div>
        </div>
    );
}
