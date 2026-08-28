import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  fetchScheduledTasks,
  updateScheduledTask,
  type ScheduledTask,
} from './scheduler';


export const schedulerTaskQueryKey = ['scheduler', 'tasks'] as const;


export function useScheduledTasks() {
  return useQuery({
    queryFn: fetchScheduledTasks,
    queryKey: schedulerTaskQueryKey,
  });
}


export function useUpdateScheduledTask() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: updateScheduledTask,
    onSuccess: async (result) => {
      queryClient.setQueryData<ScheduledTask[]>(schedulerTaskQueryKey, (tasks) =>
        tasks?.map((task) =>
          task.name === result.task.name ? result.task : task,
        ),
      );
      await queryClient.invalidateQueries({ queryKey: schedulerTaskQueryKey });
    },
  });
}
