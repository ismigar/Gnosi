import type { components } from '../../generated/openapi';
import { apiClient } from './client';
import { unwrapApiResult } from './errors';

export type UsageDashboard = components['schemas']['AiUsageDashboardResponse'];
export type UsageRequests = components['schemas']['AiUsageRequestsResponse'];
export type UsageSummary = components['schemas']['AiUsageSummaryResponse'];
export type ConsumptionGroup = 'model' | 'provider' | 'agent' | 'operation' | 'origin' | 'profile';
export interface ConsumptionQuery {
    start: string;
    end: string;
    timezone: string;
    group_by: ConsumptionGroup;
    granularity: 'day' | 'month';
    provider?: string;
    model?: string;
    agent?: string;
    operation?: string;
    origin?: string;
    profile?: string;
}
export async function fetchConsumption(query: ConsumptionQuery, signal?: AbortSignal): Promise<UsageDashboard> {
    return unwrapApiResult(await apiClient.GET('/api/ai/usage/dashboard', { params: { query }, signal }));
}
export async function fetchConsumptionRequests(query: ConsumptionQuery, page: number, signal?: AbortSignal): Promise<UsageRequests> {
    return unwrapApiResult(await apiClient.GET('/api/ai/usage/requests', { params: { query: { ...query, page, page_size: 25 } }, signal }));
}
export async function exportConsumption(query: ConsumptionQuery): Promise<string> {
    return unwrapApiResult(await apiClient.GET('/api/ai/usage/export', { params: { query }, parseAs: 'text' }));
}
