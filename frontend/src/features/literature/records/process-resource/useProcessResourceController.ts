import { useEffect, useEffectEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { ProcessResourceModalProps } from './processResourceModel';
import { dismissResourceProcessingTask, getResourceProcessingTasks, processingTaskId, setResourceProcessingBackground, startResourceProcessingTask, subscribeResourceProcessingTasks, useResourceProcessingTasks } from './resourceProcessingTasks';

export function useProcessResourceController({ force = false, isOpen, noteId, onClose, onContinueInBackground, onJobUpdate, onProcessed, sourceTableId, title }: ProcessResourceModalProps) {
    const { t } = useTranslation();
    const id = processingTaskId(noteId, sourceTableId);
    const tasks = useResourceProcessingTasks();
    const task = tasks.find(item => item.id === id);
    const reportJob = useEffectEvent((job: NonNullable<typeof task>['job']) => { if (job) onJobUpdate?.(job); });
    const reportDone = useEffectEvent(() => { onProcessed?.(); });
    useEffect(() => {
        setResourceProcessingBackground(id, !isOpen);
        let previousJob = getResourceProcessingTasks().find(item => item.id === id)?.job;
        let previousState = getResourceProcessingTasks().find(item => item.id === id)?.state;
        const unsubscribe = subscribeResourceProcessingTasks(() => {
            const next = getResourceProcessingTasks().find(item => item.id === id);
            if (next?.job && next.job !== previousJob) { previousJob = next.job; reportJob(next.job); }
            if (next?.state === 'done' && previousState !== 'done') reportDone();
            previousState = next?.state;
        });
        return () => { unsubscribe(); setResourceProcessingBackground(id, true); };
    }, [id, isOpen]);
    const dismiss = (): void => {
        if (task?.state === 'running' && task.job?.job_id) onContinueInBackground?.(task.job);
        dismissResourceProcessingTask(id);
        onClose();
    };
    return {
        dismiss,
        error: task?.error ?? '',
        job: task?.job ?? null,
        start: () => startResourceProcessingTask({ noteId, sourceTableId, title }, force, t),
        state: task?.state ?? 'confirm',
    };
}
