import type { components } from '../../generated/openapi';
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
  return unwrapApiResult<ConfigurationDocument, unknown>(
    await apiClient.GET('/api/config', { signal }),
  );
}


export async function updateConfiguration(
  input: ConfigurationUpdateInput,
): Promise<ConfigurationUpdateResponse> {
  return unwrapApiResult<ConfigurationUpdateResponse, unknown>(
    await apiClient.POST('/api/config', { body: input }),
  );
}
