import type { components } from '../../generated/openapi';
import { bootstrapQueryKeys } from './bootstrap-query-keys';
import { fetchCachedQuery, invalidateCachedQuery } from './cached-query';
import { apiClient } from './client';
import { unwrapApiResult } from './errors';


export type ConfigurationDocument =
  components['schemas']['ConfigurationDocument'];
export type ConfigurationUpdateResponse =
  components['schemas']['ConfigurationUpdateResponse'];
export type ConfigurationUpdateInput = Record<string, unknown>;


export async function fetchConfiguration(
  signal?: AbortSignal,
): Promise<ConfigurationDocument> {
  return fetchCachedQuery({
    queryKey: bootstrapQueryKeys.configuration,
    signal,
    queryFn: async (sharedSignal) => unwrapApiResult<ConfigurationDocument, unknown>(
      await apiClient.GET('/api/config', { signal: sharedSignal }),
    ),
  });
}


export async function updateConfiguration(
  input: ConfigurationUpdateInput,
): Promise<ConfigurationUpdateResponse> {
  const response = unwrapApiResult<ConfigurationUpdateResponse, unknown>(
    await apiClient.POST('/api/config', { body: input }),
  );
  await invalidateCachedQuery(bootstrapQueryKeys.configuration);
  return response;
}
