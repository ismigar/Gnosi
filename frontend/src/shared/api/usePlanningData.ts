import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { GnosiApiError } from './errors';
import { getActiveVaultId } from './vault-context';

import {
  applyPlanningLevelingProposal,
  createPlanningBaseline,
  createPlanningLevelingProposal,
  createPlanningWorklog,
  fetchPlanningAllocation,
  fetchPlanningBaselines,
  fetchPlanningState,
  fetchPlanningWorklogs,
  fetchProjectSchedule,
} from './planning';


function planningVaultQueryKey(vaultId = getActiveVaultId()) {
  return ['planning', vaultId] as const;
}


export const planningQueryKeys = {
  all: ['planning'] as const,
  vault: planningVaultQueryKey,
  allocation: (projectId?: string, vaultId = getActiveVaultId()) => (
    [...planningVaultQueryKey(vaultId), 'allocation', ...(projectId ? [projectId] : [])] as const
  ),
  baselines: (projectId: string, vaultId = getActiveVaultId()) => (
    [...planningVaultQueryKey(vaultId), 'baselines', projectId] as const
  ),
  projectReferences: (tableId: string) => (
    [...planningVaultQueryKey(), 'project-references', tableId] as const
  ),
  schedule: (projectId: string, vaultId = getActiveVaultId()) => (
    [...planningVaultQueryKey(vaultId), 'schedule', projectId] as const
  ),
  state: () => [...planningVaultQueryKey(), 'state'] as const,
  worklogs: (projectId?: string, vaultId = getActiveVaultId()) => (
    [...planningVaultQueryKey(vaultId), 'worklogs', ...(projectId ? [projectId] : [])] as const
  ),
};


function isStoragePending(error: unknown): error is GnosiApiError {
  if (!(error instanceof GnosiApiError) || error.status !== 503) return false;
  const payload = error.payload as { detail?: { code?: unknown } } | null;
  return payload?.detail?.code === 'planning_storage_pending';
}


const planningReadRecovery = {
  retry: (failureCount: number, error: unknown) => {
    if (isStoragePending(error)) return failureCount < 40;
    if (error instanceof GnosiApiError
      && (error.status === 503 || (error.status >= 400 && error.status < 500))) return false;
    return failureCount < 2;
  },
  retryDelay: (failureCount: number, error: unknown) => (
    isStoragePending(error)
      ? Math.min(10, Math.max(1, Number(error.response.headers.get('Retry-After')) || 3)) * 1000
      : Math.min(1000 * 2 ** failureCount, 30_000)
  ),
};


export function usePlanningState() {
  return useQuery({
    ...planningReadRecovery,
    queryFn: fetchPlanningState,
    queryKey: planningQueryKeys.state(),
  });
}


export function usePlanningAllocation(projectId?: string, enabled = true) {
  return useQuery({
    ...planningReadRecovery,
    enabled,
    queryFn: () => fetchPlanningAllocation(projectId),
    queryKey: planningQueryKeys.allocation(projectId),
  });
}


export function useProjectSchedule(projectId: string, enabled = true) {
  const vaultId = getActiveVaultId();
  return useQuery({
    enabled,
    queryFn: () => fetchProjectSchedule(projectId),
    queryKey: planningQueryKeys.schedule(projectId, vaultId),
  });
}


export function usePlanningBaselines(projectId: string, enabled = true) {
  const vaultId = getActiveVaultId();
  return useQuery({
    ...planningReadRecovery,
    enabled,
    queryFn: () => fetchPlanningBaselines(projectId),
    queryKey: planningQueryKeys.baselines(projectId, vaultId),
  });
}


export function usePlanningWorklogs(projectId?: string, enabled = true) {
  return useQuery({
    ...planningReadRecovery,
    enabled,
    queryFn: () => fetchPlanningWorklogs(undefined, projectId),
    queryKey: planningQueryKeys.worklogs(projectId),
  });
}


function usePlanningMutation<TVariables, TResult>(
  mutationFn: (variables: TVariables) => Promise<TResult>,
  invalidateOnSuccess = true,
) {
  const queryClient = useQueryClient();
  const vaultId = getActiveVaultId();
  const vaultQueryKey = planningQueryKeys.vault(vaultId);
  return useMutation({
    mutationFn: (variables: TVariables) => {
      if (getActiveVaultId() !== vaultId) {
        throw new Error('The selected vault has changed. Reopen the project before saving.');
      }
      return mutationFn(variables);
    },
    onSuccess: async () => {
      if (invalidateOnSuccess) await queryClient.invalidateQueries({ queryKey: vaultQueryKey });
    },
  });
}


export function useCreatePlanningBaseline() {
  return usePlanningMutation(createPlanningBaseline);
}


export function useCreatePlanningWorklog() {
  return usePlanningMutation(createPlanningWorklog);
}


export function useCreatePlanningLevelingProposal() {
  return usePlanningMutation(createPlanningLevelingProposal, false);
}


export function useApplyPlanningLevelingProposal() {
  return usePlanningMutation(applyPlanningLevelingProposal);
}
