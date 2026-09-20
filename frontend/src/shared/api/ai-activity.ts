import type { components } from '../../generated/openapi';
import { apiClient } from './client';
import { unwrapApiResult } from './errors';

export type AutomationRun = components['schemas']['ActivityAutomationRunResponse'];
export type AutomationRunPage = components['schemas']['ActivityAutomationRunsResponse'];

export async function fetchAutomationRuns(offset = 0, automationId = '', signal?: AbortSignal): Promise<AutomationRunPage> {
    return unwrapApiResult<AutomationRunPage, unknown>(await apiClient.GET('/api/ai/automation-runs', {
        params: { query: { limit: 50, offset, ...(automationId ? { automation_id: automationId } : {}) } },
        signal,
    }));
}

export async function readActivityJobResult(jobId: string): Promise<components['schemas']['CapabilityJobResultResponse']> {
    return unwrapApiResult<components['schemas']['CapabilityJobResultResponse'], unknown>(await apiClient.GET('/api/ai/jobs/{job_id}/result', {
        params: { path: { job_id: jobId } },
    }));
}

export async function changeActivityJob(jobId: string, action: 'cancel' | 'resume'): Promise<components['schemas']['CapabilityJobResponse']> {
    const params = { path: { job_id: jobId } };
    const result = action === 'cancel'
        ? await apiClient.POST('/api/ai/jobs/{job_id}/cancel', { params })
        : await apiClient.POST('/api/ai/jobs/{job_id}/resume', { params });
    return unwrapApiResult<components['schemas']['CapabilityJobResponse'], unknown>(result);
}
