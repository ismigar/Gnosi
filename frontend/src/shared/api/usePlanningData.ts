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
  allocation: () => [...planningVaultQueryKey(), 'allocation'] as const,
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
  worklogs: () => [...planningVaultQueryKey(), 'worklogs'] as const,
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


export function usePlanningAllocation() {
  return useQuery({
    ...planningReadRecovery,
    queryFn: fetchPlanningAllocation,
    queryKey: planningQueryKeys.allocation(),
  });
}


export function useProjectSchedule(projectId: string, enabled = true) {
  const vaultId = getActiveVaultId();
  return useQuery({
    enabled,
    placeholderData: (data, previousQuery) => (
      previousQuery?.queryKey[1] === vaultId ? data : undefined
    ),
    queryFn: () => fetchProjectSchedule(projectId),
    queryKey: planningQueryKeys.schedule(projectId, vaultId),
  });
}


export function usePlanningBaselines(projectId: string, enabled = true) {
  const vaultId = getActiveVaultId();
  return useQuery({
    ...planningReadRecovery,
    enabled,
    placeholderData: (data, previousQuery) => (
      previousQuery?.queryKey[1] === vaultId ? data : undefined
    ),
    queryFn: () => fetchPlanningBaselines(projectId),
    queryKey: planningQueryKeys.baselines(projectId, vaultId),
  });
}


export function usePlanningWorklogs() {
  return useQuery({
    ...planningReadRecovery,
    queryFn: () => fetchPlanningWorklogs(),
    queryKey: planningQueryKeys.worklogs(),
  });
}


function usePlanningMutation<TVariables, TResult>(
  mutationFn: (variables: TVariables) => Promise<TResult>,
) {
  const queryClient = useQueryClient();
  const vaultQueryKey = planningQueryKeys.vault();
  return useMutation({
    mutationFn,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: vaultQueryKey });
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
  return useMutation({ mutationFn: createPlanningLevelingProposal });
}


export function useApplyPlanningLevelingProposal() {
  return usePlanningMutation(applyPlanningLevelingProposal);
}
