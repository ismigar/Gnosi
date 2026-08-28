import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  clearSystemNotifications,
  fetchSystemNotifications,
  type SystemNotificationsQuery,
} from './system';


export const systemQueryKeys = {
  all: ['system'] as const,
  notifications: (query: SystemNotificationsQuery) =>
    ['system', 'notifications', query] as const,
};


export function useSystemNotifications(query: SystemNotificationsQuery) {
  return useQuery({
    placeholderData: keepPreviousData,
    queryFn: () => fetchSystemNotifications(query),
    queryKey: systemQueryKeys.notifications(query),
  });
}


export function useClearSystemNotifications() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: clearSystemNotifications,
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: systemQueryKeys.notifications({}).slice(0, 2),
      });
    },
  });
}
