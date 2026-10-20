import type { components } from '../../generated/openapi';
import { apiClient } from './client';
import { unwrapApiResult } from './errors';
import { currentRequestContext, type RequestContext } from './request-context';

export type VaultSearchHit = components['schemas']['VaultSearchHit'];
export type VaultSearchResponse = components['schemas']['VaultSearchResponse'];

export async function searchVaultContent(
  query: string,
  options: { readonly offset?: number; readonly signal?: AbortSignal; readonly vaultId?: string | null; readonly context?: RequestContext } = {},
): Promise<VaultSearchResponse> {
  const context = options.context ?? currentRequestContext();
  return unwrapApiResult<VaultSearchResponse, unknown>(await apiClient.GET('/api/vault/search', {
    params: { query: { q: query, offset: options.offset ?? 0, limit: 50 } },
    signal: options.signal,
    headers: {
      'X-Vault-ID': options.vaultId ?? context.vaultId,
      'X-Workspace-ID': context.workspaceId,
      'X-User-ID': context.userId,
      'X-User-Email': context.userEmail,
    },
  }));
}
