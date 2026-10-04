import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import { estimateResourceProcessing, type ResourceProcessingEstimate } from '../../../../shared/api/resource-processing';
import { useTranslation } from 'react-i18next';
import type { ProcessResourceModalProps } from './processResourceModel';
import { dismissResourceProcessingTask, getResourceProcessingTasks, processingTaskId, setResourceProcessingBackground, startResourceProcessingTask, subscribeResourceProcessingTasks, useResourceProcessingTasks } from './resourceProcessingTasks';

export function useProcessResourceController({ force = false, isOpen, noteId, onClose, onContinueInBackground, onJobUpdate, onProcessed, sourceTableId, title, keepBackground = false }: ProcessResourceModalProps & { readonly keepBackground?: boolean }) {
    const { t } = useTranslation();
    const id = processingTaskId(noteId, sourceTableId);
    const tasks = useResourceProcessingTasks();
    const task = tasks.find(item => item.id === id);
    const [budgetLimit, setBudgetState] = useState(0.50);
    const budgetEdited = useRef(false);
    const setBudgetLimit = (value: number): void => { budgetEdited.current = true; setBudgetState(value); };
    const [batchSize, setBatchSize] = useState(4);
    const hasTask = Boolean(task);
    const taskState = task?.state;
    const needsEstimate = isOpen && (!task || task.state === 'error');
    const estimateKey = useMemo(() => Symbol(JSON.stringify([isOpen, noteId, sourceTableId, force, batchSize, hasTask, taskState])), [isOpen, noteId, sourceTableId, force, batchSize, hasTask, taskState]);
    const [preflight, setPreflight] = useState<{ key: symbol; result: ResourceProcessingEstimate | null; error: string } | null>(null);
    const estimate = preflight?.key === estimateKey ? preflight.result : null;
    const estimateError = preflight?.key === estimateKey ? preflight.error : '';
    useEffect(() => {
        if (!needsEstimate) return;
        const request = new AbortController();
        void estimateResourceProcessing({ resource_id: noteId, source_table_id: sourceTableId,
            force: force && !hasTask, batch_size: batchSize }, request.signal).then(result => {
            if (!request.signal.aborted) {
                setPreflight({ key: estimateKey, result, error: '' });
                if (result.budget && !budgetEdited.current) setBudgetState(result.budget.limit_usd);
            }
        }).catch(() => {
            if (!request.signal.aborted) setPreflight({ key: estimateKey, result: null, error: t('llm_wiki.estimate_failed') });
        });
        return () => { request.abort(); };
    }, [needsEstimate, noteId, sourceTableId, force, batchSize, hasTask, estimateKey, t]);
    const canStart = Boolean(estimate?.priced) && !(estimate?.incompatible_saved_chunks ?? 0) && Number.isFinite(budgetLimit) && budgetLimit > 0 && budgetLimit <= 1000;
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
        if (task?.state === 'running' && task.job?.job_id) onContinueInBackground?.(task.job);
        dismissResourceProcessingTask(id);
        onClose();
    };
    return {
        dismiss,
        error: task?.error ?? '',
        job: task?.job ?? null,
        estimate, estimateError, budgetLimit, setBudgetLimit, batchSize, setBatchSize, canStart,
        start: () => canStart ? startResourceProcessingTask({ noteId, sourceTableId, title,
            budgetLimit, batchSize, estimateId: estimate?.estimate_id }, force, t) : Promise.resolve(),
        state: task?.state ?? 'confirm',
    };
}
