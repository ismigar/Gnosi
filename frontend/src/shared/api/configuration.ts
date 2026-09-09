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
export type InterfaceSettings = components['schemas']['InterfaceSettings'];


export async function fetchInterfaceSettings(
  signal?: AbortSignal,
): Promise<InterfaceSettings> {
  return fetchCachedQuery({
    queryKey: bootstrapQueryKeys.interfaceSettings(),
    signal,
    queryFn: async (sharedSignal) => unwrapApiResult<InterfaceSettings, unknown>(
      await apiClient.GET('/api/config/interface', { signal: sharedSignal }),
    ),
  });
}


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


export async function fetchGraphConfiguration(
  signal?: AbortSignal,
): Promise<ConfigurationDocument> {
  // The graph needs no account/provider credential status. Its query owns
  // caching and refresh so configuration-change events always read fresh data.
  return unwrapApiResult<ConfigurationDocument, unknown>(
    await apiClient.GET('/api/config/graph', { signal }),
  );
}


export async function fetchEditorConfiguration(
  signal?: AbortSignal,
): Promise<ConfigurationDocument> {
  return fetchCachedQuery({
    queryKey: bootstrapQueryKeys.editorConfiguration(),
    staleTime: 0,
    signal,
    queryFn: async (sharedSignal) => unwrapApiResult<ConfigurationDocument, unknown>(
      await apiClient.GET('/api/config/editor', { signal: sharedSignal }),
    ),
  });
}


export async function updateConfiguration(
  input: ConfigurationUpdateInput,
): Promise<ConfigurationUpdateResponse> {
  const interfaceKey = bootstrapQueryKeys.interfaceSettings();
  const editorKey = bootstrapQueryKeys.editorConfiguration();
  const response = unwrapApiResult<ConfigurationUpdateResponse, unknown>(
    await apiClient.POST('/api/config', { body: input }),
  );
  await Promise.all([
    invalidateCachedQuery(bootstrapQueryKeys.configuration),
    invalidateCachedQuery(interfaceKey),
    invalidateCachedQuery(editorKey),
  ]);
  return response;
}
