import { useQuery } from '@tanstack/react-query';

import { fetchVaultGraph, graphQueryKey } from './graph';


export function useVaultGraphData() {
  return useQuery({
    queryFn: ({ signal }) => fetchVaultGraph(signal),
    queryKey: graphQueryKey,
  });
}
