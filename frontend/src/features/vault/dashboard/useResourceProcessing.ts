import { useEffect, useEffectEvent } from 'react';
import { fetchBrainTableStatus, fetchLlmWikiConfig } from '../../../shared/api/brain';
import { fetchReferenceTable } from '../../../shared/api/literature-resources';
import { getResourceProcessingTasks, subscribeResourceProcessingTasks } from '../../literature';
import { record, readWikiConfig } from './readers';
import type { ResourceJobs } from './types';
import type { DashboardActions } from './useDashboardActions';
export function useResourceProcessing(context: DashboardActions) {
    const { isPluginEnabled, setLlmWikiConfig, setLlmWikiJobs, setRefTableId, setBrainTableId } = context;
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
    const syncProcessing = useEffectEvent(() => {
        for (const task of getResourceProcessingTasks()) {
            const { job, sourceTableId, noteId } = task;
            if (!job || !sourceTableId) continue;
            setLlmWikiJobs(current => ({ ...current, [sourceTableId]: { ...current[sourceTableId], [noteId]: job } }));
        }
    });
    const refreshPages = useEffectEvent(() => { void context.fetchPages(); });
    useEffect(() => {
        const completed = new Set<string>();
        const sync = () => {
            syncProcessing();
            for (const task of getResourceProcessingTasks()) {
                if (task.state !== 'done') { completed.delete(task.id); continue; }
                if (!completed.has(task.id)) { completed.add(task.id); refreshPages(); }
            }
        };
        sync();
        return subscribeResourceProcessingTasks(sync);
    }, []);
}
