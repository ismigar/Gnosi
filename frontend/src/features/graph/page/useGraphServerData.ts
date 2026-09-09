import { useCallback, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  fetchGraphConfiguration,
  updateConfiguration,
  type ConfigurationDocument,
  type ConfigurationUpdateInput,
} from '../../../shared/api/configuration';
import { fetchVaultGraph, graphQueryKey } from '../../../shared/api/graph';
import {
  fetchVaultGlobalIndex,
  fetchVaultTables,
} from '../../../shared/api/vaults';
import { getActiveVaultId } from '../../../shared/api/vault-context';
import { graphSettingsFromDocument } from './graphPageModel';


export const graphServerQueryKeys = {
  all: ['graph-page'] as const,
  configuration: (vaultId = getActiveVaultId()) => ['graph-page', 'configuration', vaultId] as const,
  graph: graphQueryKey,
  globalIndex: (vaultId = getActiveVaultId()) => ['graph-page', 'global-index', vaultId] as const,
  tables: (vaultId = getActiveVaultId()) => ['graph-page', 'tables', vaultId] as const,
};


export function useGraphServerData() {
  const queryClient = useQueryClient();
  const vaultId = getActiveVaultId();
  const configuration = useQuery({
    queryFn: ({ signal }) => fetchGraphConfiguration(signal),
    queryKey: graphServerQueryKeys.configuration(vaultId),
  });
  const graph = useQuery({
    queryFn: ({ signal }) => fetchVaultGraph(signal),
    queryKey: graphServerQueryKeys.graph(vaultId),
  });
  // Only field-filter labels use this index. Graph labels alone cannot replace
  // it: the graph omits some pages and may use a different display title.
  const needsGlobalIndex = useMemo(() => graphSettingsFromDocument(configuration.data ?? null)
    ?.visible_fields?.some(field => field.includes(':')) ?? false, [configuration.data]);
  const globalIndex = useQuery({
    enabled: needsGlobalIndex,
    queryFn: ({ signal }) => fetchVaultGlobalIndex(signal),
    queryKey: graphServerQueryKeys.globalIndex(vaultId),
  });
  const tables = useQuery({
    queryFn: ({ signal }) => fetchVaultTables(undefined, signal),
    queryKey: graphServerQueryKeys.tables(vaultId),
  });
  const update = useMutation({
    mutationFn: (input: ConfigurationUpdateInput) => updateConfiguration(input),
  });

  const replaceConfiguration = useCallback((next: ConfigurationDocument): void => {
    queryClient.setQueryData(graphServerQueryKeys.configuration(vaultId), next);
  }, [queryClient, vaultId]);

  return {
    configuration,
    graph,
    globalIndex,
    replaceConfiguration,
    tables,
    updateConfiguration: update.mutateAsync,
  };
}
