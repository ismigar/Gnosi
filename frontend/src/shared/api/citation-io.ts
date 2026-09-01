import type { components } from '../../generated/openapi';
import { apiClient } from './client';
import { GnosiApiError, unwrapApiResult } from './errors';
import { transportFetch } from './transports';


export type CslStyle = components['schemas']['CslStyleResponse'];
export type ImportReferencesResult =
  components['schemas']['ImportReferencesResponse'];
export type ReferenceExportFormat = 'bibtex' | 'ris';


export interface ImportReferencesOptions {
  readonly format?: string;
  readonly signal?: AbortSignal;
  readonly tableId: string;
}


export interface ExportReferencesOptions {
  readonly format: ReferenceExportFormat;
  readonly keys?: string;
  readonly signal?: AbortSignal;
  readonly tableId: string;
}


function citationIoPath(
  path: string,
  query: Record<string, string | undefined>,
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) params.set(key, value);
  }
  const suffix = params.toString();
  return suffix ? `${path}?${suffix}` : path;
}


async function jsonPayload(response: Response): Promise<unknown> {
  return response.json().catch(() => undefined);
}


function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object';
}


function isCslStyle(value: unknown): value is CslStyle {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.file === 'string' &&
    (value.title === null || typeof value.title === 'string')
  );
}


function isImportReferencesResult(value: unknown): value is ImportReferencesResult {
  return (
    isRecord(value) &&
    typeof value.created === 'number' &&
    typeof value.skipped === 'number' &&
    Array.isArray(value.errors) &&
    Array.isArray(value.items) &&
    isRecord(value.skip_summary)
  );
}


export async function fetchCslStyles(signal?: AbortSignal): Promise<CslStyle[]> {
  const payload = unwrapApiResult<
    components['schemas']['CslStylesResponse'],
    unknown
  >(
    await apiClient.GET('/api/vault/csl/styles', { signal }),
  );
  return payload.styles;
}


export async function uploadCslStyle(
  file: File,
  signal?: AbortSignal,
): Promise<CslStyle> {
  const body = new FormData();
  body.set('file', file);
  const response = await transportFetch('/api/vault/csl/styles', {
    body,
    method: 'POST',
    signal,
  });
  const payload = await jsonPayload(response);
  if (!response.ok) throw new GnosiApiError(response, payload);
  if (!isCslStyle(payload)) {
    throw new GnosiApiError(response, 'The API returned an invalid CSL style');
  }
  return payload;
}


export async function importReferences(
  file: File,
  options: ImportReferencesOptions,
): Promise<ImportReferencesResult> {
  const body = new FormData();
  body.set('file', file);
  const response = await transportFetch(
    citationIoPath('/api/vault/import-references', {
      fmt: options.format ?? 'auto',
      table_id: options.tableId,
    }),
    { body, method: 'POST', signal: options.signal },
  );
  const payload = await jsonPayload(response);
  if (!response.ok) throw new GnosiApiError(response, payload);
  if (!isImportReferencesResult(payload)) {
    throw new GnosiApiError(
      response,
      'The API returned an invalid reference import result',
    );
  }
  return payload;
}


export async function exportReferences(
  options: ExportReferencesOptions,
): Promise<Blob> {
  const response = await transportFetch(
    citationIoPath('/api/vault/export-references', {
      fmt: options.format,
      keys: options.keys,
      table_id: options.tableId,
    }),
    { method: 'GET', signal: options.signal },
  );
  if (!response.ok) {
    throw new GnosiApiError(response, await jsonPayload(response));
  }
  return response.blob();
}
