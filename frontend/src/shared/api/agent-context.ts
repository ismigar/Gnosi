import type { components } from '../../generated/openapi';
import { apiClient } from './client';
import { unwrapApiResult } from './errors';


export type ExternalContextSource =
  components['schemas']['ExternalContextSourceResponse'];
export type InternalContextSource =
  components['schemas']['InternalContextSourceResponse'];


export async function fetchExternalContextSources(
  signal?: AbortSignal,
): Promise<ExternalContextSource[]> {
  return unwrapApiResult<ExternalContextSource[], unknown>(
    await apiClient.GET('/api/agent/context-sources', { signal }),
  );
}


export async function fetchInternalContextSources(
  signal?: AbortSignal,
): Promise<InternalContextSource[]> {
  return unwrapApiResult<InternalContextSource[], unknown>(
    await apiClient.GET('/api/agent/internal-sources', { signal }),
  );
}
