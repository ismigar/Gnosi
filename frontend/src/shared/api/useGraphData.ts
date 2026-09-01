import { useQuery } from '@tanstack/react-query';

import { fetchVaultGraph } from './graph';


export const graphQueryKey = ['graph'] as const;


export function useVaultGraphData() {
  return useQuery({
    queryFn: fetchVaultGraph,
    queryKey: graphQueryKey,
  });
}
