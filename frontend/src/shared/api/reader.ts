import type { components } from '../../generated/openapi';
import { apiClient } from './client';
import { unwrapApiResult } from './errors';


export type ReaderSource = components['schemas']['FeedSourceResponse'];
type GeneratedReaderSourceInput = components['schemas']['FeedSourceCreate'];
export type ReaderSourceInput = Pick<GeneratedReaderSourceInput, 'name' | 'url'> &
  Partial<Omit<GeneratedReaderSourceInput, 'name' | 'url'>>;
export type ReaderArticle = components['schemas']['ArticleResponse'];
export type ReaderInventory = components['schemas']['ReaderInventoryResponse'];
export type NewsletterAccount = components['schemas']['NewsletterAccountResponse'];
export type NewsletterAccountUpdate =
  components['schemas']['NewsletterAccountUpdate'];
export type NewsletterConnectionTest =
  components['schemas']['NewsletterConnectionTestResponse'];
export type NewsletterSyncResult = components['schemas']['NewsletterSyncResponse'];
export type ReaderMessage = components['schemas']['ReaderMessageResponse'];
type GeneratedReaderAnalysisInput = components['schemas']['ReaderAnalysisRequest'];
export type ReaderAnalysisInput = Partial<GeneratedReaderAnalysisInput>;
export type ReaderAnalysisJob =
  components['schemas']['ReaderAnalysisJobResponse'];
export type ReaderAnalysisResult =
  components['schemas']['ReaderAnalysisResultResponse'];
export type ReaderArticleExtractResult =
  components['schemas']['ReaderArticleExtractResponse'];
export type ReaderBackfillStatus =
  components['schemas']['ReaderBackfillStatusResponse'];
export type ReaderBackfillTrigger =
  components['schemas']['ReaderBackfillTriggerResponse'];
export type ReaderPodcastGeneration =
  components['schemas']['ReaderPodcastGenerationResponse'];
export type ReaderPodcastStatus =
  components['schemas']['ReaderPodcastStatusResponse'];
export type ReaderPodcastInfo =
  components['schemas']['ReaderPodcastInfoResponse'];


export interface ReaderArticlesQuery {
  readonly limit?: number;
  readonly sourceIds?: number[];
  readonly unreadOnly?: boolean;
}


export interface ReaderInventoryQuery {
  readonly categories?: string[];
  readonly dateFrom?: string;
  readonly dateTo?: string;
  readonly sourceIds?: number[];
  readonly unreadOnly?: boolean;
}


export async function fetchReaderSources(): Promise<ReaderSource[]> {
  return unwrapApiResult<ReaderSource[], unknown>(
    await apiClient.GET('/api/reader/sources'),
  );
}


export async function createReaderSource(
  input: ReaderSourceInput,
): Promise<ReaderSource> {
  return unwrapApiResult<ReaderSource, unknown>(
    await apiClient.POST('/api/reader/sources', {
      body: {
        category: 'Uncategorized',
        type: 'rss',
        ...input,
      },
    }),
  );
}


export async function deleteReaderSource(sourceId: number): Promise<ReaderMessage> {
  return unwrapApiResult<ReaderMessage, unknown>(
    await apiClient.DELETE('/api/reader/sources/{source_id}', {
      params: { path: { source_id: sourceId } },
    }),
  );
}


export async function importReaderOpml(file: File): Promise<ReaderMessage> {
  return unwrapApiResult<ReaderMessage, unknown>(
    await apiClient.POST('/api/reader/sources/opml', {
      body: { file: file.name },
      bodySerializer: () => {
        const data = new FormData();
        data.append('file', file);
        return data;
      },
    }),
  );
}


export async function fetchNewsletterAccount(): Promise<NewsletterAccount> {
  return unwrapApiResult<NewsletterAccount, unknown>(
    await apiClient.GET('/api/reader/newsletter-account'),
  );
}


export async function updateNewsletterAccount(
  input: NewsletterAccountUpdate,
): Promise<NewsletterAccount> {
  return unwrapApiResult<NewsletterAccount, unknown>(
    await apiClient.PUT('/api/reader/newsletter-account', { body: input }),
  );
}


export async function testNewsletterAccount(
  input?: NewsletterAccountUpdate,
): Promise<NewsletterConnectionTest> {
  return unwrapApiResult<NewsletterConnectionTest, unknown>(
    await apiClient.POST('/api/reader/newsletter-account/test', {
      body: input ?? null,
    }),
  );
}


export async function syncNewsletterAccount(): Promise<NewsletterSyncResult> {
  return unwrapApiResult<NewsletterSyncResult, unknown>(
    await apiClient.POST('/api/reader/newsletter-account/sync'),
  );
}


export async function fetchReaderInventory(
  query: ReaderInventoryQuery = {},
): Promise<ReaderInventory> {
  return unwrapApiResult<ReaderInventory, unknown>(
    await apiClient.GET('/api/reader/inventory', {
      params: {
        query: {
          category: query.categories,
          date_from: query.dateFrom,
          date_to: query.dateTo,
          source_id: query.sourceIds,
          unread_only: query.unreadOnly,
        },
      },
    }),
  );
}


export async function startReaderAnalysis(
  input: ReaderAnalysisInput = {},
): Promise<ReaderAnalysisJob> {
  return unwrapApiResult<ReaderAnalysisJob, unknown>(
    await apiClient.POST('/api/reader/analysis', {
      body: {
        categories: [],
        date_from: '',
        date_to: '',
        guidance: '',
        language: 'Catalan',
        source_ids: [],
        unread_only: true,
        ...input,
      },
    }),
  );
}


export async function fetchReaderAnalyses(limit = 20): Promise<ReaderAnalysisJob[]> {
  return unwrapApiResult<ReaderAnalysisJob[], unknown>(
    await apiClient.GET('/api/reader/analysis', {
      params: { query: { limit } },
    }),
  );
}


export async function fetchReaderAnalysis(jobId: string): Promise<ReaderAnalysisJob> {
  return unwrapApiResult<ReaderAnalysisJob, unknown>(
    await apiClient.GET('/api/reader/analysis/{job_id}', {
      params: { path: { job_id: jobId } },
    }),
  );
}


export async function fetchReaderAnalysisResult(
  jobId: string,
): Promise<ReaderAnalysisResult> {
  return unwrapApiResult<ReaderAnalysisResult, unknown>(
    await apiClient.GET('/api/reader/analysis/{job_id}/result', {
      params: { path: { job_id: jobId } },
    }),
  );
}


export async function resumeReaderAnalysis(jobId: string): Promise<ReaderAnalysisJob> {
  return unwrapApiResult<ReaderAnalysisJob, unknown>(
    await apiClient.POST('/api/reader/analysis/{job_id}/resume', {
      params: { path: { job_id: jobId } },
    }),
  );
}


export async function cancelReaderAnalysis(jobId: string): Promise<ReaderAnalysisJob> {
  return unwrapApiResult<ReaderAnalysisJob, unknown>(
    await apiClient.POST('/api/reader/analysis/{job_id}/cancel', {
      params: { path: { job_id: jobId } },
    }),
  );
}


export async function fetchReaderArticles(
  query: ReaderArticlesQuery = {},
): Promise<ReaderArticle[]> {
  return unwrapApiResult<ReaderArticle[], unknown>(
    await apiClient.GET('/api/reader/articles', {
      params: {
        query: {
          limit: query.limit,
          source_id: query.sourceIds,
          unread_only: query.unreadOnly,
        },
      },
    }),
  );
}


export async function fetchReaderArticle(articleId: number): Promise<ReaderArticle> {
  return unwrapApiResult<ReaderArticle, unknown>(
    await apiClient.GET('/api/reader/articles/{article_id}', {
      params: { path: { article_id: articleId } },
    }),
  );
}


export async function markReaderArticleRead(
  articleId: number,
  read = true,
): Promise<ReaderMessage> {
  return unwrapApiResult<ReaderMessage, unknown>(
    await apiClient.PATCH('/api/reader/articles/{article_id}/read', {
      params: {
        path: { article_id: articleId },
        query: { read },
      },
    }),
  );
}


export async function extractReaderArticle(
  articleId: number,
): Promise<ReaderArticleExtractResult> {
  return unwrapApiResult<ReaderArticleExtractResult, unknown>(
    await apiClient.POST('/api/reader/articles/{article_id}/extract', {
      params: { path: { article_id: articleId } },
    }),
  );
}


export async function triggerReaderBackfill(): Promise<ReaderBackfillTrigger> {
  return unwrapApiResult<ReaderBackfillTrigger, unknown>(
    await apiClient.POST('/api/reader/articles/backfill-extract'),
  );
}


export async function fetchReaderBackfillStatus(): Promise<ReaderBackfillStatus> {
  return unwrapApiResult<ReaderBackfillStatus, unknown>(
    await apiClient.GET('/api/reader/articles/backfill-extract/status'),
  );
}


export async function generateReaderPodcast(): Promise<ReaderPodcastGeneration> {
  return unwrapApiResult<ReaderPodcastGeneration, unknown>(
    await apiClient.POST('/api/reader/podcast/generate'),
  );
}


export async function fetchReaderPodcastStatus(): Promise<ReaderPodcastStatus> {
  return unwrapApiResult<ReaderPodcastStatus, unknown>(
    await apiClient.GET('/api/reader/podcast/status'),
  );
}


export async function fetchReaderPodcastInfo(): Promise<ReaderPodcastInfo> {
  return unwrapApiResult<ReaderPodcastInfo, unknown>(
    await apiClient.GET('/api/reader/podcast/info'),
  );
}


export function readerPodcastUrl(cacheBust?: number): string {
  const path = '/api/reader/podcast/latest';
  return cacheBust === undefined ? path : `${path}?t=${String(cacheBust)}`;
}
