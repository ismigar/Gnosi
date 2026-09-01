import type { components } from '../../generated/openapi';
import { apiClient } from './client';
import { GnosiApiError, unwrapApiResult } from './errors';
import { transportFetch } from './transports';


export type MetadataLookupResponse =
  components['schemas']['MetadataLookupResponse'];
export type UrlTranslationResponse =
  components['schemas']['UrlTranslationResponse'];
export type PdfRecognitionResponse =
  components['schemas']['PdfRecognitionResponse'];
export type ZoteroExtraPromotionResponse =
  components['schemas']['ZoteroExtraPromotionResponse'];


export interface MetadataLookupInput {
  readonly arxiv?: string;
  readonly doi?: string;
  readonly isbn?: string;
  readonly pmid?: string;
  readonly url?: string;
}


export interface UrlTranslationInput {
  readonly url: string;
}


export interface ZoteroExtraPromotionInput {
  readonly column_name?: string;
  readonly column_type?: string;
  readonly expected_etags?: Readonly<Record<string, string>>;
  readonly page_ids?: readonly string[];
  readonly table_id: string;
  readonly zotero_field: string;
}


function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}


function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every(
    (entry) => typeof entry === 'string',
  );
}


function isPdfRecognitionResponse(
  value: unknown,
): value is PdfRecognitionResponse {
  if (!isRecord(value)) return false;
  const source = value.source;
  return (
    (value.error === null || typeof value.error === 'string') &&
    isStringRecord(value.identifiers) &&
    isRecord(value.suggested) &&
    (source === null ||
      source === 'crossref' ||
      source === 'arxiv' ||
      source === 'pubmed' ||
      source === 'openlibrary' ||
      source === 'url' ||
      source === 'pdf')
  );
}


export async function lookupMetadata(
  input: MetadataLookupInput,
  signal?: AbortSignal,
): Promise<MetadataLookupResponse> {
  return unwrapApiResult<MetadataLookupResponse, unknown>(
    await apiClient.POST('/api/vault/lookup-metadata', {
      body: { ...input },
      signal,
    }),
  );
}


export async function translateUrl(
  input: UrlTranslationInput,
  signal?: AbortSignal,
): Promise<UrlTranslationResponse> {
  return unwrapApiResult<UrlTranslationResponse, unknown>(
    await apiClient.POST('/api/vault/translate-url', {
      body: { ...input },
      signal,
    }),
  );
}


export async function recognizePdf(
  file: File,
  signal?: AbortSignal,
): Promise<PdfRecognitionResponse> {
  const body = new FormData();
  body.set('file', file);
  const response = await transportFetch('/api/vault/recognize-pdf', {
    body,
    method: 'POST',
    signal,
  });
  const payload: unknown = await response.json().catch(() => undefined);
  if (!response.ok) throw new GnosiApiError(response, payload);
  if (!isPdfRecognitionResponse(payload)) {
    throw new GnosiApiError(
      response,
      'The API returned an invalid PDF recognition response',
    );
  }
  return payload;
}


export async function promoteZoteroExtra(
  input: ZoteroExtraPromotionInput,
  signal?: AbortSignal,
): Promise<ZoteroExtraPromotionResponse> {
  return unwrapApiResult<ZoteroExtraPromotionResponse, unknown>(
    await apiClient.POST('/api/vault/promote-zotero-extra', {
      body: { ...input },
      signal,
    }),
  );
}
