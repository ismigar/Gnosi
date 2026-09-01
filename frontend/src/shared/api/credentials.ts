import type { components } from '../../generated/openapi';
import { apiClient } from './client';
import { unwrapApiResult } from './errors';


export type CredentialInput = components['schemas']['CredentialSet'];
export type CredentialStatus = components['schemas']['CredentialStatus'];
export type CredentialMutation =
  components['schemas']['CredentialMutationResponse'];
export type CredentialMigration =
  components['schemas']['CredentialMigrationResponse'];


export async function fetchCredentials(
  signal?: AbortSignal,
): Promise<CredentialStatus[]> {
  return unwrapApiResult<CredentialStatus[], unknown>(
    await apiClient.GET('/api/credentials/', { signal }),
  );
}


export async function fetchCredentialStatus(
  credentialKey: string,
  signal?: AbortSignal,
): Promise<CredentialStatus> {
  return unwrapApiResult<CredentialStatus, unknown>(
    await apiClient.GET('/api/credentials/{credential_key}', {
      params: { path: { credential_key: credentialKey } },
      signal,
    }),
  );
}


export async function saveCredential(
  input: CredentialInput,
): Promise<CredentialMutation> {
  return unwrapApiResult<CredentialMutation, unknown>(
    await apiClient.POST('/api/credentials/', { body: input }),
  );
}


export async function deleteCredential(
  credentialKey: string,
): Promise<CredentialMutation> {
  return unwrapApiResult<CredentialMutation, unknown>(
    await apiClient.DELETE('/api/credentials/{credential_key}', {
      params: { path: { credential_key: credentialKey } },
    }),
  );
}


export async function migrateCredentials(): Promise<CredentialMigration> {
  return unwrapApiResult<CredentialMigration, unknown>(
    await apiClient.POST('/api/credentials/migrate'),
  );
}
