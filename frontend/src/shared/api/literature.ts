import type { components } from '../../generated/openapi';
import { apiClient } from './client';
import {
  GnosiApiError,
  type ApiResult,
  unwrapApiResult,
} from './errors';

export type LiteratureJson = Record<string, unknown>;
export type LiteratureWork = LiteratureJson;
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
export interface LiteratureReview extends LiteratureJson {
  readonly configuration: LiteratureJson;
  readonly criteria: LiteratureJson;
  readonly id: string;
  readonly protocol: string;
  readonly question: string;
  readonly reviewer_mode: string;
  readonly reviewers: readonly string[];
  readonly status: string;
  readonly title: string;
}
export interface LiteratureReviewDetail extends LiteratureJson {
  readonly activities: readonly LiteratureJson[];
  readonly candidates: readonly LiteratureJson[];
  readonly prisma: LiteratureJson;
  readonly review: LiteratureReview;
}
export interface LiteratureAiResult extends LiteratureJson {
  readonly audit: LiteratureJson;
  readonly operation: string;
  readonly result: unknown;
}

export interface LiteratureSnowballResult extends LiteratureJson {
  readonly activity_id: string | null;
  readonly counts: LiteratureJson;
  readonly exact_queries: LiteratureJson;
  readonly provider: string;
  readonly works: readonly LiteratureWork[];
}

export interface LiteratureImportMembership extends LiteratureJson {
  readonly created: boolean;
  readonly resource_id: string | null;
  readonly title: string | null;
  readonly work_id: string | null;
}

export interface LiteratureImportResult extends LiteratureJson {
  readonly existing: readonly LiteratureImportMembership[];
  readonly existing_count: number;
  readonly imported: readonly LiteratureImportMembership[];
  readonly imported_count: number;
  readonly resource_ids: readonly string[];
}

export interface LiteratureReviewCreateInput {
  readonly configuration: LiteratureJson;
  readonly criteria: LiteratureJson;
  readonly protocol: string;
  readonly question: string;
  readonly reviewer_mode: 'dual_blind' | 'single';
  readonly reviewers: string[];
  readonly title: string;
}

export interface LiteratureCandidatesInput {
  readonly activity_id?: string;
  readonly works: LiteratureWork[];
}

export interface LiteratureDecisionInput {
  readonly decision: 'exclude' | 'include' | 'uncertain';
  readonly notes: string;
  readonly phase?: string | null;
  readonly reason: string;
}

export interface LiteratureConsensusInput {
  readonly decision: 'exclude' | 'include';
  readonly notes: string;
  readonly reason: string;
}

export interface LiteratureFullTextInput {
  readonly license?: string;
  readonly location_url?: string;
  readonly notes?: string;
  readonly resource_id?: string;
  readonly status:
    | 'assessed'
    | 'attached'
    | 'available_oa'
    | 'not_requested'
    | 'requested'
    | 'unavailable';
}

export interface LiteratureActivityInput {
  readonly activity_type: string;
  readonly ai_audit?: LiteratureJson;
  readonly counts?: LiteratureJson;
  readonly errors?: LiteratureJson[];
  readonly exact_queries?: LiteratureJson;
  readonly export_format?: string;
  readonly notes?: string;
  readonly source_snapshot?: LiteratureJson[];
  readonly strategy?: LiteratureJson;
}

export interface LiteratureScheduleInput {
  readonly enabled: boolean;
  readonly interval_days: number;
  readonly strategy: LiteratureJson;
}

export interface LiteratureSnowballInput {
  readonly direction: 'backward' | 'both' | 'forward';
  readonly limit_per_seed: number;
  readonly seeds: LiteratureWork[];
}

export interface LiteratureSearchInput {
  readonly ai_audits: LiteratureJson[];
  readonly filters: LiteratureJson;
  readonly limit_per_source: number;
  readonly query: string;
  readonly source_ids: string[];
  readonly source_queries: Record<string, string>;
}

export interface LiteratureAiInput {
  readonly agent_id?: string;
  readonly operation:
    | 'query_strategy'
    | 'rerank'
    | 'screen'
    | 'snowball'
    | 'synthesize'
    | 'translate_query';
  readonly payload: LiteratureJson;
  readonly review_id?: string;
  readonly search_id?: string;
}

function isRecord(value: unknown): value is LiteratureJson {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isSearch(value: unknown): value is LiteratureSearch {
  return (
    isRecord(value)
    && typeof value.id === 'string'
    && typeof value.state === 'string'
    && (!('results' in value) || Array.isArray(value.results))
  );
}

function isReview(value: unknown): value is LiteratureReview {
  return (
    isRecord(value)
    && isRecord(value.configuration)
    && isRecord(value.criteria)
    && typeof value.id === 'string'
    && typeof value.protocol === 'string'
    && typeof value.question === 'string'
    && typeof value.reviewer_mode === 'string'
    && Array.isArray(value.reviewers)
    && typeof value.status === 'string'
    && typeof value.title === 'string'
  );
}

function isReviewDetail(value: unknown): value is LiteratureReviewDetail {
  return (
    isRecord(value)
    && Array.isArray(value.activities)
    && Array.isArray(value.candidates)
    && isRecord(value.prisma)
    && isReview(value.review)
  );
}

function validated<T>(
  result: ApiResult<unknown>,
  guard: (value: unknown) => value is T,
  message: string,
): T {
  const payload = unwrapApiResult<unknown, unknown>(result);
  if (!guard(payload)) throw new GnosiApiError(result.response, message);
  return payload;
}

function recordResult(
  result: ApiResult<unknown>,
  message: string,
): LiteratureJson {
  return validated(result, isRecord, message);
}

export async function fetchLiteratureReviews(
  signal?: AbortSignal,
): Promise<readonly LiteratureReview[]> {
  const payload = recordResult(
    await apiClient.GET('/api/vault/literature/reviews', { signal }),
    'The API returned an invalid literature review list',
  );
  if (!Array.isArray(payload.reviews) || !payload.reviews.every(isReview)) {
    throw new GnosiApiError(
      new Response(null, { status: 502 }),
      'The API returned an invalid literature review list',
    );
  }
  return payload.reviews;
}

export async function fetchLiteratureReview(
  reviewId: string,
  signal?: AbortSignal,
): Promise<LiteratureReviewDetail> {
  return validated(
    await apiClient.GET('/api/vault/literature/reviews/{review_id}', {
      params: { path: { review_id: reviewId } },
      signal,
    }),
    isReviewDetail,
    'The API returned an invalid literature review',
  );
}

export async function createLiteratureReview(
  input: LiteratureReviewCreateInput,
  signal?: AbortSignal,
): Promise<LiteratureReview> {
  return validated(
    await apiClient.POST('/api/vault/literature/reviews', {
      body: input,
      signal,
    }),
    isReview,
    'The API returned an invalid literature review',
  );
}

export async function addLiteratureCandidates(
  reviewId: string,
  input: LiteratureCandidatesInput,
  signal?: AbortSignal,
): Promise<LiteratureJson> {
  return recordResult(
    await apiClient.POST('/api/vault/literature/reviews/{review_id}/candidates', {
      body: input as components['schemas']['CandidateRequest'],
      params: { path: { review_id: reviewId } },
      signal,
    }),
    'The API returned an invalid candidate mutation',
  );
}

export async function submitLiteratureDecision(
  reviewId: string,
  candidateId: string,
  input: LiteratureDecisionInput,
  signal?: AbortSignal,
): Promise<LiteratureJson> {
  return recordResult(
    await apiClient.POST(
      '/api/vault/literature/reviews/{review_id}/candidates/{candidate_id}/decisions',
      {
        body: input,
        params: { path: { candidate_id: candidateId, review_id: reviewId } },
        signal,
      },
    ),
    'The API returned an invalid screening decision',
  );
}

export async function resolveLiteratureConflict(
  reviewId: string,
  candidateId: string,
  input: LiteratureConsensusInput,
  signal?: AbortSignal,
): Promise<LiteratureJson> {
  return recordResult(
    await apiClient.POST(
      '/api/vault/literature/reviews/{review_id}/candidates/{candidate_id}/consensus',
      {
        body: input,
        params: { path: { candidate_id: candidateId, review_id: reviewId } },
        signal,
      },
    ),
    'The API returned an invalid screening resolution',
  );
}

export async function updateLiteratureFullText(
  reviewId: string,
  candidateId: string,
  input: LiteratureFullTextInput,
  signal?: AbortSignal,
): Promise<LiteratureJson> {
  return recordResult(
    await apiClient.PUT(
      '/api/vault/literature/reviews/{review_id}/candidates/{candidate_id}/full-text',
      {
        body: input as components['schemas']['FullTextRequest'],
        params: { path: { candidate_id: candidateId, review_id: reviewId } },
        signal,
      },
    ),
    'The API returned an invalid full-text update',
  );
}

export async function createLiteratureActivity(
  reviewId: string,
  input: LiteratureActivityInput,
  signal?: AbortSignal,
): Promise<LiteratureJson> {
  return recordResult(
    await apiClient.POST('/api/vault/literature/reviews/{review_id}/activities', {
      body: input as components['schemas']['ActivityRequest'],
      params: { path: { review_id: reviewId } },
      signal,
    }),
    'The API returned an invalid literature activity',
  );
}

export async function updateLiteratureReviewSchedule(
  reviewId: string,
  input: LiteratureScheduleInput,
  signal?: AbortSignal,
): Promise<LiteratureReview> {
  return validated(
    await apiClient.PUT('/api/vault/literature/reviews/{review_id}/schedule', {
      body: input,
      params: { path: { review_id: reviewId } },
      signal,
    }),
    isReview,
    'The API returned an invalid literature review schedule',
  );
}

export async function discoverLiteratureCitations(
  reviewId: string,
  input: LiteratureSnowballInput,
  signal?: AbortSignal,
): Promise<LiteratureSnowballResult> {
  const result = await apiClient.POST(
    '/api/vault/literature/reviews/{review_id}/snowball',
    {
      body: input,
      params: { path: { review_id: reviewId } },
      signal,
    },
  );
  const payload = recordResult(result, 'The API returned invalid citation expansion');
  if (
    typeof payload.provider !== 'string'
    || !Array.isArray(payload.works)
    || !isRecord(payload.exact_queries)
    || !isRecord(payload.counts)
  ) {
    throw new GnosiApiError(result.response, 'The API returned invalid citation expansion');
  }
  return payload as unknown as LiteratureSnowballResult;
}

export async function fetchLiteratureSearches(
  limit = 50,
  signal?: AbortSignal,
): Promise<readonly LiteratureSearch[]> {
  const result = await apiClient.GET('/api/vault/literature/searches', {
    params: { query: { limit } },
    signal,
  });
  const payload = recordResult(result, 'The API returned an invalid search history');
  if (!Array.isArray(payload.searches) || !payload.searches.every(isSearch)) {
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
  return validated(
    await apiClient.GET('/api/vault/literature/searches/{search_id}', {
      params: { path: { search_id: searchId }, query: { limit, offset } },
      signal,
    }),
    isSearch,
    'The API returned an invalid literature search',
  );
}

export async function createLiteratureSearch(
  input: LiteratureSearchInput,
  signal?: AbortSignal,
): Promise<LiteratureSearch> {
  return validated(
    await apiClient.POST('/api/vault/literature/searches', {
      body: input,
      signal,
    }),
    isSearch,
    'The API returned an invalid literature search',
  );
}

export async function cancelLiteratureSearch(
  searchId: string,
  signal?: AbortSignal,
): Promise<LiteratureSearch> {
  return validated(
    await apiClient.DELETE('/api/vault/literature/searches/{search_id}', {
      params: { path: { search_id: searchId } },
      signal,
    }),
    isSearch,
    'The API returned an invalid literature search',
  );
}

export async function runLiteratureAi(
  input: LiteratureAiInput,
  signal?: AbortSignal,
): Promise<LiteratureAiResult> {
  const result = await apiClient.POST('/api/vault/literature/ai', {
    body: input as components['schemas']['AiOperationRequest'],
    signal,
  });
  const payload = recordResult(result, 'The API returned an invalid literature AI result');
  if (
    typeof payload.operation !== 'string'
    || !isRecord(payload.audit)
    || !('result' in payload)
  ) {
    throw new GnosiApiError(result.response, 'The API returned an invalid literature AI result');
  }
  return payload as LiteratureAiResult;
}

export async function captureLiteratureWork(
  value: string,
  kind: 'arxiv' | 'auto' | 'doi' | 'isbn' | 'pmid' | 'url',
  signal?: AbortSignal,
): Promise<LiteratureWork> {
  const result = await apiClient.POST('/api/vault/literature/manual-capture', {
    body: { kind, value },
    signal,
  });
  const payload = recordResult(result, 'The API returned an invalid manual capture');
  if (!isRecord(payload.work)) {
    throw new GnosiApiError(result.response, 'The API returned an invalid manual capture');
  }
  return payload.work;
}

export async function importLiteratureWorks(
  works: LiteratureWork[],
  signal?: AbortSignal,
): Promise<LiteratureImportResult> {
  const result = await apiClient.POST('/api/vault/literature/imports', {
    // Keep the historical body: notebook defaults remain server-owned.
    body: { works } as components['schemas']['backend__api__literature_routes__ImportRequest'],
    signal,
  });
  const payload = recordResult(result, 'The API returned an invalid literature import');
  if (
    !Array.isArray(payload.imported)
    || !Array.isArray(payload.existing)
    || !Array.isArray(payload.resource_ids)
    || typeof payload.imported_count !== 'number'
    || typeof payload.existing_count !== 'number'
  ) {
    throw new GnosiApiError(result.response, 'The API returned an invalid literature import');
  }
  return payload as unknown as LiteratureImportResult;
}
