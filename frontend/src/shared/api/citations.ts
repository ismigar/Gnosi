import type { components } from '../../generated/openapi';
import { apiClient } from './client';
import { unwrapApiResult } from './errors';


export type CitationResolution =
  components['schemas']['CitationResolutionResponse'];
export type CitationSearchItem =
  components['schemas']['CitationSearchItemResponse'];
export type PdfAnnotation = components['schemas']['PdfAnnotationResponse'];
export type PdfAnnotationCreateInput = Omit<
  components['schemas']['_PdfAnnotationCreate'],
  'color'
> & { readonly color?: string | null };
export type PdfAnnotationUpdateInput =
  components['schemas']['_PdfAnnotationUpdate'];
export type PdfAnnotationDeletion =
  components['schemas']['PdfAnnotationDeletedResponse'];


export async function searchCitations(
  query = '',
  limit = 30,
  signal?: AbortSignal,
): Promise<CitationSearchItem[]> {
  return unwrapApiResult<CitationSearchItem[], unknown>(
    await apiClient.GET('/api/vault/search-citations', {
      params: { query: { limit, q: query } },
      signal,
    }),
  );
}


export async function resolveCitationKey(
  key: string,
  signal?: AbortSignal,
): Promise<CitationResolution> {
  return unwrapApiResult<CitationResolution, unknown>(
    await apiClient.GET('/api/vault/resolve-by-citation-key', {
      params: { query: { key } },
      signal,
    }),
  );
}


export async function fetchPdfAnnotations(
  sourceUri: string,
  signal?: AbortSignal,
): Promise<PdfAnnotation[]> {
  return unwrapApiResult<PdfAnnotation[], unknown>(
    await apiClient.GET('/api/vault/pdf-annotations', {
      params: { query: { source_uri: sourceUri } },
      signal,
    }),
  );
}


export async function createPdfAnnotation(
  payload: PdfAnnotationCreateInput,
  signal?: AbortSignal,
): Promise<PdfAnnotation> {
  return unwrapApiResult<PdfAnnotation, unknown>(
    await apiClient.POST('/api/vault/pdf-annotations', {
      body: { ...payload, color: payload.color ?? '#ffeb3b' },
      signal,
    }),
  );
}


export async function updatePdfAnnotation(
  annotationId: number,
  payload: PdfAnnotationUpdateInput,
  signal?: AbortSignal,
): Promise<PdfAnnotation> {
  return unwrapApiResult<PdfAnnotation, unknown>(
    await apiClient.PATCH('/api/vault/pdf-annotations/{ann_id}', {
      body: payload,
      params: { path: { ann_id: annotationId } },
      signal,
    }),
  );
}


export async function deletePdfAnnotation(
  annotationId: number,
  signal?: AbortSignal,
): Promise<PdfAnnotationDeletion> {
  return unwrapApiResult<PdfAnnotationDeletion, unknown>(
    await apiClient.DELETE('/api/vault/pdf-annotations/{ann_id}', {
      params: { path: { ann_id: annotationId } },
      signal,
    }),
  );
}
