import type { components } from '../../generated/openapi';
import { apiClient } from './client';
import { unwrapApiResult } from './errors';


export type SystemNotification = components['schemas']['NotificationResponse'];
type GeneratedSystemNotificationInput = components['schemas']['NotificationCreate'];
export type SystemNotificationInput = Pick<GeneratedSystemNotificationInput, 'title'> &
  Partial<Omit<GeneratedSystemNotificationInput, 'title'>>;
export type SystemNotificationPage =
  components['schemas']['NotificationPageResponse'];
export type ClearSystemNotificationsResult =
  components['schemas']['ClearNotificationsResponse'];
export type FilesystemBrowseResult =
  components['schemas']['FilesystemBrowseResponse'];
export type FilesystemSearchResult =
  components['schemas']['FilesystemSearchResponse'];
export type NativePickAvailability =
  components['schemas']['NativePickAvailabilityResponse'];
export type NativePickResult = components['schemas']['NativePickResponse'];
export type NativePickInput = components['schemas']['NativePickRequest'];
export type SystemStats = components['schemas']['SystemStatsResponse'];
export type SystemGraphVisualization =
  components['schemas']['SystemGraphVisualizationResponse'];


export interface SystemNotificationsQuery {
  readonly limit?: number;
  readonly offset?: number;
}


export interface SearchFilesystemInput {
  readonly limit?: number;
  readonly query: string;
}


export async function fetchSystemNotifications(
  query: SystemNotificationsQuery = {},
): Promise<SystemNotificationPage> {
  return unwrapApiResult<SystemNotificationPage, unknown>(
    await apiClient.GET('/api/system/notifications', {
      params: { query },
    }),
  );
}


export async function createSystemNotification(
  input: SystemNotificationInput,
  keepalive = false,
): Promise<SystemNotification> {
  return unwrapApiResult<SystemNotification, unknown>(
    await apiClient.POST('/api/system/notifications', {
      body: {
        level: 'INFO',
        message: '',
        workspace_id: 'default',
        ...input,
      },
      keepalive,
    }),
  );
}


export async function clearSystemNotifications(): Promise<ClearSystemNotificationsResult> {
  return unwrapApiResult<ClearSystemNotificationsResult, unknown>(
    await apiClient.DELETE('/api/system/notifications'),
  );
}


export async function fetchSystemStats(): Promise<SystemStats> {
  return unwrapApiResult<SystemStats, unknown>(
    await apiClient.GET('/api/system/stats'),
  );
}


export async function fetchSystemGraphVisualization(): Promise<SystemGraphVisualization> {
  return unwrapApiResult<SystemGraphVisualization, unknown>(
    await apiClient.GET('/api/system/graph/visualization'),
  );
}


export async function browseFilesystem(path = '/'): Promise<FilesystemBrowseResult> {
  return unwrapApiResult<FilesystemBrowseResult, unknown>(
    await apiClient.POST('/api/system/browse', { body: { path } }),
  );
}


export async function fetchNativePickAvailability(): Promise<NativePickAvailability> {
  return unwrapApiResult<NativePickAvailability, unknown>(
    await apiClient.GET('/api/system/native-pick/available'),
  );
}


export async function pickNativeFilesystemEntry(
  input: Partial<NativePickInput> = {},
): Promise<NativePickResult> {
  return unwrapApiResult<NativePickResult, unknown>(
    await apiClient.POST('/api/system/native-pick', {
      body: {
        mode: 'any',
        multiple: false,
        prompt: '',
        ...input,
      },
    }),
  );
}


export async function searchFilesystem({
  limit = 100,
  query,
}: SearchFilesystemInput): Promise<FilesystemSearchResult> {
  return unwrapApiResult<FilesystemSearchResult, unknown>(
    await apiClient.POST('/api/system/search', {
      body: { limit, query },
    }),
  );
}
