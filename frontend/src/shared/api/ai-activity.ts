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

export type AgentExecutionRun = components['schemas']['AgentRun'];

export async function fetchAgentRuns(signal?: AbortSignal): Promise<AgentExecutionRun[]> {
    return unwrapApiResult<AgentExecutionRun[], unknown>(await apiClient.GET('/api/agent/runs', { signal }));
}

export async function changeAgentRun(runId: string, action: 'cancel' | 'resume'): Promise<AgentExecutionRun> {
    const params = { path: { run_id: runId } };
    const response = action === 'cancel'
        ? await apiClient.POST('/api/agent/runs/{run_id}/cancel', { params })
        : await apiClient.POST('/api/agent/runs/{run_id}/resume', { params });
    return unwrapApiResult<AgentExecutionRun, unknown>(response);
}

export type BehaviorPreview = components['schemas']['BehaviorPreviewResponse'];
export type AgentTracePage = components['schemas']['TracePage'];

export async function previewAgentBehavior(profile: Record<string, unknown>, signal?: AbortSignal): Promise<BehaviorPreview> {
    return unwrapApiResult<BehaviorPreview, unknown>(await apiClient.POST('/api/agent/runs/preview', { body: { profile }, signal }));
}

export async function bindAgentOperation(operation: string, agentId: string, expectedAgentId: string): Promise<void> {
    unwrapApiResult(await apiClient.PUT('/api/agent/runs/bindings/{operation}', {
        params: { path: { operation } }, body: { agent_id: agentId, expected_agent_id: expectedAgentId },
    }));
}

export async function fetchAgentTrace(runId: string, after = 0): Promise<AgentTracePage> {
    return unwrapApiResult<AgentTracePage, unknown>(await apiClient.GET('/api/agent/runs/{run_id}/trace', {
        params: { path: { run_id: runId }, query: { after, limit: 100 } },
    }));
}

export async function agentTraceRetention(days?: number): Promise<number> {
    const response = days === undefined
        ? await apiClient.GET('/api/agent/runs/trace-settings')
        : await apiClient.PUT('/api/agent/runs/trace-settings', { body: { days } });
    return unwrapApiResult<components['schemas']['TraceRetention'], unknown>(response).days;
}

export async function exportAgentTrace(runId: string): Promise<Blob> {
    return unwrapApiResult<Blob, unknown>(await apiClient.GET('/api/agent/runs/{run_id}/trace/export', {
        params: { path: { run_id: runId } }, parseAs: 'blob',
    }));
}

export async function deleteAgentTrace(runId: string): Promise<void> {
    unwrapApiResult(await apiClient.DELETE('/api/agent/runs/{run_id}/trace', { params: { path: { run_id: runId } } }));
}

export type AgentTeamProposal = components['schemas']['RetentionProposal'];
export async function fetchAgentTeamProposals(signal?: AbortSignal): Promise<AgentTeamProposal[]> {
    return unwrapApiResult<AgentTeamProposal[], unknown>(await apiClient.GET('/api/agent/runs/team-proposals', { signal }));
}
export async function decideAgentTeamProposal(proposal: AgentTeamProposal, accept: boolean, instructions: string): Promise<AgentTeamProposal> {
    return unwrapApiResult<AgentTeamProposal, unknown>(await apiClient.POST('/api/agent/runs/{run_id}/team-proposals/{proposal_id}', {
        params: { path: { run_id: proposal.run_id, proposal_id: proposal.id } }, body: { accept, instructions, name: proposal.name },
    }));
}
