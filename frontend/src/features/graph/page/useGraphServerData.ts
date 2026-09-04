import { useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  fetchConfiguration,
  updateConfiguration,
  type ConfigurationDocument,
  type ConfigurationUpdateInput,
} from '../../../shared/api/configuration';
import { fetchVaultGraph, graphQueryKey } from '../../../shared/api/graph';
import {
  fetchVaultGlobalIndex,
  fetchVaultTables,
} from '../../../shared/api/vaults';


export const graphServerQueryKeys = {
  all: ['graph-page'] as const,
  configuration: ['graph-page', 'configuration'] as const,
  graph: graphQueryKey,
  globalIndex: ['graph-page', 'global-index'] as const,
  tables: ['graph-page', 'tables'] as const,
};


export function useGraphServerData() {
  const queryClient = useQueryClient();
  const configuration = useQuery({
    queryFn: ({ signal }) => fetchConfiguration(signal),
    queryKey: graphServerQueryKeys.configuration,
  });
  const graph = useQuery({
    queryFn: ({ signal }) => fetchVaultGraph(signal),
    queryKey: graphServerQueryKeys.graph,
  });
  const globalIndex = useQuery({
    queryFn: ({ signal }) => fetchVaultGlobalIndex(signal),
    queryKey: graphServerQueryKeys.globalIndex,
  });
  const tables = useQuery({
    queryFn: ({ signal }) => fetchVaultTables(undefined, signal),
    queryKey: graphServerQueryKeys.tables,
  });
  const update = useMutation({
    mutationFn: (input: ConfigurationUpdateInput) => updateConfiguration(input),
  });

  const replaceConfiguration = useCallback((next: ConfigurationDocument): void => {
    queryClient.setQueryData(graphServerQueryKeys.configuration, next);
  }, [queryClient]);

  return {
    configuration,
    graph,
    globalIndex,
    replaceConfiguration,
    tables,
    updateConfiguration: update.mutateAsync,
  };
}
