"""Typed HTTP response contracts for literature workflows."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, JsonValue, RootModel


JsonObject = dict[str, JsonValue]
LegacyJsonObject = dict[str, Any]


class ConfigurationPatch(BaseModel):
    contact_email: str | None = Field(default=None, max_length=320)
    ai_agent_id: str | None = Field(default=None, max_length=160)
    source_defaults: dict[str, bool] | None = None
    hidden_sources: list[str] | None = None


class RepositoryPayload(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    kind: Literal["oai", "rest"]
    base_url: str = Field(min_length=8, max_length=4_000)
    default_enabled: bool = True
    metadata_prefix: str = Field(default="oai_dc", max_length=100)
    set: str = Field(default="", max_length=500)
    sync_mode: Literal["full", "incremental"] = "incremental"
    tombstones: bool = True
    query_parameter: str = Field(default="q", max_length=100)
    limit_parameter: str = Field(default="limit", max_length=100)
    results_path: str = Field(default="results", max_length=300)
    pagination: Literal["none", "page", "offset", "cursor", "link"] = "none"
    page_parameter: str = Field(default="page", max_length=100)
    offset_parameter: str = Field(default="offset", max_length=100)
    cursor_parameter: str = Field(default="cursor", max_length=100)
    next_cursor_path: str = Field(default="next_cursor", max_length=300)
    static_filters: dict[str, str] = Field(default_factory=dict)
    mapping: dict[str, str] = Field(default_factory=dict)


class RepositoryTestPayload(RepositoryPayload):
    query: str = Field(default="test", max_length=500)


class SearchRequest(BaseModel):
    query: str = Field(min_length=1, max_length=2_000)
    filters: LegacyJsonObject = Field(default_factory=dict)
    source_ids: list[str] = Field(default_factory=list, max_length=100)
    source_queries: dict[str, str] = Field(default_factory=dict)
    ai_audits: list[LegacyJsonObject] = Field(default_factory=list, max_length=50)
    limit_per_source: int = Field(default=25, ge=1, le=100)


class ImportRequest(BaseModel):
    works: list[LegacyJsonObject] = Field(min_length=1, max_length=500)
    notebook_id: str = Field(default="", max_length=64)
    notebook_title: str = Field(default="", max_length=160)


class ReviewCreateRequest(BaseModel):
    title: str = Field(default="", max_length=300)
    question: str = Field(min_length=1, max_length=2_000)
    protocol: str = Field(default="", max_length=50_000)
    criteria: LegacyJsonObject = Field(default_factory=dict)
    reviewer_mode: Literal["single", "dual_blind"] = "single"
    reviewers: list[str] = Field(default_factory=list, max_length=20)
    configuration: LegacyJsonObject = Field(default_factory=dict)


class ActivityRequest(BaseModel):
    activity_type: str = Field(min_length=1, max_length=100)
    strategy: LegacyJsonObject = Field(default_factory=dict)
    exact_queries: LegacyJsonObject = Field(default_factory=dict)
    source_snapshot: list[LegacyJsonObject] = Field(default_factory=list)
    errors: list[LegacyJsonObject] = Field(default_factory=list)
    counts: LegacyJsonObject = Field(default_factory=dict)
    ai_audit: LegacyJsonObject = Field(default_factory=dict)
    export_format: str = Field(default="", max_length=100)
    notes: str = Field(default="", max_length=50_000)


class ReviewScheduleRequest(BaseModel):
    enabled: bool = False
    interval_days: int = Field(default=7, ge=1, le=365)
    strategy: LegacyJsonObject = Field(default_factory=dict)


class CandidateRequest(BaseModel):
    works: list[LegacyJsonObject] = Field(min_length=1, max_length=1_000)
    activity_id: str = Field(default="", max_length=64)


class DecisionRequest(BaseModel):
    phase: str | None = Field(default=None, max_length=80)
    decision: Literal["include", "exclude", "uncertain"]
    reason: str = Field(default="", max_length=4_000)
    notes: str = Field(default="", max_length=20_000)


class ConflictRequest(BaseModel):
    decision: Literal["include", "exclude"]
    reason: str = Field(default="Conflict resolution", max_length=4_000)
    notes: str = Field(default="", max_length=20_000)


class FullTextRequest(BaseModel):
    status: Literal[
        "not_requested", "requested", "available_oa", "attached", "unavailable", "assessed"
    ]
    location_url: str = Field(default="", max_length=4_000)
    license: str = Field(default="", max_length=500)
    resource_id: str = Field(default="", max_length=160)
    notes: str = Field(default="", max_length=20_000)


class SnowballRequest(BaseModel):
    seeds: list[LegacyJsonObject] = Field(min_length=1, max_length=20)
    direction: Literal["backward", "forward", "both"] = "both"
    limit_per_seed: int = Field(default=25, ge=1, le=100)


class ManualCaptureRequest(BaseModel):
    value: str = Field(min_length=1, max_length=4_000)
    kind: Literal["auto", "doi", "pmid", "arxiv", "isbn", "url"] = "auto"


class AiOperationRequest(BaseModel):
    operation: Literal[
        "query_strategy", "translate_query", "rerank", "screen", "synthesize", "snowball"
    ]
    payload: LegacyJsonObject = Field(default_factory=dict)
    review_id: str = Field(default="", max_length=64)
    search_id: str = Field(default="", max_length=64)
    agent_id: str = Field(default="", max_length=160)


# FastAPI includes a model's module in component keys when names collide. Keep
# the established request-component identity while these classes gain one owner.
for _request_model in (
    ConfigurationPatch,
    RepositoryPayload,
    RepositoryTestPayload,
    SearchRequest,
    ImportRequest,
    ReviewCreateRequest,
    ActivityRequest,
    ReviewScheduleRequest,
    CandidateRequest,
    DecisionRequest,
    ConflictRequest,
    FullTextRequest,
    SnowballRequest,
    ManualCaptureRequest,
    AiOperationRequest,
):
    _request_model.__module__ = "backend.api.literature_routes"
    _request_model.model_rebuild(force=True)
del _request_model


class LiteratureExtensibleResponse(BaseModel):
    """Preserve provider-specific fields while documenting the stable API core."""

    model_config = ConfigDict(extra="allow")


class LiteratureRecordResponse(LiteratureExtensibleResponse):
    """A legacy JSON object whose extension keys remain part of the wire payload."""


class LiteratureAiAgentResponse(LiteratureExtensibleResponse):
    id: str
    name: str
    provider: str
    model: str


class LiteratureSyncResponse(LiteratureExtensibleResponse):
    source_id: str | None = None
    state: str
    job_id: str | None = None
    resumption_token: str | None = None
    last_successful_datestamp: str | None = None
    index_size: int | None = None
    received_count: int | None = None
    indexed_count: int | None = None
    deleted_count: int | None = None
    cancel_requested: bool | None = None
    error: str | None = None
    started_at: str | None = None
    updated_at: str | None = None
    completed_at: str | None = None


class LiteratureSourceResponse(LiteratureExtensibleResponse):
    id: str
    name: str
    kind: str
    group: str | None = None
    automated: bool | None = None
    implemented: bool | None = None
    available: bool | None = None
    enabled: bool | None = None
    default_enabled: bool | None = None
    hidden: bool | None = None
    requires_contact: bool | None = None
    credential_status: str | None = None
    search_url: str | None = None
    docs_url: str | None = None
    base_url: str | None = None
    sync: LiteratureSyncResponse | None = None


class LiteratureConfigurationResponse(LiteratureExtensibleResponse):
    contact_email: str
    ai_agent_id: str
    ai_agents: list[LiteratureAiAgentResponse]
    source_defaults: dict[str, bool]
    hidden_sources: list[str]
    sources: list[LiteratureSourceResponse]


class LiteratureCatalogResponse(LiteratureExtensibleResponse):
    sources: list[LiteratureSourceResponse]


class LiteratureRepositoryResponse(LiteratureExtensibleResponse):
    id: str
    name: str
    kind: str
    base_url: str
    default_enabled: bool | None = None
    created_at: str | None = None
    updated_at: str | None = None
    metadata_prefix: str | None = None
    set: str | None = None
    sync_mode: str | None = None
    tombstones: bool | None = None
    query_parameter: str | None = None
    limit_parameter: str | None = None
    results_path: str | None = None
    pagination: str | None = None
    page_parameter: str | None = None
    offset_parameter: str | None = None
    cursor_parameter: str | None = None
    next_cursor_path: str | None = None
    static_filters: dict[str, str] | None = None
    mapping: dict[str, str] | None = None


class LiteratureAuthorResponse(LiteratureExtensibleResponse):
    given: str | None = None
    family: str | None = None
    literal: str | None = None
    orcid: str | None = None


class LiteratureDatesResponse(LiteratureExtensibleResponse):
    issued: str | None = None
    online: str | None = None
    print: str | None = None


class LiteraturePublicationResponse(LiteratureExtensibleResponse):
    container_title: str | None = None
    publisher: str | None = None
    volume: str | None = None
    issue: str | None = None
    pages: str | None = None


class LiteratureIdentifiersResponse(LiteratureExtensibleResponse):
    doi: str | None = None
    pmid: str | None = None
    pmcid: str | None = None
    arxiv: str | None = None
    isbn13: list[str] | None = None
    provider: JsonObject | None = None


class LiteratureLocationResponse(LiteratureExtensibleResponse):
    url: str | None = None
    landing_page_url: str | None = None
    pdf_url: str | None = None
    is_oa: bool | None = None
    license: str | None = None


class LiteratureOpenAccessResponse(LiteratureExtensibleResponse):
    is_oa: bool | None = None
    license: str | None = None
    best_location: LiteratureLocationResponse | None = None


class LiteratureSourceOccurrenceResponse(LiteratureExtensibleResponse):
    provider: str | None = None
    provider_id: str | None = None
    url: str | None = None
    score: float | int | None = None
    citations: int | None = None
    retrieved_at: str | None = None


class LiteratureMetricsResponse(LiteratureExtensibleResponse):
    citations: dict[str, int | float | None] | None = None


class LiteratureWorkResponse(LiteratureExtensibleResponse):
    id: str | None = None
    title: str | None = None
    normalized_title: str | None = None
    authors: list[LiteratureAuthorResponse | str] | None = None
    dates: LiteratureDatesResponse | None = None
    year: int | None = None
    abstract: str | None = None
    abstract_available: bool | None = None
    type: str | None = None
    peer_reviewed: bool | None = None
    publication: LiteraturePublicationResponse | None = None
    language: str | None = None
    identifiers: LiteratureIdentifiersResponse | None = None
    open_access: LiteratureOpenAccessResponse | None = None
    locations: list[LiteratureLocationResponse] | None = None
    sources: list[LiteratureSourceOccurrenceResponse] | None = None
    metrics: LiteratureMetricsResponse | None = None
    provenance: dict[str, list[str]] | None = None
    conflicts: JsonObject | None = None
    duplicate_key: str | None = None
    possible_duplicates: list[str] | None = None
    in_resources: bool | None = None
    resource_id: str | None = None


class LiteratureRepositoryTestResponse(LiteratureExtensibleResponse):
    ok: bool
    latency_ms: int
    count: int
    sample: list[LiteratureWorkResponse]


class LiteratureRepositoryDeletionResponse(LiteratureExtensibleResponse):
    deleted: bool
    repository_id: str
    index_records_deleted: int


class LiteratureSourceStatusResponse(LiteratureExtensibleResponse):
    state: str
    count: int | None = None
    error: str | None = None
    retry_after: int | float | None = None
    started_at: str | None = None
    completed_at: str | None = None


class LiteratureExactQueryResponse(LiteratureExtensibleResponse):
    source_id: str | None = None
    source_name: str | None = None
    original_query: str | None = None
    effective_query: str | None = None
    filters: JsonObject | None = None
    connector_version: int | None = None
    provider_syntax: JsonValue = None
    requests: list[JsonObject] | None = None


class LiteratureAiAuditResponse(LiteratureExtensibleResponse):
    operation: str | None = None
    agent_id: str | None = None
    model: str | None = None
    provider: str | None = None
    usage: JsonObject | None = None
    cost: float | int | None = None
    performed_at: str | None = None
    evidence_levels: list[str] | None = None
    resource_ids: list[str] | None = None
    operation_version: int | None = None
    human_decision_required: bool | None = None


class LiteratureCountsResponse(LiteratureExtensibleResponse):
    raw_occurrences: int | None = None
    unique_works: int | None = None
    duplicates_removed: int | None = None
    possible_duplicate_pairs: int | None = None
    returned_works: int | None = None
    truncated_works: int | None = None


class LiteratureErrorResponse(LiteratureExtensibleResponse):
    source_id: str | None = None
    message: str | None = None
    retry_after: int | float | None = None


class LiteratureSearchResponse(LiteratureExtensibleResponse):
    id: str
    state: str
    query: str | None = None
    filters: JsonObject | None = None
    source_ids: list[str] | None = None
    source_queries: dict[str, str] | None = None
    source_snapshots: list[LiteratureSourceResponse] | None = None
    source_status: dict[str, LiteratureSourceStatusResponse] | None = None
    exact_queries: dict[str, LiteratureExactQueryResponse] | None = None
    ai_audits: list[LiteratureAiAuditResponse] | None = None
    counts: LiteratureCountsResponse | None = None
    results: list[LiteratureWorkResponse] | None = None
    errors: list[LiteratureErrorResponse] | None = None
    result_count: int | None = None
    offset: int | None = None
    limit: int | None = None
    limit_per_source: int | None = None
    owner_user_id: str | None = None
    cancel_requested: bool | None = None
    contact_email_configured: bool | None = None
    created_at: str | None = None
    updated_at: str | None = None
    completed_at: str | None = None


class LiteratureSearchesResponse(LiteratureExtensibleResponse):
    searches: list[LiteratureSearchResponse]


class LiteratureImportMembershipResponse(LiteratureExtensibleResponse):
    work_id: str | None
    resource_id: str | None
    title: str | None
    created: bool


class LiteratureNotebookResponse(LiteratureRecordResponse):
    id: str | None = None
    title: str | None = None


class LiteratureImportResponse(LiteratureExtensibleResponse):
    imported: list[LiteratureImportMembershipResponse]
    existing: list[LiteratureImportMembershipResponse]
    resource_ids: list[str]
    notebook: LiteratureNotebookResponse | None
    imported_count: int
    existing_count: int


class LiteratureReviewResponse(LiteratureExtensibleResponse):
    id: str | None
    title: str | None
    question: str
    protocol: str
    criteria: JsonObject
    reviewer_mode: str
    reviewers: list[str]
    status: str
    configuration: JsonObject
    created_at: str | None
    updated_at: str | None


class LiteratureReviewsResponse(LiteratureExtensibleResponse):
    reviews: list[LiteratureReviewResponse]


class LiteratureActivityResponse(LiteratureExtensibleResponse):
    id: str | None
    title: str | None = None
    review_id: str | None = None
    activity_type: str | None = None
    version: int | None = None
    strategy: JsonObject | None = None
    exact_queries: JsonObject | None = None
    source_snapshot: list[JsonObject] | None = None
    errors: list[LiteratureErrorResponse] | None = None
    counts: JsonObject | None = None
    ai_audit: JsonObject | None = None
    export_format: str | None = None
    occurred_at: str | None = None
    notes: str | None = None


class LiteratureDecisionResponse(LiteratureExtensibleResponse):
    id: str | None = None
    review_id: str | None = None
    candidate_id: str | None = None
    reviewer_id: str | None = None
    phase: str | None = None
    decision: str | None = None
    reason: str | None = None
    notes: str | None = None
    decided_at: str | None = None
    replaces_decision_id: str | None = None
    resolution: bool | None = None


class LiteratureFullTextEvidenceResponse(LiteratureExtensibleResponse):
    status: str | None = None
    location_url: str | None = None
    license: str | None = None
    resource_id: str | None = None
    notes: str | None = None
    recorded_at: str | None = None
    recorded_by: str | None = None
    provider_asserted_oa: bool | None = None


class LiteratureCandidateResponse(LiteratureExtensibleResponse):
    id: str | None
    title: str | None
    review_id: str | None
    work_key: str | None = None
    work: LiteratureWorkResponse
    sources: list[LiteratureSourceOccurrenceResponse] | None = None
    identifiers: LiteratureIdentifiersResponse | None = None
    phase: str
    full_text: str
    full_text_evidence: LiteratureFullTextEvidenceResponse
    resource_id: str | None
    activity_id: str | None
    conflict: bool
    decisions: list[LiteratureDecisionResponse] | None = None
    blind_pending: bool | None = None


class LiteraturePrismaResponse(LiteratureExtensibleResponse):
    identified: int | None = None
    duplicates_removed: int | None = None
    screened: int | None = None
    screening_excluded: int | None = None
    reports_sought: int | None = None
    reports_not_retrieved: int | None = None
    full_text_excluded: int | None = None
    included: int | None = None
    exclusion_reasons: dict[str, int] | None = None


class LiteratureReviewDetailResponse(LiteratureExtensibleResponse):
    review: LiteratureReviewResponse
    activities: list[LiteratureActivityResponse]
    candidates: list[LiteratureCandidateResponse]
    prisma: LiteraturePrismaResponse


class LiteratureReviewTablesResponse(RootModel[dict[str, str]]):
    pass


class LiteratureCandidatesResponse(LiteratureExtensibleResponse):
    candidates: list[LiteratureCandidateResponse]


class LiteratureCandidateMutationResponse(LiteratureExtensibleResponse):
    added: list[LiteratureCandidateResponse]
    existing: list[LiteratureCandidateResponse]
    added_count: int
    existing_count: int


class LiteratureDecisionMutationResponse(LiteratureExtensibleResponse):
    decision: LiteratureDecisionResponse
    phase: str
    conflict: bool
    blind_released: bool | None = None


class LiteratureSnowballResponse(LiteratureExtensibleResponse):
    provider: str
    works: list[LiteratureWorkResponse]
    exact_queries: dict[str, LiteratureExactQueryResponse]
    counts: LiteratureCountsResponse
    activity_id: str | None


class LiteratureLookupResponse(LiteratureExtensibleResponse):
    source: str | None = None
    identifier: str | None = None
    error: str | None = None


class LiteratureManualCaptureResponse(LiteratureExtensibleResponse):
    lookup: LiteratureLookupResponse
    work: LiteratureWorkResponse


class LiteratureAiResponse(LiteratureExtensibleResponse):
    operation: str
    result: JsonValue
    audit: LiteratureAiAuditResponse


__all__ = [
    "ActivityRequest",
    "AiOperationRequest",
    "CandidateRequest",
    "ConfigurationPatch",
    "ConflictRequest",
    "DecisionRequest",
    "FullTextRequest",
    "ImportRequest",
    "JsonObject",
    "LiteratureActivityResponse",
    "LiteratureAiResponse",
    "LiteratureCandidateMutationResponse",
    "LiteratureCandidateResponse",
    "LiteratureCandidatesResponse",
    "LiteratureCatalogResponse",
    "LiteratureConfigurationResponse",
    "LiteratureDecisionMutationResponse",
    "LiteratureImportResponse",
    "LiteratureManualCaptureResponse",
    "LiteratureRepositoryDeletionResponse",
    "LiteratureRepositoryResponse",
    "LiteratureRepositoryTestResponse",
    "LiteratureReviewDetailResponse",
    "LiteratureReviewResponse",
    "LiteratureReviewsResponse",
    "LiteratureReviewTablesResponse",
    "LiteratureSearchResponse",
    "LiteratureSearchesResponse",
    "LiteratureSnowballResponse",
    "LiteratureSyncResponse",
    "LiteratureWorkResponse",
    "ManualCaptureRequest",
    "RepositoryPayload",
    "RepositoryTestPayload",
    "ReviewCreateRequest",
    "ReviewScheduleRequest",
    "SearchRequest",
    "SnowballRequest",
]
