import { useSyncExternalStore } from 'react';
import type { TFunction } from 'i18next';
import { fetchResourceProcessingStatus, startResourceProcessing, type ResourceProcessingJob } from '../../../../shared/api/resource-processing';
import { toast } from '../../../../shared/notifications/toast';
import { countTouchedPages, getPollingIdentifier, getStartErrorMessage, getTerminalProcessState, POLL_INTERVAL_MS, type ProcessResourceState } from './processResourceModel';

export interface ResourceProcessingTask {
    readonly id: string;
    readonly noteId: string;
    readonly sourceTableId?: string;
    readonly title?: string | null;
    readonly job: ResourceProcessingJob | null;
    readonly state: ProcessResourceState;
    readonly error: string;
    readonly background: boolean;
}

type TaskInput = Pick<ResourceProcessingTask, 'noteId' | 'sourceTableId' | 'title'>;
interface Poller {
    timer?: ReturnType<typeof setInterval>;
    request?: AbortController;
}
let tasks: readonly ResourceProcessingTask[] = [];
const listeners = new Set<() => void>();
const pollers = new Map<string, Poller>();

export const processingTaskId = (noteId: string, sourceTableId?: string): string => JSON.stringify([sourceTableId ?? '', noteId]);
export const getResourceProcessingTasks = (): readonly ResourceProcessingTask[] => tasks;
export function subscribeResourceProcessingTasks(listener: () => void): () => void {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}
export function useResourceProcessingTasks(): readonly ResourceProcessingTask[] {
    return useSyncExternalStore(subscribeResourceProcessingTasks, getResourceProcessingTasks);
}
function publish(): void { listeners.forEach(listener => { listener(); }); }
function update(id: string, patch: Partial<ResourceProcessingTask>): void {
    tasks = tasks.map(task => task.id === id ? { ...task, ...patch } : task);
    publish();
}
function stop(id: string): void {
    const poller = pollers.get(id);
    if (poller?.timer) clearInterval(poller.timer);
    poller?.request?.abort();
    pollers.delete(id);
}
export function setResourceProcessingBackground(id: string, background: boolean): void {
    if (tasks.some(task => task.id === id && task.background !== background)) update(id, { background });
}
export function dismissResourceProcessingTask(id: string): void {
    const task = tasks.find(item => item.id === id);
    if (task?.state === 'running') { setResourceProcessingBackground(id, true); return; }
    stop(id);
    tasks = tasks.filter(item => item.id !== id);
    publish();
}
export function resetResourceProcessingTasks(): void {
    for (const id of pollers.keys()) stop(id);
    tasks = [];
    publish();
}

function applyJob(id: string, job: ResourceProcessingJob, t: TFunction): boolean {
    const unavailable = job.phase === 'idle';
    const state = unavailable ? 'error' : getTerminalProcessState(job) ?? 'running';
    const error = unavailable
        ? t('llm_wiki.job_unavailable', { defaultValue: 'The processing status is unavailable. Retry to resume saved progress.' })
        : state === 'error' ? job.error || t('llm_wiki.error_generic', { defaultValue: 'Error processing the resource' }) : '';
    // Retain the last known job identity when the server no longer has its status.
    update(id, { ...(unavailable ? {} : { job }), state, error });
    if (state === 'running') return false;
    stop(id);
    if (state === 'done') toast.success(t('llm_wiki.done_toast', { count: countTouchedPages(job), defaultValue: '{{count}} Brain pages updated' }));
    else toast.error(error);
    return true;
}

export async function startResourceProcessingTask(input: TaskInput, force: boolean, t: TFunction): Promise<void> {
    const id = processingTaskId(input.noteId, input.sourceTableId);
    const previous = tasks.find(task => task.id === id);
    if (previous?.state === 'running') return;
    stop(id);
    // The store owns pending starts and polling so closing or navigating cannot lose them.
    const poller: Poller = {};
    pollers.set(id, poller);
    const task: ResourceProcessingTask = { ...input, id, job: previous?.job ?? null, state: 'running', error: '', background: previous?.background ?? false };
    tasks = [...tasks.filter(item => item.id !== id), task];
    publish();
    const current = (): boolean => pollers.get(id) === poller;
    try {
        const response = await startResourceProcessing({ force: force && !previous, resource_id: input.noteId, source_table_id: input.sourceTableId });
        if (!current()) return;
        if (applyJob(id, response.job, t)) return;
        const identifier = getPollingIdentifier(response, input.noteId);
        const poll = async (): Promise<void> => {
            if (!current() || poller.request) return;
            const request = new AbortController();
            poller.request = request;
            try {
                const job = await fetchResourceProcessingStatus(identifier, input.sourceTableId ?? '', request.signal);
                if (!request.signal.aborted && current()) applyJob(id, job, t);
            } catch {
                // A transient connection failure does not cancel a durable backend job.
            } finally {
                if (poller.request === request) poller.request = undefined;
            }
        };
        poller.timer = setInterval(() => { void poll(); }, POLL_INTERVAL_MS);
        void poll();
    } catch (error: unknown) {
        if (!current()) return;
        stop(id);
        const message = getStartErrorMessage(error,
            t('llm_wiki.error_no_brain_table', { defaultValue: 'No Brain table is configured. Create one in Settings → Plugins → LLM Wiki.' }),
            t('llm_wiki.error_generic', { defaultValue: 'Error processing the resource' }));
        update(id, { state: 'error', error: message });
        toast.error(message);
    }
}
