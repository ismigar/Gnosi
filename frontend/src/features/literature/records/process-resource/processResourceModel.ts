import type {
    ResourceProcessingJob,
    ResourceProcessingStart,
} from '../../../../shared/api/resource-processing';


export const POLL_INTERVAL_MS = 1500;
export const NO_BRAIN_TABLE_ERROR = 'No Brain table is configured';


export const PHASE_LABELS = {
    done: 'Done',
    error: 'Error',
    indexing: 'Updating indexes and log…',
    partial: 'Interrupted; it can be resumed',
    planning: 'Planning notes with AI…',
    reading: 'Reading the source…',
    retrying: 'Waiting for the AI provider; retrying automatically…',
    writing: 'Writing to the Brain…',
} as const;


export type ProcessResourcePhase = keyof typeof PHASE_LABELS;
export type ProcessResourceState = 'confirm' | 'done' | 'error' | 'running';
export type TerminalProcessState = Extract<
    ProcessResourceState,
    'done' | 'error'
>;


export interface ProcessResourceModalProps {
    readonly force?: boolean;
    readonly isOpen: boolean;
    readonly noteId: string;
    readonly onClose: () => void;
    readonly onContinueInBackground?: (
        job: ResourceProcessingJob,
    ) => unknown;
    readonly onJobUpdate?: (job: ResourceProcessingJob) => unknown;
    readonly onProcessed?: () => unknown;
    readonly sourceTableId?: string;
    readonly title?: string | null;
}


export interface ProcessPhasePresentation {
    readonly defaultLabel: string;
    readonly key: ProcessResourcePhase;
}


function isProcessResourcePhase(
    phase: string | null | undefined,
): phase is ProcessResourcePhase {
    return typeof phase === 'string' && phase in PHASE_LABELS;
}


export function getProcessPhase(
    job: ResourceProcessingJob | null,
): ProcessPhasePresentation {
    const key = isProcessResourcePhase(job?.phase) ? job.phase : 'reading';
    return { defaultLabel: PHASE_LABELS[key], key };
}


export function countTouchedPages(
    job: ResourceProcessingJob | null,
): number {
    return (job?.created?.length ?? 0) + (job?.updated?.length ?? 0);
}


export function isProviderRateLimit(error: string): boolean {
    return /\b429\b|rate[ _-]*limit|insufficient_quota/i.test(error);
}


export function getProgressPercent(
    job: ResourceProcessingJob | null,
): number | null {
    const progress = job?.progress;
    if (typeof progress !== 'number' || !Number.isFinite(progress)) return null;
    return Math.max(0, Math.min(100, progress));
}


export function getTerminalProcessState(
    job: ResourceProcessingJob,
): TerminalProcessState | null {
    if (job.running) return null;
    if (job.phase === 'done') return 'done';
    return job.phase === 'error' || job.phase === 'partial' ? 'error' : null;
}


export function getPollingIdentifier(
    response: ResourceProcessingStart,
    noteId: string,
): string {
    return response.job_id || noteId;
}


export function getStartErrorMessage(
    error: unknown,
    missingTableMessage: string,
    genericMessage: string,
): string {
    const detail = error instanceof Error ? error.message : '';
    if (detail === NO_BRAIN_TABLE_ERROR) return missingTableMessage;
    return detail || genericMessage;
}
