import { useSyncExternalStore } from 'react';
import type { TFunction } from 'i18next';
import { fetchResourceProcessingStatus, findResumableResourceProcessing, startResourceProcessing, type ResourceProcessingJob } from '../../../../shared/api/resource-processing';
import { toast } from '../../../../shared/notifications/toast';
import { resourceProcessingError } from '../../../../shared/notifications/resourceProcessingError';
import { countTouchedPages, getPollingIdentifier, getStartErrorMessage, getTerminalProcessState, POLL_INTERVAL_MS, type ProcessResourceState } from './processResourceModel';

export interface ResourceProcessingTask {
    readonly reprocess?: boolean;
    readonly budgetLimit?: number;
    readonly batchSize?: number;
    readonly estimateId?: string;
    readonly id: string;
    readonly noteId: string;
    readonly sourceTableId?: string;
    readonly title?: string | null;
    readonly job: ResourceProcessingJob | null;
    readonly state: ProcessResourceState;
    readonly error: string;
    readonly background: boolean;
}

type TaskInput = Pick<ResourceProcessingTask, 'reprocess' | 'noteId' | 'sourceTableId' | 'title' | 'budgetLimit' | 'batchSize' | 'estimateId'> & { readonly background?: boolean };
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
        : state === 'error' ? resourceProcessingError(job.error, t) : '';
    // Retain the last known job identity when the server no longer has its status.
    update(id, { ...(unavailable ? {} : { job }), state, error });
    if (state === 'running') return false;
    stop(id);
    if (state === 'done') toast.success(t('llm_wiki.done_toast', { count: countTouchedPages(job), defaultValue: '{{count}} Brain pages updated' }));
    else toast.error(error);
    return true;
}

function watch(id: string, identifier: string, sourceTableId: string | undefined, t: TFunction, poller: Poller, immediately = true): void {
    const poll = async (): Promise<void> => {
        if (pollers.get(id) !== poller || poller.request) return;
        const request = new AbortController();
        poller.request = request;
        try {
            const job = await fetchResourceProcessingStatus(identifier, sourceTableId ?? '', request.signal);
            if (!request.signal.aborted && pollers.get(id) === poller) applyJob(id, job, t);
        } catch { /* A connection failure does not cancel a durable job. */ }
        finally { if (poller.request === request) poller.request = undefined; }
    };
    poller.timer = setInterval(() => { void poll(); }, POLL_INTERVAL_MS);
    if (immediately) void poll();
}

export async function discoverResourceProcessingTask(input: TaskInput, t: TFunction, signal: AbortSignal): Promise<void> {
    const id = processingTaskId(input.noteId, input.sourceTableId);
    if (tasks.some(task => task.id === id && task.state === 'running')) return;
    const job = await findResumableResourceProcessing(input.noteId, input.sourceTableId, signal);
    if (!job || signal.aborted || tasks.some(task => task.id === id && task.state === 'running')) return;
    restoreResourceProcessingTask(input, job, t);
}

export function restoreResourceProcessingTask(input: TaskInput, job: ResourceProcessingJob, t: TFunction): void {
    const id = processingTaskId(input.noteId, input.sourceTableId);
    const state = job.running ? 'running' : getTerminalProcessState(job);
    if (!state || state === 'done' || (input.reprocess && state !== 'running')
        || tasks.some(task => task.id === id && task.state === 'running')) return;
    stop(id);
    tasks = [...tasks.filter(task => task.id !== id), { ...input, id, job, state,
        error: state === 'error' ? resourceProcessingError(job.error, t) : '', background: input.background ?? false }];
    publish();
    if (state === 'running') {
        const poller: Poller = {};
        pollers.set(id, poller);
        watch(id, job.job_id || input.noteId, input.sourceTableId, t, poller, false);
    }
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
        const response = await startResourceProcessing({ force: force && (!previous || input.reprocess === true), resource_id: input.noteId, source_table_id: input.sourceTableId,
            ...(input.budgetLimit !== undefined ? { max_cost_usd: input.budgetLimit } : {}),
            ...(input.batchSize !== undefined ? { batch_size: input.batchSize } : {}),
            ...(input.estimateId ? { estimate_id: input.estimateId } : {}) });
        if (!current()) return;
        if (applyJob(id, response.job, t)) return;
        const identifier = getPollingIdentifier(response, input.noteId);
        watch(id, identifier, input.sourceTableId, t, poller);
    } catch (error: unknown) {
        if (!current()) return;
        stop(id);
        const message = resourceProcessingError(getStartErrorMessage(error,
            t('llm_wiki.error_no_brain_table', { defaultValue: 'No Brain table is configured. Create one in Settings → Plugins → LLM Wiki.' }),
            t('llm_wiki.error_generic', { defaultValue: 'Error processing the resource' })), t);
        update(id, { state: 'error', error: message });
        toast.error(message);
    }
}
