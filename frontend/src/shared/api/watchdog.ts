import type { components } from '../../generated/openapi';
import { apiClient } from './client';
import { unwrapApiResult } from './errors';

export type WatchdogAlert = components['schemas']['WatchdogAlert'];
export type WatchdogSweepRequest = components['schemas']['WatchdogSweepRequest'];
export type WatchdogSweepResult = components['schemas']['WatchdogSweepResult'];

export async function fetchWatchdogAlerts(signal?: AbortSignal): Promise<WatchdogAlert[]> {
  return unwrapApiResult<WatchdogAlert[], unknown>(await apiClient.GET('/api/agent/runs/watchdog/alerts', { signal }));
}

export async function runWatchdogSweep(body?: WatchdogSweepRequest): Promise<WatchdogSweepResult> {
  return unwrapApiResult<WatchdogSweepResult, unknown>(await apiClient.POST('/api/agent/runs/watchdog/sweep', { body }));
}

export async function dismissWatchdogAlert(alertId: string): Promise<WatchdogAlert> {
  return unwrapApiResult<WatchdogAlert, unknown>(
    await apiClient.POST('/api/agent/runs/watchdog/alerts/{alert_id}/dismiss', { params: { path: { alert_id: alertId } } }),
  );
}
