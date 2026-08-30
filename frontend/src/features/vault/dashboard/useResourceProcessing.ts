import { useEffect, useEffectEvent } from 'react';
import { fetchBrainTableStatus, fetchLlmWikiConfig } from '../../../shared/api/brain';
import { fetchReferenceTable } from '../../../shared/api/literature-resources';
import { fetchResourceProcessingStatus } from '../../../shared/api/resource-processing';
import { toast } from '../../../shared/notifications/toast';
import { record, readWikiConfig } from './readers';
import type { ResourceJobs } from './types';
import type { DashboardActions } from './useDashboardActions';
export function useResourceProcessing(context: DashboardActions) {
    const { isPluginEnabled, setLlmWikiConfig, setLlmWikiJobs, backgroundLlmWikiJobs, setBackgroundLlmWikiJobs, setRefTableId, setBrainTableId } = context;
    const clearWiki = useEffectEvent(() => { setLlmWikiConfig(null); setLlmWikiJobs({}); });
    useEffect(() => {
        let alive = true;
        if (!isPluginEnabled('llm-wiki')) {
            clearWiki();
            return () => { alive = false; };
        }
        void fetchLlmWikiConfig().then(response => {
            if (!alive)
                return;
            setLlmWikiConfig(readWikiConfig({ ...response.config, processed_resources: response.processed_resources || {} }));
            const statuses = record(response.resource_statuses);
            const jobs: ResourceJobs = {};
            for (const [tableId, resources] of Object.entries(statuses)) {
                jobs[tableId] = Object.fromEntries(Object.entries(record(resources)).map(([id, job]) => [id, record(job)]));
            }
            setLlmWikiJobs(jobs);
        }).catch((error: unknown) => {
            console.warn('Could not load the LLM Wiki configuration:', error);
            if (alive)
                clearWiki();
        });
        return () => { alive = false; };
    }, [isPluginEnabled, setLlmWikiConfig, setLlmWikiJobs]);
    useEffect(() => {
        void fetchReferenceTable().then(status => { setRefTableId(status.table_id || null); }).catch(() => undefined);
        void fetchBrainTableStatus().then(status => { setBrainTableId(status.table_id || null); }).catch(() => undefined);
    }, [setRefTableId, setBrainTableId]);
    const onFinished = useEffectEvent((phase: string | null | undefined, created: number, updated: number, error: string | null | undefined) => {
        if (phase === 'done') {
            toast.success(context.t('llm_wiki.done_toast', '{{count}} Brain pages updated', { count: created + updated }));
            void context.fetchPages();
        }
        else
            toast.error(error || context.t('llm_wiki.error_generic', 'Error processing the resource'));
    });
    useEffect(() => {
        const jobs = Object.values(backgroundLlmWikiJobs);
        if (jobs.length === 0)
            return;
        let alive = true;
        const poll = async () => {
            await Promise.all(jobs.map(async (job) => {
                if (!job.job_id || !job.source_table_id || !job.resource_id)
                    return;
                try {
                    const nextJob = await fetchResourceProcessingStatus(job.job_id, job.source_table_id);
                    if (!alive)
                        return;
                    const tableId = job.source_table_id;
                    const resourceId = job.resource_id;
                    setLlmWikiJobs(current => ({ ...current, [tableId]: { ...current[tableId], [resourceId]: nextJob } }));
                    if (!nextJob.running) {
                        const jobId = job.job_id;
                        setBackgroundLlmWikiJobs(current => {
                            const next = { ...current };
                            Reflect.deleteProperty(next, jobId);
                            return next;
                        });
                        onFinished(nextJob.phase, nextJob.created?.length || 0, nextJob.updated?.length || 0, nextJob.error);
                    }
                }
                catch (error) {
                    console.warn('Could not refresh background LLM Wiki job:', error);
                }
            }));
        };
        void poll();
        const interval = setInterval(() => { void poll(); }, 1500);
        return () => { alive = false; clearInterval(interval); };
    }, [backgroundLlmWikiJobs, setLlmWikiJobs, setBackgroundLlmWikiJobs]);
}
