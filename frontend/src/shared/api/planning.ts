import type { components } from '../../generated/openapi';
import { apiClient } from './client';
import { unwrapApiResult } from './errors';


export type PlanningState = components['schemas']['PlanningStateResponse'];
export type PlanningAllocation = components['schemas']['AllocationResponse'];
export type ProjectSchedule = components['schemas']['ProjectScheduleResponse'];
export type PlanningBaseline = components['schemas']['BaselineRecordResponse'];
export type PlanningBaselineList = components['schemas']['BaselineListResponse'];
export type PlanningBaselineInput = components['schemas']['BaselinePayload'];
export type PlanningWorklog = components['schemas']['WorklogResponse'];
export type PlanningWorklogList = components['schemas']['WorklogListResponse'];
export type PlanningWorklogInput = components['schemas']['WorklogPayload'];
export type PlanningLevelingPreview =
  components['schemas']['LevelingProposalResponse'];
export type PlanningLevelingProposal =
  components['schemas']['StoredLevelingProposalResponse'];
export type PlanningLevelingApplyInput =
  components['schemas']['ProposalApplyPayload'];
export type PlanningLevelingApplyResult =
  components['schemas']['LevelingApplyResponse'];
export type PlanningCalendarInput = components['schemas']['CalendarPayload'];
export type PlanningCalendarMutation =
  components['schemas']['CalendarMutationResponse'];
export type PlanningResourceInput = components['schemas']['ResourcePayload'];
export type PlanningResourceMutation =
  components['schemas']['ResourceMutationResponse'];
export type PlanningAssignmentInput = components['schemas']['AssignmentPayload'];
export type PlanningAssignmentMutation =
  components['schemas']['AssignmentMutationResponse'];
export type PlanningDeletion = components['schemas']['PlanningDeletionResponse'];


export interface PlanningBaselineMutationInput {
  readonly baseline: PlanningBaselineInput;
  readonly projectId: string;
}


export interface PlanningLevelingApplyMutationInput {
  readonly proposal: PlanningLevelingApplyInput;
  readonly proposalId: string;
}


export interface PlanningCalendarMutationInput {
  readonly calendar: PlanningCalendarInput;
  readonly calendarId: string;
}


export async function fetchPlanningState(): Promise<PlanningState> {
  return unwrapApiResult<PlanningState, unknown>(
    await apiClient.GET('/api/planning/state'),
  );
}


export async function fetchPlanningAllocation(): Promise<PlanningAllocation> {
  return unwrapApiResult<PlanningAllocation, unknown>(
    await apiClient.GET('/api/planning/allocation'),
  );
}


export async function fetchProjectSchedule(projectId: string): Promise<ProjectSchedule> {
  return unwrapApiResult<ProjectSchedule, unknown>(
    await apiClient.GET('/api/planning/projects/{project_id}/schedule', {
      params: { path: { project_id: projectId } },
    }),
  );
}


export async function fetchPlanningBaselines(
  projectId: string,
): Promise<PlanningBaselineList> {
  return unwrapApiResult<PlanningBaselineList, unknown>(
    await apiClient.GET('/api/planning/projects/{project_id}/baselines', {
      params: { path: { project_id: projectId } },
    }),
  );
}


export async function createPlanningBaseline({
  baseline,
  projectId,
}: PlanningBaselineMutationInput): Promise<PlanningBaseline> {
  const result = unwrapApiResult<
    components['schemas']['BaselineCreateResponse'],
    unknown
  >(
    await apiClient.POST('/api/planning/projects/{project_id}/baselines', {
      body: baseline,
      params: { path: { project_id: projectId } },
    }),
  );
  return result.baseline;
}


export async function fetchPlanningWorklogs(
  taskId?: string,
): Promise<PlanningWorklogList> {
  return unwrapApiResult<PlanningWorklogList, unknown>(
    await apiClient.GET('/api/planning/worklogs', {
      params: { query: { task_id: taskId } },
    }),
  );
}


export async function createPlanningWorklog(
  worklog: PlanningWorklogInput,
): Promise<PlanningWorklog> {
  const result = unwrapApiResult<
    components['schemas']['WorklogCreateResponse'],
    unknown
  >(await apiClient.POST('/api/planning/worklogs', { body: worklog }));
  return result.worklog;
}


export async function fetchPlanningLevelingPreview(): Promise<PlanningLevelingPreview> {
  return unwrapApiResult<PlanningLevelingPreview, unknown>(
    await apiClient.GET('/api/planning/leveling/proposal'),
  );
}


export async function createPlanningLevelingProposal(
  projectId: string,
): Promise<PlanningLevelingProposal> {
  return unwrapApiResult<PlanningLevelingProposal, unknown>(
    await apiClient.POST('/api/planning/projects/{project_id}/leveling/proposals', {
      params: { path: { project_id: projectId } },
    }),
  );
}


export async function applyPlanningLevelingProposal({
  proposal,
  proposalId,
}: PlanningLevelingApplyMutationInput): Promise<PlanningLevelingApplyResult> {
  return unwrapApiResult<PlanningLevelingApplyResult, unknown>(
    await apiClient.POST('/api/planning/leveling/proposals/{proposal_id}/apply', {
      body: proposal,
      params: { path: { proposal_id: proposalId } },
    }),
  );
}


export async function createPlanningCalendar(
  calendar: PlanningCalendarInput,
): Promise<PlanningCalendarMutation> {
  return unwrapApiResult<PlanningCalendarMutation, unknown>(
    await apiClient.POST('/api/planning/calendars', { body: calendar }),
  );
}


export async function updatePlanningCalendar({
  calendar,
  calendarId,
}: PlanningCalendarMutationInput): Promise<PlanningCalendarMutation> {
  return unwrapApiResult<PlanningCalendarMutation, unknown>(
    await apiClient.PATCH('/api/planning/calendars/{calendar_id}', {
      body: calendar,
      params: { path: { calendar_id: calendarId } },
    }),
  );
}


export async function deletePlanningCalendar(calendarId: string): Promise<PlanningDeletion> {
  return unwrapApiResult<PlanningDeletion, unknown>(
    await apiClient.DELETE('/api/planning/calendars/{calendar_id}', {
      params: { path: { calendar_id: calendarId } },
    }),
  );
}


export async function createPlanningResource(
  resource: PlanningResourceInput,
): Promise<PlanningResourceMutation> {
  return unwrapApiResult<PlanningResourceMutation, unknown>(
    await apiClient.POST('/api/planning/resources', { body: resource }),
  );
}


export async function deletePlanningResource(resourceId: string): Promise<PlanningDeletion> {
  return unwrapApiResult<PlanningDeletion, unknown>(
    await apiClient.DELETE('/api/planning/resources/{resource_id}', {
      params: { path: { resource_id: resourceId } },
    }),
  );
}


export async function createPlanningAssignment(
  assignment: PlanningAssignmentInput,
): Promise<PlanningAssignmentMutation> {
  return unwrapApiResult<PlanningAssignmentMutation, unknown>(
    await apiClient.POST('/api/planning/assignments', { body: assignment }),
  );
}


export async function deletePlanningAssignment(
  assignmentId: string,
): Promise<PlanningDeletion> {
  return unwrapApiResult<PlanningDeletion, unknown>(
    await apiClient.DELETE('/api/planning/assignments/{assignment_id}', {
      params: { path: { assignment_id: assignmentId } },
    }),
  );
}
