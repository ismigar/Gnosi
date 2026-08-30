import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { toast } from '../../../lib/toast';
import {
    fetchResourceProcessingStatus,
    startResourceProcessing,
    type ResourceProcessingJob,
} from '../../../shared/api/resource-processing';
import {
    countTouchedPages,
    getPollingIdentifier,
    getStartErrorMessage,
    getTerminalProcessState,
    POLL_INTERVAL_MS,
    type ProcessResourceModalProps,
    type ProcessResourceState,
} from './processResourceModel';


export interface ProcessResourceController {
    readonly dismiss: () => void;
    readonly error: string;
    readonly job: ResourceProcessingJob | null;
    readonly start: () => Promise<void>;
    readonly state: ProcessResourceState;
}


type ControllerProps = Pick<
    ProcessResourceModalProps,
    | 'force'
    | 'noteId'
    | 'onClose'
    | 'onContinueInBackground'
    | 'onJobUpdate'
    | 'onProcessed'
    | 'sourceTableId'
>;


export function useProcessResourceController({
    force = false,
    noteId,
    onClose,
    onContinueInBackground,
    onJobUpdate,
    onProcessed,
    sourceTableId,
}: ControllerProps): ProcessResourceController {
    const { t } = useTranslation();
    const [state, setState] = useState<ProcessResourceState>('confirm');
    const [job, setJob] = useState<ResourceProcessingJob | null>(null);
    const [error, setError] = useState('');
    const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const jobRef = useRef<ResourceProcessingJob | null>(null);

    const stopPolling = useCallback((): void => {
        if (pollTimerRef.current === null) return;
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
    }, []);

    useEffect(() => () => {
        stopPolling();
    }, [stopPolling]);

    const poll = useCallback(async (identifier: string): Promise<void> => {
        try {
            const nextJob = await fetchResourceProcessingStatus(
                identifier,
                sourceTableId ?? '',
            );
            jobRef.current = nextJob;
            setJob(nextJob);
            onJobUpdate?.(nextJob);

            const terminalState = getTerminalProcessState(nextJob);
            if (terminalState === 'done') {
                stopPolling();
                setState('done');
                toast.success(t('llm_wiki.done_toast', {
                    count: countTouchedPages(nextJob),
                    defaultValue: '{{count}} Brain pages updated',
                }));
                onProcessed?.();
            } else if (terminalState === 'error') {
                stopPolling();
                setError(nextJob.error || t('llm_wiki.error_generic', {
                    defaultValue: 'Error processing the resource',
                }));
                setState('error');
            }
        } catch {
            return;
        }
    }, [onJobUpdate, onProcessed, sourceTableId, stopPolling, t]);

    const start = useCallback(async (): Promise<void> => {
        setState('running');
        setError('');
        try {
            const response = await startResourceProcessing({
                force,
                resource_id: noteId,
                source_table_id: sourceTableId,
            });
            const identifier = getPollingIdentifier(response, noteId);
            const startedJob = response.job;
            jobRef.current = startedJob;
            setJob(startedJob);
            onJobUpdate?.(startedJob);
            stopPolling();
            pollTimerRef.current = setInterval(() => {
                void poll(identifier);
            }, POLL_INTERVAL_MS);
            void poll(identifier);
        } catch (caughtError: unknown) {
            const message = getStartErrorMessage(
                caughtError,
                t('llm_wiki.error_no_brain_table', {
                    defaultValue: 'No Brain table is configured. Create one in Settings → Plugins → LLM Wiki.',
                }),
                t('llm_wiki.error_generic', {
                    defaultValue: 'Error processing the resource',
                }),
            );
            setError(message);
            setState('error');
            toast.error(message);
        }
    }, [force, noteId, onJobUpdate, poll, sourceTableId, stopPolling, t]);

    const dismiss = useCallback((): void => {
        const currentJob = jobRef.current;
        if (state === 'running' && currentJob?.job_id) {
            onContinueInBackground?.(currentJob);
        }
        onClose();
    }, [onClose, onContinueInBackground, state]);

    return { dismiss, error, job, start, state };
}
