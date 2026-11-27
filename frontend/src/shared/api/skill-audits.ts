import type { components } from '../../generated/openapi';
import { apiClient } from './client';
import { unwrapApiResult } from './errors';

export type SkillAuditSuite = components['schemas']['SkillAuditSuite'];
export type SkillAuditSuiteCreate = components['schemas']['SkillAuditSuiteCreate'];
export type SkillAuditRun = components['schemas']['SkillAuditRun'];

export async function fetchSkillAuditSuites(signal?: AbortSignal): Promise<SkillAuditSuite[]> {
  return unwrapApiResult<SkillAuditSuite[], unknown>(await apiClient.GET('/api/agent/runs/skill-audits', { signal }));
}

export async function createSkillAuditSuite(body: SkillAuditSuiteCreate): Promise<SkillAuditSuite> {
  return unwrapApiResult<SkillAuditSuite, unknown>(await apiClient.POST('/api/agent/runs/skill-audits', { body }));
}

export async function deleteSkillAuditSuite(suiteId: string): Promise<void> {
  unwrapApiResult(await apiClient.DELETE('/api/agent/runs/skill-audits/{suite_id}', { params: { path: { suite_id: suiteId } } }));
}

export async function runSkillAuditSuite(suiteId: string): Promise<SkillAuditRun> {
  return unwrapApiResult<SkillAuditRun, unknown>(
    await apiClient.POST('/api/agent/runs/skill-audits/{suite_id}/run', { params: { path: { suite_id: suiteId } } }),
  );
}
