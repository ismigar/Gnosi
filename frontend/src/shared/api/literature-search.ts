import { apiClient } from './client';
import { GnosiApiError, unwrapApiResult, type ApiResult } from './errors';
import type { LiteratureJson, LiteratureWork } from './literature';
import { requestContextHeaders, type RequestContext } from './request-context';

export interface LiteratureSearch extends LiteratureJson {
  readonly ai_audits?: readonly LiteratureJson[];
  readonly errors?: readonly LiteratureJson[];
  readonly filters?: LiteratureJson;
  readonly id: string;
  readonly query?: string;
  readonly result_count?: number;
  readonly results?: readonly LiteratureWork[];
  readonly source_ids?: readonly string[];
  readonly source_queries?: Readonly<Record<string, string>>;
  readonly state: string;
}

export interface LiteratureSearchInput {
  readonly ai_audits: LiteratureJson[];
  readonly filters: LiteratureJson;
  readonly limit_per_source: number;
  readonly query: string;
  readonly source_ids: string[];
  readonly source_queries: Record<string, string>;
}

function isSearch(value: unknown): value is LiteratureSearch {
  return (
    typeof value === 'object' && value !== null && !Array.isArray(value)
    && 'id' in value && typeof value.id === 'string'
    && 'state' in value && typeof value.state === 'string'
    && (!('results' in value) || Array.isArray(value.results))
  );
}

function searchResult(result: ApiResult<unknown>): LiteratureSearch {
  const payload = unwrapApiResult<unknown, unknown>(result);
  if (!isSearch(payload)) throw new GnosiApiError(result.response, 'The API returned an invalid literature search');
  return payload;
}

export async function fetchLiteratureSearches(
  limit = 50,
  signal?: AbortSignal,
  context?: RequestContext,
): Promise<readonly LiteratureSearch[]> {
  const result = await apiClient.GET('/api/vault/literature/searches', {
    headers: requestContextHeaders(context),
    params: { query: { limit } },
    signal,
  });
  const payload = unwrapApiResult<unknown, unknown>(result);
  if (typeof payload !== 'object' || payload === null || !('searches' in payload)
      || !Array.isArray(payload.searches) || !payload.searches.every(isSearch)) {
    throw new GnosiApiError(result.response, 'The API returned an invalid search history');
  }
  return payload.searches;
}

export async function fetchLiteratureSearch(
  searchId: string,
  offset: number,
  limit: number,
  signal?: AbortSignal,
): Promise<LiteratureSearch> {
  return searchResult(
    await apiClient.GET('/api/vault/literature/searches/{search_id}', {
      params: { path: { search_id: searchId }, query: { limit, offset } },
      signal,
    }),
  );
}

export async function createLiteratureSearch(
  input: LiteratureSearchInput,
  signal?: AbortSignal,
): Promise<LiteratureSearch> {
  return searchResult(
    await apiClient.POST('/api/vault/literature/searches', {
      body: input,
      signal,
    }),
  );
}

export async function cancelLiteratureSearch(
  searchId: string,
  signal?: AbortSignal,
): Promise<LiteratureSearch> {
  return searchResult(
    await apiClient.DELETE('/api/vault/literature/searches/{search_id}', {
      params: { path: { search_id: searchId } },
      signal,
    }),
  );
}
