import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import { estimateResourceProcessing, type ResourceProcessingEstimate } from '../../../../shared/api/resource-processing';
import { useTranslation } from 'react-i18next';
import type { ProcessResourceModalProps } from './processResourceModel';
import { discoverResourceProcessingTask, dismissResourceProcessingTask, getResourceProcessingTasks, processingTaskId, setResourceProcessingBackground, startResourceProcessingTask, subscribeResourceProcessingTasks, useResourceProcessingTasks } from './resourceProcessingTasks';
import { POLL_INTERVAL_MS } from './processResourceModel';

export function useProcessResourceController({ force = false, isOpen, noteId, onClose, onContinueInBackground, onJobUpdate, onProcessed, sourceTableId, title, keepBackground = false }: ProcessResourceModalProps & { readonly keepBackground?: boolean }) {
    const { t } = useTranslation();
    const id = processingTaskId(noteId, sourceTableId);
    const [freshTarget, setFreshTarget] = useState<string | null>(null);
    const reprocess = freshTarget === id;
    const processingForce = force || reprocess;
    const tasks = useResourceProcessingTasks();
    const task = tasks.find(item => item.id === id);
    const [budgetLimit, setBudgetState] = useState(0.50);
    const budgetEdited = useRef(false);
    const setBudgetLimit = (value: number): void => { budgetEdited.current = true; setBudgetState(value); };
    const [batchSize, setBatchSize] = useState(4);
    const hasTask = Boolean(task);
    const taskState = task?.state;
    const statusKey = useMemo(() => Symbol(JSON.stringify([isOpen, id])), [isOpen, id]);
    const [statusChecked, setStatusChecked] = useState<symbol | null>(null);
    const checkingStatus = isOpen && !hasTask && statusChecked !== statusKey;
    useEffect(() => {
        if (!isOpen || taskState === 'running') return;
        const request = new AbortController();
        let pending = false;
        const active = (): boolean => !request.signal.aborted;
        const discover = async (): Promise<void> => {
            if (pending || !active()) return;
            pending = true;
            try { await discoverResourceProcessingTask({ noteId, sourceTableId, title }, t, request.signal); }
            catch { /* Retry discovery while the dialog remains open. */ }
            finally {
                pending = false;
                if (active()) setStatusChecked(statusKey);
            }
        };
        void discover();
        if (hasTask) return () => { request.abort(); };
        const timer = setInterval(() => { void discover(); }, POLL_INTERVAL_MS);
        return () => { request.abort(); clearInterval(timer); };
    }, [isOpen, taskState, hasTask, noteId, sourceTableId, title, t, statusKey]);
    const needsEstimate = isOpen && !checkingStatus && (!task || task.state === 'error');
    const estimateKey = useMemo(() => Symbol(JSON.stringify([isOpen, noteId, sourceTableId, processingForce, reprocess, batchSize, hasTask, taskState])), [isOpen, noteId, sourceTableId, processingForce, reprocess, batchSize, hasTask, taskState]);
    const [preflight, setPreflight] = useState<{ key: symbol; result: ResourceProcessingEstimate | null; error: string } | null>(null);
    const estimate = preflight?.key === estimateKey ? preflight.result : null;
    const estimateError = preflight?.key === estimateKey ? preflight.error : '';
    useEffect(() => {
        if (!needsEstimate) return;
        const request = new AbortController();
        void estimateResourceProcessing({ resource_id: noteId, source_table_id: sourceTableId,
            force: reprocess || (force && !hasTask), batch_size: batchSize }, request.signal).then(result => {
            if (!request.signal.aborted) {
                setPreflight({ key: estimateKey, result, error: '' });
                if (result.budget && !budgetEdited.current) setBudgetState(result.budget.limit_usd);
            }
        }).catch(() => {
            if (!request.signal.aborted) setPreflight({ key: estimateKey, result: null, error: t('llm_wiki.estimate_failed') });
        });
        return () => { request.abort(); };
    }, [needsEstimate, noteId, sourceTableId, force, reprocess, batchSize, hasTask, estimateKey, t]);
    const canStart = !checkingStatus && taskState !== 'running' && Boolean(estimate?.priced) && !(estimate?.incompatible_saved_chunks ?? 0) && Number.isFinite(budgetLimit) && budgetLimit > 0 && budgetLimit <= 1000;
    const reportJob = useEffectEvent((job: NonNullable<typeof task>['job']) => { if (job) onJobUpdate?.(job); });
    const reportDone = useEffectEvent(() => { onProcessed?.(); });
    useEffect(() => {
        if (!keepBackground) setResourceProcessingBackground(id, !isOpen);
        let previousJob = getResourceProcessingTasks().find(item => item.id === id)?.job;
        let previousState = getResourceProcessingTasks().find(item => item.id === id)?.state;
        const unsubscribe = subscribeResourceProcessingTasks(() => {
            const next = getResourceProcessingTasks().find(item => item.id === id);
            if (next?.job && next.job !== previousJob) { previousJob = next.job; reportJob(next.job); }
            if (next?.state === 'done' && previousState !== 'done') reportDone();
            previousState = next?.state;
        });
        return () => { unsubscribe(); if (!keepBackground) setResourceProcessingBackground(id, true); };
    }, [id, isOpen, keepBackground]);
    const dismiss = (): void => {
        setFreshTarget(null);
        if (task?.state === 'running' && task.job?.job_id) onContinueInBackground?.(task.job);
        dismissResourceProcessingTask(id);
        onClose();
    };
    return {
        dismiss,
        reprocess: () => { if (task?.state !== 'running') setFreshTarget(id); },
        force: processingForce,
        fresh: reprocess,
        error: task?.error ?? '',
        job: task?.job ?? null,
        estimate, estimateError, budgetLimit, setBudgetLimit, batchSize, setBatchSize, canStart,
        start: () => {
            if (!canStart) return Promise.resolve();
            setFreshTarget(null);
            return startResourceProcessingTask({ noteId, sourceTableId, title, reprocess,
                budgetLimit, batchSize, estimateId: estimate?.estimate_id }, processingForce, t);
        },
        state: task?.state ?? 'confirm',
    };
}
