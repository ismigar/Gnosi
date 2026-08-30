import type { TFunction } from 'i18next';

import type {
  LiteratureAiResult,
  LiteratureJson,
  LiteratureReview,
  LiteratureReviewDetail,
  LiteratureSearch,
  LiteratureWork,
} from '../../shared/api/literature';

export type Translate = TFunction;
export type ManualKind = 'arxiv' | 'auto' | 'doi' | 'isbn' | 'pmid' | 'url';
export type ReviewMode = 'dual_blind' | 'single';
export type SnowballDirection = 'backward' | 'both' | 'forward';
export type ScreeningDecision = 'exclude' | 'include' | 'uncertain';
export type ConsensusDecision = 'exclude' | 'include';
export type FullTextStatus =
  | 'assessed'
  | 'attached'
  | 'available_oa'
  | 'not_requested'
  | 'requested'
  | 'unavailable';

export interface LiteratureFilters extends LiteratureJson {
  readonly date_from: string;
  readonly date_to: string;
  readonly full_text: boolean | null;
  readonly languages: readonly string[];
  readonly open_access: boolean | null;
  readonly peer_reviewed: boolean | null;
  readonly type: string;
}

export interface WorkAuthor {
  readonly family?: string;
  readonly given?: string;
  readonly literal?: string;
}

export interface WorkLocation {
  readonly is_oa?: boolean;
  readonly landing_page_url?: string;
  readonly license?: string;
  readonly pdf_url?: string;
  readonly url?: string;
}

export interface WorkSource {
  readonly provider: string;
  readonly provider_id: string;
  readonly url?: string;
}

export interface WorkConflict {
  readonly provider: string;
  readonly value: unknown;
}

export interface LiteratureWorkView extends LiteratureWork {
  readonly abstract?: string;
  readonly authors?: readonly WorkAuthor[];
  readonly conflicts?: Readonly<Record<string, readonly WorkConflict[]>>;
  readonly id: string;
  readonly identifiers?: {
    readonly arxiv?: string;
    readonly doi?: string;
    readonly isbn13?: readonly string[];
    readonly pmid?: string;
  };
  readonly in_resources?: boolean;
  readonly language?: string;
  readonly locations?: readonly WorkLocation[];
  readonly metrics?: { readonly citations?: Readonly<Record<string, number>> };
  readonly open_access?: { readonly is_oa?: boolean };
  readonly original_rank?: number;
  readonly possible_duplicates?: readonly unknown[];
  readonly provenance?: Readonly<Record<string, readonly string[]>>;
  readonly publication?: {
    readonly container_title?: string;
    readonly publisher?: string;
  };
  readonly resource_id?: string | null;
  readonly semantic_rank?: number;
  readonly sources?: readonly WorkSource[];
  readonly title: string;
  readonly year?: number | string;
}

export interface SearchError extends LiteratureJson {
  readonly message?: string;
  readonly source_id?: string;
}

export interface SearchSourceStatus {
  readonly count?: number;
  readonly state?: string;
}

export interface SearchAudit {
  readonly connector_version?: number;
  readonly provider_syntax?: unknown;
  readonly requests?: readonly unknown[];
  readonly source_name?: string;
}

export interface LiteratureSearchView extends LiteratureSearch {
  readonly ai_audits?: readonly LiteratureJson[];
  readonly counts?: Readonly<Record<string, number>>;
  readonly errors?: readonly SearchError[];
  readonly exact_queries?: Readonly<Record<string, SearchAudit>>;
  readonly filters?: LiteratureJson;
  readonly limit_per_source?: number;
  readonly results?: readonly LiteratureWorkView[];
  readonly source_snapshots?: readonly LiteratureJson[];
  readonly source_status?: Readonly<Record<string, SearchSourceStatus>>;
}

export interface ReviewSchedule {
  readonly enabled?: boolean;
  readonly interval_days?: number;
  readonly strategy?: LiteratureJson;
}

export interface LiteratureReviewView extends LiteratureReview {
  readonly configuration: LiteratureJson & { readonly schedule?: ReviewSchedule };
  readonly criteria: LiteratureJson & {
    readonly exclude?: readonly string[];
    readonly include?: readonly string[];
  };
}

export interface FullTextEvidence {
  readonly location_url?: string;
  readonly notes?: string;
}

export interface LiteratureCandidate extends LiteratureJson {
  readonly blind_pending?: boolean;
  readonly conflict?: boolean;
  readonly full_text?: FullTextStatus;
  readonly full_text_evidence?: FullTextEvidence;
  readonly id: string;
  readonly phase: string;
  readonly resource_id?: string;
  readonly title: string;
  readonly work: LiteratureWorkView;
}

export interface LiteratureActivity extends LiteratureJson {
  readonly activity_type?: string;
  readonly errors?: readonly unknown[];
  readonly exact_queries?: LiteratureJson;
  readonly id: string;
  readonly occurred_at?: string;
  readonly version?: number;
}

export interface PrismaSummary {
  readonly duplicates_removed?: number;
  readonly identified?: number;
  readonly included?: number;
  readonly screened?: number;
}

export interface LiteratureReviewDetailView extends LiteratureReviewDetail {
  readonly activities: readonly LiteratureActivity[];
  readonly candidates: readonly LiteratureCandidate[];
  readonly prisma: LiteratureJson & PrismaSummary;
  readonly review: LiteratureReviewView;
}

export interface AiPayload extends LiteratureJson {
  readonly boolean_query?: string;
  readonly cautions?: unknown;
  readonly concepts?: Readonly<Record<string, unknown>>;
  readonly ranking?: readonly {
    readonly id: string;
    readonly original_rank?: number;
    readonly semantic_rank?: number;
  }[];
  readonly source_id?: string;
  readonly synonyms?: Readonly<Record<string, unknown>>;
  readonly translated_query?: string;
  readonly warnings?: readonly unknown[];
}

export interface LiteratureAiResultView extends LiteratureAiResult {
  readonly audit: LiteratureJson & { readonly model?: string };
  readonly result: AiPayload;
}

export interface LiteratureAgent {
  readonly id: string;
  readonly model?: string;
  readonly name: string;
}

export function asWork(value: LiteratureWork): LiteratureWorkView {
  return value as LiteratureWorkView;
}

export function asSearch(value: LiteratureSearch): LiteratureSearchView {
  return value as LiteratureSearchView;
}

export function asReview(value: LiteratureReview): LiteratureReviewView {
  return value;
}

export function asReviewDetail(
  value: LiteratureReviewDetail,
): LiteratureReviewDetailView {
  return value as unknown as LiteratureReviewDetailView;
}

export function asAiResult(value: LiteratureAiResult): LiteratureAiResultView {
  const result = isRecord(value.result) ? value.result : {};
  return { ...value, result };
}

export function isRecord(value: unknown): value is LiteratureJson {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function agentsFromConfiguration(
  values: readonly LiteratureJson[],
): readonly LiteratureAgent[] {
  return values.flatMap((value) => (
    typeof value.id === 'string' && typeof value.name === 'string'
      ? [{
          id: value.id,
          model: typeof value.model === 'string' ? value.model : undefined,
          name: value.name,
        }]
      : []
  ));
}
