import type { components } from '../../generated/openapi';
import { apiClient } from './client';
import { unwrapApiResult } from './errors';

export type EnvironmentSettings = components['schemas']['EnvironmentResponse'];
export type EnvironmentUpdate = Record<
  string,
  boolean | number | string | null
>;
export type EnvironmentUpdateResult =
  components['schemas']['EnvironmentUpdateResponse'];

export async function fetchEnvironment(
  signal?: AbortSignal,
): Promise<EnvironmentSettings> {
  return unwrapApiResult<EnvironmentSettings, unknown>(
    await apiClient.GET('/api/env', { signal }),
  );
}

export async function updateEnvironment(
  update: EnvironmentUpdate,
): Promise<EnvironmentUpdateResult> {
  return unwrapApiResult<EnvironmentUpdateResult, unknown>(
    await apiClient.POST('/api/env', { body: update }),
  );
}
