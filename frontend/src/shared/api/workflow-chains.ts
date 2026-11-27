import type { components } from '../../generated/openapi';
import { apiClient } from './client';
import { unwrapApiResult } from './errors';

export type WorkflowChainCreate = components['schemas']['WorkflowChainCreate'];
export type WorkflowChainRun = components['schemas']['WorkflowChainRun'];
export type WorkflowChainStepState = components['schemas']['WorkflowChainStepState'];

export async function fetchWorkflowChains(signal?: AbortSignal): Promise<WorkflowChainRun[]> {
  return unwrapApiResult<WorkflowChainRun[], unknown>(await apiClient.GET('/api/agent/runs/chains', { signal }));
}

export async function createWorkflowChain(body: WorkflowChainCreate): Promise<WorkflowChainRun> {
  return unwrapApiResult<WorkflowChainRun, unknown>(await apiClient.POST('/api/agent/runs/chains', { body }));
}

export async function runWorkflowChain(chainId: string): Promise<WorkflowChainRun> {
  return unwrapApiResult<WorkflowChainRun, unknown>(
    await apiClient.POST('/api/agent/runs/chains/{chain_id}/run', { params: { path: { chain_id: chainId } } }),
  );
}

export async function cancelWorkflowChain(chainId: string): Promise<WorkflowChainRun> {
  return unwrapApiResult<WorkflowChainRun, unknown>(
    await apiClient.POST('/api/agent/runs/chains/{chain_id}/cancel', { params: { path: { chain_id: chainId } } }),
  );
}
