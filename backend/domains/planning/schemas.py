"""Pydantic contracts for the public project-planning API."""

from __future__ import annotations

from typing import Any, Literal, TypedDict

from pydantic import BaseModel, ConfigDict, JsonValue


class CalendarPayload(BaseModel):
    """Backward-compatible create/update payload for a work calendar."""

    name: str | None = None
    working_weekdays: list[int] | None = None
    holidays: list[str] | None = None
    hours_per_day: float | None = None
    workday_start: str | None = None


class ResourcePayload(BaseModel):
    """Backward-compatible create/update payload for a planning resource."""

    name: str | None = None
    type: str | None = None
    calendar_id: str | None = None
    availability_units: float | None = None
    standard_rate: float | None = None
    overtime_rate: float | None = None
    cost_per_use: float | None = None
    active: bool | None = None
    rate_history: list[dict[str, Any]] | None = None


class AssignmentPayload(BaseModel):
    """Backward-compatible create/update payload for an assignment."""

    project_id: str | None = None
    task_id: str | None = None
    resource_id: str | None = None
    units: float | None = None
    planned_work_hours: float | None = None
    remaining_work_hours: float | None = None
    actual_work_hours: float | None = None
    rate_override: float | None = None
    start: str | None = None
    end: str | None = None
    task_type: str | None = None
    effort_driven: bool | None = None
    overtime_work_hours: float | None = None
    material_quantity: float | None = None
    fixed_cost: float | None = None


class TaskFactPayload(BaseModel):
    """Markdown-owned task facts accepted by schedule recalculation."""

    id: str
    title: str | None = None
    period: dict[str, Any] = {}
    etag: str | None = None


class RecalculatePayload(BaseModel):
    """Task snapshot used to rebuild one project schedule."""

    tasks: list[TaskFactPayload] = []
    status_date: str | None = None


class BaselinePayload(BaseModel):
    """Named baseline request with an optional revision precondition."""

    name: str
    schedule_revision: int | None = None


class WorklogPayload(BaseModel):
    """Append-only actual-work entry."""

    task_id: str
    resource_id: str | None = None
    date: str
    hours: float
    correction_of: str | None = None


class RecurrencePayload(BaseModel):
    """RRULE declaration tied to one source task."""

    task_id: str
    rrule: str
    exdates: list[str] = []


class ProposalApplyPayload(BaseModel):
    """Optimistic-concurrency inputs for accepting a leveling proposal."""

    schedule_revision: int
    etags: dict[str, str] = {}


class StoredPlanningRecord(BaseModel):
    """Persisted record that retains additive fields from older Gnosi versions."""

    model_config = ConfigDict(extra="allow")


class RateHistoryEntryResponse(StoredPlanningRecord):
    """One optional effective resource rate retained in planning storage."""

    effective_from: str | None = None
    standard_rate: float | None = None


class CalendarResponse(StoredPlanningRecord):
    """Normalized work calendar."""

    id: str
    name: str
    working_weekdays: list[int]
    holidays: list[str]
    hours_per_day: float
    workday_start: str


class ResourceResponse(StoredPlanningRecord):
    """Normalized planning resource, including optional Gnosi 2 additions."""

    id: str
    name: str
    type: Literal["work", "material", "cost"]
    calendar_id: str | None
    availability_units: float
    standard_rate: float
    overtime_rate: float | None = None
    cost_per_use: float
    rate_history: list[RateHistoryEntryResponse] | None = None
    active: bool


class AssignmentResponse(StoredPlanningRecord):
    """Task-to-resource assignment, compatible with the shorter v1 record."""

    id: str
    project_id: str | None = None
    task_id: str
    resource_id: str
    units: float
    planned_work_hours: float
    remaining_work_hours: float
    actual_work_hours: float
    rate_override: float | None
    start: str | None
    end: str | None
    task_type: Literal["fixed_duration", "fixed_work", "fixed_units"] | None = None
    effort_driven: bool | None = None
    overtime_work_hours: float | None = None
    material_quantity: float | None = None
    fixed_cost: float | None = None


class RecurrenceResponse(StoredPlanningRecord):
    """Stored RRULE declaration and its optional materialization ledger."""

    id: str
    task_id: str
    rrule: str
    exdates: list[str] | None = None
    materialized_occurrences: list[str] | None = None


class PlanningDefaultsResponse(StoredPlanningRecord):
    """Vault-level planning defaults."""

    currency: str
    project_relation_field_id: str | None


class AssignmentSummaryResponse(BaseModel):
    """Cost and work totals derived for one assignment."""

    id: str
    task_id: str
    resource_id: str
    planned_work_hours: float
    remaining_work_hours: float
    actual_work_hours: float
    estimated_cost: float


class AllocationBucketResponse(BaseModel):
    """One resource/day capacity bucket."""

    resource_id: str
    resource_name: str
    date: str
    assigned_hours: float
    capacity_hours: float
    assignment_ids: list[str]
    overallocated_hours: float


class AllocationWarningResponse(BaseModel):
    """One derived resource-allocation warning."""

    code: str
    resource_id: str
    date: str
    message: str
    assignment_ids: list[str]


class AllocationResponse(BaseModel):
    """Rebuildable allocation and cost report."""

    revision: int
    assignment_summaries: list[AssignmentSummaryResponse]
    buckets: list[AllocationBucketResponse]
    warnings: list[AllocationWarningResponse]
    total_estimated_cost: float


class PlanningStateResponse(StoredPlanningRecord):
    """Vault planning state plus its derived allocation report."""

    version: int
    revision: int
    calendars: list[CalendarResponse]
    resources: list[ResourceResponse]
    assignments: list[AssignmentResponse]
    recurrences: list[RecurrenceResponse]
    defaults: PlanningDefaultsResponse
    allocation: AllocationResponse


class ScheduleDiagnosticResponse(StoredPlanningRecord):
    """Scheduling diagnostic for one task, several tasks, or the project."""

    code: str
    severity: str
    message: str
    taskId: str | None = None
    taskIds: list[str] | None = None


class PlanningScheduledTaskResponse(StoredPlanningRecord):
    """One calculated task, accepting fields absent from older cached schedules."""

    id: str
    title: str | None = None
    start: str | None = None
    end: str | None = None
    durationDays: float | None = None
    percentComplete: float | None = None
    actualStart: JsonValue = None
    actualEnd: JsonValue = None
    trace: list[str] | None = None
    sourceEtag: str | None = None
    period: dict[str, JsonValue] | None = None
    lateStart: str | None = None
    lateEnd: str | None = None
    freeSlackMinutes: float | None = None
    critical: bool | None = None


class ProjectScheduleResponse(StoredPlanningRecord):
    """Cached project schedule or its intentional empty short variant."""

    projectId: str
    tasks: list[PlanningScheduledTaskResponse]
    diagnostics: list[ScheduleDiagnosticResponse]
    criticalTaskIds: list[str]
    scheduleRevision: int | None
    generatedAt: str | None = None
    cycles: list[list[str]] | None = None
    planningRevision: int | None = None


class BaselineRecordResponse(StoredPlanningRecord):
    """Immutable schedule snapshot, including the pre-allocation legacy form."""

    id: str
    type: Literal["baseline"]
    projectId: str
    name: str
    createdAt: str
    scheduleRevision: int
    schedule: ProjectScheduleResponse
    allocation: AllocationResponse | None = None


class BaselineCreateResponse(BaseModel):
    """Envelope returned after capturing a baseline."""

    baseline: BaselineRecordResponse


class BaselineListResponse(BaseModel):
    """Project baseline history."""

    baselines: list[BaselineRecordResponse]


class BaselineVarianceTaskResponse(BaseModel):
    """Current-versus-baseline differences for one task."""

    taskId: str
    baselineStart: str | None
    currentStart: str | None
    baselineEnd: str | None
    currentEnd: str | None
    durationDaysVariance: float
    workHoursVariance: float
    costVariance: float


class BaselineVarianceResponse(BaseModel):
    """Schedule and cost variance against one immutable baseline."""

    baselineId: str
    baselineScheduleRevision: int | None
    currentScheduleRevision: int | None
    totalCostVariance: float
    tasks: list[BaselineVarianceTaskResponse]


class WorklogResponse(StoredPlanningRecord):
    """Append-only actual-work record."""

    id: str
    type: Literal["worklog"]
    taskId: str
    resourceId: str | None
    date: str
    hours: float
    correctionOf: str | None
    createdAt: str


class WorklogCreateResponse(BaseModel):
    """Envelope returned after appending a worklog."""

    worklog: WorklogResponse


class WorklogListResponse(BaseModel):
    """Worklog history plus derived actual-hours totals."""

    worklogs: list[WorklogResponse]
    actualHoursByTask: dict[str, float]


class WorklogListJsonResponse(TypedDict):
    """Runtime mapping retained for internal tools that trim worklog history."""

    worklogs: list[dict[str, object]]
    actualHoursByTask: dict[str, float]


class LevelingChangeResponse(StoredPlanningRecord):
    """One review-only assignment shift proposed for an overload."""

    id: str
    assignment_id: str
    task_id: str
    resource_id: str
    reason: str
    source_date: str
    delay_working_days: int
    source_start: str
    source_end: str
    suggested_start: str
    suggested_end: str
    requires_review: bool


class LevelingProposalResponse(StoredPlanningRecord):
    """Non-persisted resource-leveling preview."""

    revision: int
    warnings: list[AllocationWarningResponse]
    proposals: list[LevelingChangeResponse]
    automatic_apply_supported: bool


class StoredLevelingProposalResponse(LevelingProposalResponse):
    """Persisted proposal with optimistic-concurrency metadata."""

    id: str
    projectId: str
    scheduleRevision: int
    createdAt: str
    type: Literal["leveling_proposal"]
    status: Literal["pending"]
    sourceEtags: dict[str, str]


class AppliedAssignmentChangeResponse(BaseModel):
    """Assignment boundaries changed by an accepted proposal."""

    assignmentId: str
    start: str
    end: str


class LevelingDecisionRecordResponse(StoredPlanningRecord):
    """Append-only acceptance record for a leveling proposal."""

    id: str
    type: Literal["leveling_decision"]
    proposalId: str
    scheduleRevision: int
    etags: dict[str, str]
    acceptedAt: str
    appliedChanges: list[AppliedAssignmentChangeResponse]


class LevelingApplyResponse(BaseModel):
    """Result of applying a current, ETag-validated proposal."""

    decision: LevelingDecisionRecordResponse
    automaticWrites: list[dict[str, JsonValue]]
    updatedAssignments: list[AppliedAssignmentChangeResponse]


class RecurrenceMutationResponse(BaseModel):
    """Stored recurrence and planning-store revision."""

    recurrence: RecurrenceResponse
    revision: int


class MaterializedTaskResponse(BaseModel):
    """Stable task created for one recurrence occurrence."""

    id: str
    occurrence: str
    title: str


class RecurrenceMaterializationResponse(BaseModel):
    """Updated recurrence ledger plus newly created task pages."""

    recurrence: RecurrenceResponse
    created: list[MaterializedTaskResponse]


class CalendarMutationResponse(BaseModel):
    """Calendar mutation result and planning-store revision."""

    calendar: CalendarResponse
    revision: int


class ResourceMutationResponse(BaseModel):
    """Resource mutation result and planning-store revision."""

    resource: ResourceResponse
    revision: int


class AssignmentMutationResponse(BaseModel):
    """Assignment mutation result and planning-store revision."""

    assignment: AssignmentResponse
    revision: int


class PlanningDeletionResponse(BaseModel):
    """Stable identifier deleted from the planning store."""

    deleted: str
    revision: int
