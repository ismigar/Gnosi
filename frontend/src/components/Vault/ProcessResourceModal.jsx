import React, { useEffect, useRef, useState } from 'react';
import axios from '../../shared/api/legacy-http';
import { useTranslation } from 'react-i18next';
import { X, BrainCircuit, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';
import { toast } from '../../lib/toast';
import { useModalKeyboard } from '../../hooks/useModalKeyboard';

// Trigger an LLM Wiki (Brain) ingest for one resource row and poll its
// background job, showing the phase and how many Brain pages were touched.
// Unlike the sync/translate modals, the work is async on the backend: this
// modal starts it and polls `/api/vault/llm-wiki/status/{id}` until it settles.
const PHASE_LABELS = {
    reading: ['reading', 'Reading the source…'],
    planning: ['planning', 'Planning notes with AI…'],
    writing: ['writing', 'Writing to the Brain…'],
    indexing: ['indexing', 'Updating indexes and log…'],
    done: ['done', 'Done'],
    partial: ['partial', 'Interrupted; it can be resumed'],
    error: ['error', 'Error'],
};

const POLL_MS = 1500;
const NO_BRAIN_TABLE_ERROR = 'No Brain table is configured';

export function ProcessResourceModal({
    isOpen,
    onClose,
    noteId,
    title,
    sourceTableId,
    force = false,
    onJobUpdate,
    onProcessed,
    onContinueInBackground,
}) {
    const { t } = useTranslation();
    const tp = (k, def, opts) => t(`llm_wiki.${k}`, { defaultValue: def, ...(opts || {}) });
    const [state, setState] = useState('confirm'); // confirm | running | done | error
    const [job, setJob] = useState(null);
    const [error, setError] = useState('');
    const pollRef = useRef(null);
    const modalRef = useRef(null);
    const jobRef = useRef(null);

    const stopPolling = () => {
        if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    };

    const localizeStartError = (err) => {
        const detail = err.response?.data?.detail;
        if (detail === NO_BRAIN_TABLE_ERROR) {
            return tp('error_no_brain_table', 'No Brain table is configured. Create one in Settings → Plugins → LLM Wiki.');
        }
        return detail || err.message || tp('error_generic', 'Error processing the resource');
    };

    useEffect(() => () => stopPolling(), []);

    const poll = async (identifier) => {
        try {
            const res = await axios.get(
                `/api/vault/llm-wiki/status/${encodeURIComponent(identifier)}`,
                { params: sourceTableId ? { source_table_id: sourceTableId } : undefined },
            );
            const j = res.data || {};
            jobRef.current = j;
            setJob(j);
            onJobUpdate?.(j);
            if (j.phase === 'done' && !j.running) {
                stopPolling();
                setState('done');
                const n = (j.created?.length || 0) + (j.updated?.length || 0);
                toast.success(tp('done_toast', "{{count}} Brain pages updated", { count: n }));
                onProcessed?.();
            } else if (['error', 'partial'].includes(j.phase) && !j.running) {
                stopPolling();
                setError(j.error || tp('error_generic', "Error processing the resource"));
                setState('error');
            }
        } catch (err) {
            // Transient poll failure — keep trying; a hard failure surfaces via phase=error.
            console.warn('llm-wiki poll error:', err);
        }
    };

    const start = async () => {
        setState('running');
        setError('');
        try {
            const response = await axios.post('/api/vault/llm-wiki/process', {
                resource_id: noteId,
                source_table_id: sourceTableId,
                force,
            });
            const nextJobId = response.data?.job_id || noteId;
            const startedJob = response.data?.job || null;
            jobRef.current = startedJob;
            setJob(startedJob);
            if (startedJob) onJobUpdate?.(startedJob);
            stopPolling();
            pollRef.current = setInterval(() => poll(nextJobId), POLL_MS);
            poll(nextJobId);
        } catch (err) {
            const msg = localizeStartError(err);
            setError(msg);
            setState('error');
            toast.error(msg);
        }
    };

    const dismiss = () => {
        const currentJob = jobRef.current;
        if (state === 'running' && currentJob?.job_id) {
            onContinueInBackground?.(currentJob);
        }
        onClose();
    };

    useModalKeyboard({
        isOpen,
        onClose: dismiss,
        onConfirm: () => { if (state === 'confirm') start(); },
        confirmDisabled: state !== 'confirm',
        containerRef: modalRef,
        trapFocus: true,
    });

    if (!isOpen) return null;

    const phaseKey = job?.phase && PHASE_LABELS[job.phase] ? job.phase : 'reading';
    const [, phaseDefault] = PHASE_LABELS[phaseKey];
    const touched = (job?.created?.length || 0) + (job?.updated?.length || 0);

    return (
        <div
            className="fixed inset-0 bg-black/60 flex items-center justify-center z-[110] p-4 font-sans backdrop-blur-sm"
            role="dialog"
            aria-modal="true"
        >
            <div
                ref={modalRef}
                onMouseDown={(e) => e.stopPropagation()}
                className="bg-[var(--bg-primary)] rounded-xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col border border-[var(--border-primary)]"
            >
                <div className="px-5 py-3 border-b border-[var(--border-primary)] flex justify-between items-center bg-[var(--bg-secondary)] shrink-0">
                    <h2 className="text-base font-bold text-[var(--text-primary)] flex items-center gap-2">
                        <BrainCircuit size={18} className="text-[var(--gnosi-primary)]" />
                        {tp('modal_title', "Process resource into the Brain")}
                    </h2>
                    <button onClick={dismiss} className="gnosi-close-btn" aria-label={t('common.close', "Close")}>
                        <X />
                    </button>
                </div>

                <div className="p-5 space-y-3">
                    {title && (
                        <p className="text-sm font-semibold text-[var(--text-primary)] truncate">{title}</p>
                    )}

                    {state === 'confirm' && (
                        <p className="text-xs text-[var(--text-secondary)]/80 leading-relaxed">
                            {tp('modal_intro', "The AI will process every configured attachment and URL, create atomic notes, and update the Brain indexes.")}
                            {force && (
                                <span className="block mt-2 font-semibold">
                                    {tp('modal_reprocess_intro', "All configured sources will be processed again without duplicating managed notes.")}
                                </span>
                            )}
                        </p>
                    )}

                    {state === 'running' && (
                        <div className="flex items-center gap-3 rounded-lg border border-[var(--border-primary)] p-3">
                            <Loader2 size={18} className="text-[var(--gnosi-primary)] animate-spin shrink-0" />
                            <div className="min-w-0">
                                <div className="text-sm font-semibold text-[var(--text-primary)]">
                                    {tp(`phase_${phaseKey}`, phaseDefault)}
                                </div>
                                {touched > 0 && (
                                    <div className="text-xs text-[var(--text-secondary)]/70">
                                        {tp('pages_touched', "{{count}} pages", { count: touched })}
                                    </div>
                                )}
                                {Number.isFinite(job?.progress) && (
                                    <div className="mt-2 h-1.5 rounded-full bg-[var(--border-primary)] overflow-hidden">
                                        <div
                                            className="h-full bg-[var(--gnosi-primary)] transition-[width]"
                                            style={{ width: `${Math.max(0, Math.min(100, job.progress))}%` }}
                                        />
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {state === 'done' && (
                        <div className="flex items-start gap-3 rounded-lg border border-green-500/30 bg-green-500/5 p-3">
                            <CheckCircle2 size={18} className="text-green-500 shrink-0 mt-0.5" />
                            <div className="text-xs text-[var(--text-secondary)]">
                                <div className="text-sm font-semibold text-[var(--text-primary)] mb-1">
                                    {tp('done_title', "Resource processed")}
                                </div>
                                {(job?.created?.length || 0) > 0 && (
                                    <div>{tp('created', "Created")}: {job.created.join(', ')}</div>
                                )}
                                {(job?.updated?.length || 0) > 0 && (
                                    <div>{tp('updated', "Enriched")}: {job.updated.join(', ')}</div>
                                )}
                            </div>
                        </div>
                    )}

                    {state === 'error' && (
                        <div className="flex items-start gap-3 rounded-lg border border-red-500/30 bg-red-500/5 p-3">
                            <AlertTriangle size={18} className="text-red-500 shrink-0 mt-0.5" />
                            <div className="text-xs text-red-500 break-words">{error}</div>
                        </div>
                    )}
                </div>

                <div className="px-5 py-3 border-t border-[var(--border-primary)] bg-[var(--bg-secondary)] flex justify-end gap-2">
                    {state === 'confirm' && (
                        <>
                            <button
                                onClick={onClose}
                                className="px-4 py-2 border border-[var(--border-primary)] rounded-md text-sm font-bold text-[var(--text-secondary)]/80 hover:bg-[var(--bg-primary)] transition-colors"
                            >
                                {t('common.cancel', "Cancel")}
                            </button>
                            <button
                                data-autofocus="true"
                                onClick={start}
                                className="px-4 py-2 rounded-md text-sm font-bold text-white bg-[var(--gnosi-primary)] hover:opacity-90 transition-opacity"
                            >
                                {tp('modal_confirm', "Process")}
                            </button>
                        </>
                    )}
                    {(state === 'done' || state === 'error') && (
                        <button
                            onClick={onClose}
                            className="px-4 py-2 rounded-md text-sm font-bold text-white bg-[var(--gnosi-primary)] hover:opacity-90 transition-opacity"
                        >
                            {t('common.close', "Close")}
                        </button>
                    )}
                    {state === 'running' && (
                        <span className="text-xs text-[var(--text-secondary)]/60 self-center">
                            {tp('running_hint', "You can close; it will continue in the background.")}
                        </span>
                    )}
                </div>
            </div>
        </div>
    );
}
