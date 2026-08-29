import type { components } from '../../generated/openapi';
import { apiClient } from './client';
import { unwrapApiResult } from './errors';


export type VaultGraphData = components['schemas']['GraphResponse'];
export type VaultGraphNode = components['schemas']['GraphNodeResponse'];
export type VaultGraphEdge = components['schemas']['GraphEdgeResponse'];


export async function fetchVaultGraph(): Promise<VaultGraphData> {
  return unwrapApiResult<VaultGraphData, unknown>(
    await apiClient.GET('/api/graph'),
  );
}
