import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

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


export const planningQueryKeys = {
  all: ['planning'] as const,
  allocation: ['planning', 'allocation'] as const,
  baselines: (projectId: string) => ['planning', 'baselines', projectId] as const,
  schedule: (projectId: string) => ['planning', 'schedule', projectId] as const,
  state: ['planning', 'state'] as const,
  worklogs: ['planning', 'worklogs'] as const,
};


export function usePlanningState() {
  return useQuery({
    queryFn: fetchPlanningState,
    queryKey: planningQueryKeys.state,
  });
}


export function usePlanningAllocation() {
  return useQuery({
    queryFn: fetchPlanningAllocation,
    queryKey: planningQueryKeys.allocation,
  });
}


export function useProjectSchedule(projectId: string) {
  return useQuery({
    placeholderData: keepPreviousData,
    queryFn: () => fetchProjectSchedule(projectId),
    queryKey: planningQueryKeys.schedule(projectId),
  });
}


export function usePlanningBaselines(projectId: string) {
  return useQuery({
    placeholderData: keepPreviousData,
    queryFn: () => fetchPlanningBaselines(projectId),
    queryKey: planningQueryKeys.baselines(projectId),
  });
}


export function usePlanningWorklogs() {
  return useQuery({
    queryFn: () => fetchPlanningWorklogs(),
    queryKey: planningQueryKeys.worklogs,
  });
}


function usePlanningMutation<TVariables, TResult>(
  mutationFn: (variables: TVariables) => Promise<TResult>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: planningQueryKeys.all });
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
