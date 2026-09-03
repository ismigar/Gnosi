"""Typed JSON responses for agent governance and quality endpoints."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field, JsonValue


class ForwardCompatibleGovernanceResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    __pydantic_extra__: dict[str, JsonValue] = Field(init=False)


class CapabilityJobFeaturesResponse(BaseModel):
    status: bool
    result: bool
    resume: bool
    cancel: bool
    estimate: bool
    automatic_retry: bool


class CapabilityJobContractResponse(BaseModel):
    schema_version: int
    job_kinds: list[str]
    idempotency: str
    lease_seconds: int
    max_attempts: int
    model_call_budget: int


class CapabilityJobResponse(ForwardCompatibleGovernanceResponse):
    job_id: str
    status: str | None = None
    state: str | None = None
    provider: str | None = None
    capabilities: CapabilityJobFeaturesResponse | None = None
    contract: CapabilityJobContractResponse | None = None


class CapabilityJobsResponse(BaseModel):
    jobs: list[CapabilityJobResponse]


class CapabilityJobResultResponse(ForwardCompatibleGovernanceResponse):
    job_id: str
    provider: str | None = None
    status: str | None = None
    state: str | None = None


class CapabilityAuditEventResponse(ForwardCompatibleGovernanceResponse):
    id: str
    agent_id: str
    session_id: str
    tool_id: str
    tool_name: str
    effects: list[str]
    status: str
    argument_keys: list[str]
    result_kind: str
    error_code: str
    duration_ms: int
    created_at: float


class CapabilityAuditResponse(BaseModel):
    events: list[CapabilityAuditEventResponse]


class EvaluationCandidateResponse(ForwardCompatibleGovernanceResponse):
    id: str
    review_status: str
    occurrence_count: int = 0
    first_seen: float | None = None
    last_seen: float | None = None
    scenario: dict[str, JsonValue] | None = None
    synthetic_case: dict[str, JsonValue]


class EvaluationCandidatesResponse(BaseModel):
    candidates: list[EvaluationCandidateResponse]


class QualityToolUsageResponse(BaseModel):
    tool_name: str
    uses: int


class AgentQualityResponse(ForwardCompatibleGovernanceResponse):
    schema_version: int
    event_count: int
    completed_turns: int
    errors: int
    signals: dict[str, int]
    ratings: dict[str, int]
    modes: dict[str, int]
    verification: dict[str, int]
    latency_buckets: dict[str, int]
    error_codes: dict[str, int]
    top_tools: list[QualityToolUsageResponse]
    evaluation_candidates: dict[str, int]


class CapabilityHealthResponse(ForwardCompatibleGovernanceResponse):
    capability_id: str
    status: str
    reason: str | None = None
    total_calls: int | None = None
    successful_calls: int | None = None
    recent_failures: int | None = None
    average_latency_ms: int | None = None
    quarantined_until: float | None = None


class AgentQualityDashboardResponse(BaseModel):
    quality: AgentQualityResponse
    capabilities: list[CapabilityHealthResponse]


class CapabilityConformanceRowResponse(ForwardCompatibleGovernanceResponse):
    id: str
    kind: str
    declared_schema_version: int
    status: str
    checks: dict[str, bool]
    missing_fields: list[str]


class DurableJobDispatcherResponse(BaseModel):
    schema_version: int
    job_type: str
    provider: str
    idempotency: str
    lease_seconds: int
    max_attempts: int
    model_call_budget: int
    supports_resume: bool
    supports_cancel: bool


class CapabilityConformanceResponse(ForwardCompatibleGovernanceResponse):
    schema_version: int
    counts: dict[str, int]
    total: int
    capabilities: list[CapabilityConformanceRowResponse]
    enforcement: str
    durable_job_dispatchers: list[DurableJobDispatcherResponse]


class SemanticAssociationResponse(ForwardCompatibleGovernanceResponse):
    id: str
    trigger_term: str
    related_term: str
    created_at: float
    updated_at: float


class SemanticAssociationsResponse(BaseModel):
    associations: list[SemanticAssociationResponse]


class SemanticAssociationDeleteResponse(BaseModel):
    status: str
    association_id: str


class PersonalMemoryResponse(ForwardCompatibleGovernanceResponse):
    memory_id: str
    text: str
    category: str
    provenance: str
    enabled: bool
    expires_at: str | None
    revision: int
    created_at: str
    updated_at: str


class PersonalMemoriesResponse(BaseModel):
    memories: list[PersonalMemoryResponse]


class PersonalMemoryDeleteResponse(BaseModel):
    status: str
    memory_id: str


class ModelEvaluationResponse(ForwardCompatibleGovernanceResponse):
    evaluation_id: int
    provider: str
    model: str
    agent_id: str
    score: float
    passed: int
    total: int
    latency_ms: int
    input_tokens: int
    output_tokens: int
    estimated_cost_usd: float
    failure_codes: list[str]
    created_at: str
    privacy: str | None = None


class ModelEvaluationsResponse(BaseModel):
    evaluations: list[ModelEvaluationResponse]


class ReviewedEvaluationResultResponse(ForwardCompatibleGovernanceResponse):
    id: str
    passed: bool
    failures: list[dict[str, JsonValue]]
    plan: dict[str, JsonValue]


class ReviewedEvaluationReportResponse(ForwardCompatibleGovernanceResponse):
    schema_version: int
    suite: str
    passed: int
    total: int
    score: float
    results: list[ReviewedEvaluationResultResponse]


class AutomationApprovalResponse(ForwardCompatibleGovernanceResponse):
    type: str
    confirmation_id: str
    action: str
    title_key: str
    summary_key: str
    details: dict[str, JsonValue]
    destructive: bool
    created_at: float
    expires_at: float
    status: str
    result: dict[str, JsonValue]
    error_code: str
    agent_id: str
    session_id: str


class AutomationApprovalsResponse(BaseModel):
    approvals: list[AutomationApprovalResponse]
