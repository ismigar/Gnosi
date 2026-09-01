import type { components } from '../../generated/openapi';
import { apiClient } from './client';
import { unwrapApiResult } from './errors';


export type MarkdownImportInput =
  components['schemas']['backend__api__vault_routes__ImportRequest'];
export type MarkdownImportResult = components['schemas']['ImportResponse'];


export async function importVaultMarkdown(
  input: MarkdownImportInput,
  signal?: AbortSignal,
): Promise<MarkdownImportResult> {
  return unwrapApiResult<MarkdownImportResult, unknown>(
    await apiClient.POST('/api/vault/import', { body: input, signal }),
  );
}
