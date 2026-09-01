import { useQuery } from '@tanstack/react-query';

import { fetchIntegrations } from './integrations';


export const integrationsQueryKey = ['integrations'] as const;


export function useIntegrations() {
  return useQuery({
    queryFn: ({ signal }) => fetchIntegrations(signal),
    queryKey: integrationsQueryKey,
    retry: false,
    staleTime: 500,
  });
}
