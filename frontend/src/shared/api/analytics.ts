import type { components } from '../../generated/openapi';
import { apiClient } from './client';
import { unwrapApiResult } from './errors';

export type AnalyticsOverview =
  components['schemas']['AnalyticsOverviewResponse'];
export type ToolAnalytics = components['schemas']['ToolAnalyticsResponse'];
export type DirectiveAnalyticsPage =
  components['schemas']['DirectiveAnalyticsPageResponse'];
export type DirectiveAnalytics =
  components['schemas']['DirectiveAnalyticsResponse'];
export type TrapAnalyticsPage =
  components['schemas']['TrapAnalyticsPageResponse'];
export type DirectiveContent =
  components['schemas']['DirectiveContentResponse'];
export type DirectiveContentUpdate =
  components['schemas']['DirectiveContentUpdateRequest'];
export type DirectiveMutation =
  components['schemas']['DirectiveMutationResponse'];

export interface AnalyticsPageQuery {
  readonly limit?: number;
  readonly offset?: number;
}

export async function fetchAnalyticsOverview(
  signal?: AbortSignal,
): Promise<AnalyticsOverview> {
  return unwrapApiResult<AnalyticsOverview, unknown>(
    await apiClient.GET('/api/analytics/', { signal }),
  );
}

export async function fetchToolAnalytics(
  signal?: AbortSignal,
): Promise<ToolAnalytics> {
  return unwrapApiResult<ToolAnalytics, unknown>(
    await apiClient.GET('/api/analytics/tools', { signal }),
  );
}

export async function fetchDirectiveAnalytics(
  query: AnalyticsPageQuery = {},
  signal?: AbortSignal,
): Promise<DirectiveAnalyticsPage> {
  return unwrapApiResult<DirectiveAnalyticsPage, unknown>(
    await apiClient.GET('/api/analytics/directives', {
      params: { query: { limit: query.limit, offset: query.offset } },
      signal,
    }),
  );
}

export async function fetchTrapAnalytics(
  query: AnalyticsPageQuery = {},
  signal?: AbortSignal,
): Promise<TrapAnalyticsPage> {
  return unwrapApiResult<TrapAnalyticsPage, unknown>(
    await apiClient.GET('/api/analytics/traps', {
      params: { query: { limit: query.limit, offset: query.offset } },
      signal,
    }),
  );
}

export async function fetchDirectiveContent(
  path: string,
  signal?: AbortSignal,
): Promise<DirectiveContent> {
  return unwrapApiResult<DirectiveContent, unknown>(
    await apiClient.GET('/api/analytics/directives/content', {
      params: { query: { path } },
      signal,
    }),
  );
}

export async function saveDirectiveContent(
  update: DirectiveContentUpdate,
): Promise<DirectiveMutation> {
  return unwrapApiResult<DirectiveMutation, unknown>(
    await apiClient.POST('/api/analytics/directives/content', { body: update }),
  );
}

export async function deleteDirective(path: string): Promise<DirectiveMutation> {
  return unwrapApiResult<DirectiveMutation, unknown>(
    await apiClient.DELETE('/api/analytics/directives', {
      params: { query: { path } },
    }),
  );
}
