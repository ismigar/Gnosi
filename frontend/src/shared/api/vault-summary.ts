import type { components } from '../../generated/openapi';
import { apiClient } from './client';
import { unwrapApiResult } from './errors';


export type VaultSummarySettings =
  components['schemas']['PluginSettingsResponse'];
export type VaultSummaryResult =
  components['schemas']['VaultPluginSummaryResponse'];


export interface VaultSummaryInput {
  readonly content: string;
  readonly language?: string;
}


export async function fetchVaultSummarySettings(
  signal?: AbortSignal,
): Promise<VaultSummarySettings> {
  return unwrapApiResult<VaultSummarySettings, unknown>(
    await apiClient.GET('/api/vault/plugins/{plugin_id}/settings', {
      params: { path: { plugin_id: 'vault-summary' } },
      signal,
    }),
  );
}


export async function updateVaultSummarySettings(
  settings: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<VaultSummarySettings> {
  return unwrapApiResult<VaultSummarySettings, unknown>(
    await apiClient.PUT('/api/vault/plugins/{plugin_id}/settings', {
      body: { settings },
      params: { path: { plugin_id: 'vault-summary' } },
      signal,
    }),
  );
}


export async function summarizeVaultRecord(
  input: VaultSummaryInput,
  signal?: AbortSignal,
): Promise<VaultSummaryResult> {
  return unwrapApiResult<VaultSummaryResult, unknown>(
    await apiClient.POST('/api/vault/plugins/vault-summary/summarize', {
      body: {
        content: input.content,
        language: input.language || 'en',
      },
      signal,
    }),
  );
}
