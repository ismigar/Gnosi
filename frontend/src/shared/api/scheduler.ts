import type { components } from '../../generated/openapi';
import { apiClient } from './client';
import { unwrapApiResult } from './errors';


export type ScheduledTask = components['schemas']['ScheduledTaskResponse'];
export type ScheduledTaskUpdate = components['schemas']['TaskUpdate'];
export type ScheduledTaskUpdateResult = components['schemas']['TaskUpdateResponse'];
export type ScheduledTaskRunResult = components['schemas']['TaskRunResponse'];
export type SchedulerHistory = components['schemas']['TaskHistoryPageResponse'];
export type SchedulerHistoryClearResult =
  components['schemas']['ClearTaskHistoryResponse'];


export interface UpdateScheduledTaskInput {
  readonly name: string;
  readonly update: ScheduledTaskUpdate;
}


export interface SchedulerHistoryQuery {
  readonly limit?: number;
  readonly offset?: number;
  readonly taskName?: string;
}


export async function fetchScheduledTasks(): Promise<ScheduledTask[]> {
  return unwrapApiResult<ScheduledTask[], unknown>(
    await apiClient.GET('/api/schedulers'),
  );
}


export async function updateScheduledTask({
  name,
  update,
}: UpdateScheduledTaskInput): Promise<ScheduledTaskUpdateResult> {
  return unwrapApiResult<ScheduledTaskUpdateResult, unknown>(
    await apiClient.PUT('/api/schedulers/{name}', {
      body: update,
      params: { path: { name } },
    }),
  );
}


export async function runScheduledTask(
  name: string,
): Promise<ScheduledTaskRunResult> {
  return unwrapApiResult<ScheduledTaskRunResult, unknown>(
    await apiClient.POST('/api/schedulers/{name}/run', {
      params: { path: { name } },
    }),
  );
}


export async function fetchSchedulerHistory(
  query: SchedulerHistoryQuery = {},
): Promise<SchedulerHistory> {
  return unwrapApiResult<SchedulerHistory, unknown>(
    await apiClient.GET('/api/schedulers/history', {
      params: {
        query: {
          limit: query.limit,
          offset: query.offset,
          task_name: query.taskName,
        },
      },
    }),
  );
}


export async function clearSchedulerHistory(): Promise<SchedulerHistoryClearResult> {
  return unwrapApiResult<SchedulerHistoryClearResult, unknown>(
    await apiClient.DELETE('/api/schedulers/history'),
  );
}
