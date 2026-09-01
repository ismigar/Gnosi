import type { components } from '../../generated/openapi';
import { apiClient } from './client';
import { GnosiApiError, unwrapApiResult } from './errors';
import { transportFetch } from './transports';


export type VaultTemplateCatalog =
  components['schemas']['TemplateCatalogResponse'];
export type VaultTemplateCreationInput =
  components['schemas']['CreateFromTemplatePayload'];
export type VaultTemplateCreation =
  components['schemas']['CreatedVaultTemplateResponse'];
export type VaultTemplateExportInput =
  components['schemas']['TemplateExportPayload'];
export type VaultTemplateExportPreview =
  components['schemas']['TemplateExportPreviewResponse'];
export type VaultTemplateSubmission =
  components['schemas']['TemplateSubmissionResponse'];


async function errorPayload(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
  if (contentType.includes('json')) {
    try {
      return await response.json();
    } catch {
      return undefined;
    }
  }
  const text = await response.text();
  return text || undefined;
}


export async function fetchVaultTemplateCatalog(
  signal?: AbortSignal,
): Promise<VaultTemplateCatalog> {
  return unwrapApiResult<VaultTemplateCatalog, unknown>(
    await apiClient.GET('/api/vaults/templates/catalog', { signal }),
  );
}


export async function createVaultFromTemplate(
  input: VaultTemplateCreationInput,
  signal?: AbortSignal,
): Promise<VaultTemplateCreation> {
  return unwrapApiResult<VaultTemplateCreation, unknown>(
    await apiClient.POST('/api/vaults/from-template', { body: input, signal }),
  );
}


export async function fetchVaultTemplateExportPreview(
  vaultId: string,
  signal?: AbortSignal,
): Promise<VaultTemplateExportPreview> {
  return unwrapApiResult<VaultTemplateExportPreview, unknown>(
    await apiClient.GET('/api/vaults/{vault_id}/template-export/preview', {
      params: { path: { vault_id: vaultId } },
      signal,
    }),
  );
}


export async function downloadVaultTemplate(
  vaultId: string,
  input: VaultTemplateExportInput,
  signal?: AbortSignal,
): Promise<Blob> {
  const response = await transportFetch(
    `/api/vaults/${encodeURIComponent(vaultId)}/template-export`,
    {
      body: JSON.stringify(input),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
      signal,
    },
  );
  if (!response.ok) throw new GnosiApiError(response, await errorPayload(response));
  return response.blob();
}


export async function submitVaultTemplate(
  vaultId: string,
  input: VaultTemplateExportInput,
  signal?: AbortSignal,
): Promise<VaultTemplateSubmission> {
  return unwrapApiResult<VaultTemplateSubmission, unknown>(
    await apiClient.POST('/api/vaults/{vault_id}/template-submissions', {
      body: input,
      params: { path: { vault_id: vaultId } },
      signal,
    }),
  );
}
