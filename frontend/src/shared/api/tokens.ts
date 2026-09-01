import type { components } from '../../generated/openapi';
import { apiClient } from './client';
import { unwrapApiResult } from './errors';


export type ApiTokenCreated = components['schemas']['CreatedTokenResponse'];
export type ApiTokenRevocation = components['schemas']['RevokedTokenResponse'];
export type ApiTokenSummary = components['schemas']['TokenSummaryResponse'];


export async function fetchApiTokens(
  signal?: AbortSignal,
): Promise<ApiTokenSummary[]> {
  return unwrapApiResult<ApiTokenSummary[], unknown>(
    await apiClient.GET('/api/tokens', { signal }),
  );
}


export async function createApiToken(
  name: string,
  scopes = 'read,write',
  signal?: AbortSignal,
): Promise<ApiTokenCreated> {
  return unwrapApiResult<ApiTokenCreated, unknown>(
    await apiClient.POST('/api/tokens', {
      body: { name, scopes },
      signal,
    }),
  );
}


export async function revokeApiToken(
  tokenId: string,
  signal?: AbortSignal,
): Promise<ApiTokenRevocation> {
  return unwrapApiResult<ApiTokenRevocation, unknown>(
    await apiClient.DELETE('/api/tokens/{token_id}', {
      params: { path: { token_id: tokenId } },
      signal,
    }),
  );
}
