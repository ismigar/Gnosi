"""Typed HTTP response contracts for literature workflows."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict


class LiteratureExtensibleResponse(BaseModel):
    """Preserve provider-specific fields while documenting the stable API core."""

    model_config = ConfigDict(extra="allow")


class LiteratureAiAgentResponse(LiteratureExtensibleResponse):
    id: str
    name: str
    provider: str
    model: str


class LiteratureSyncResponse(LiteratureExtensibleResponse):
    source_id: str | None = None
    state: str
    job_id: str | None = None
    index_size: int | None = None
    received_count: int | None = None
    indexed_count: int | None = None
    deleted_count: int | None = None
    cancel_requested: bool | None = None
    error: str | None = None


class LiteratureSourceResponse(LiteratureExtensibleResponse):
    id: str
    name: str
    kind: str
    group: str | None = None
    automated: bool | None = None
    implemented: bool | None = None
    available: bool | None = None
    enabled: bool | None = None
    hidden: bool | None = None
    requires_contact: bool | None = None
    credential_status: str | None = None
    search_url: str | None = None
    sync: LiteratureSyncResponse | None = None


class LiteratureConfigurationResponse(LiteratureExtensibleResponse):
    contact_email: str
    ai_agent_id: str
    ai_agents: list[LiteratureAiAgentResponse]
    source_defaults: dict[str, bool]
    hidden_sources: list[str]
    sources: list[LiteratureSourceResponse]


class LiteratureRepositoryResponse(LiteratureExtensibleResponse):
    id: str
    name: str
    kind: str
    base_url: str


class LiteratureRepositoryTestResponse(LiteratureExtensibleResponse):
    ok: bool
    latency_ms: int
    count: int
    sample: list[dict[str, Any]]


class LiteratureRepositoryDeletionResponse(LiteratureExtensibleResponse):
    deleted: bool
    repository_id: str
    index_records_deleted: int


class LiteratureSearchResponse(LiteratureExtensibleResponse):
    id: str
    state: str
    query: str | None = None
    filters: dict[str, Any] | None = None
    source_ids: list[str] | None = None
    source_queries: dict[str, str] | None = None
    source_snapshots: list[dict[str, Any]] | None = None
    source_status: dict[str, dict[str, Any]] | None = None
    exact_queries: dict[str, Any] | None = None
    ai_audits: list[dict[str, Any]] | None = None
    counts: dict[str, Any] | None = None
    results: list[dict[str, Any]] | None = None
    errors: list[dict[str, Any]] | None = None
    result_count: int | None = None
    offset: int | None = None
    limit: int | None = None
    limit_per_source: int | None = None


class LiteratureSearchesResponse(LiteratureExtensibleResponse):
    searches: list[LiteratureSearchResponse]


class LiteratureImportMembershipResponse(LiteratureExtensibleResponse):
    work_id: str | None
    resource_id: str | None
    title: str | None
    created: bool


class LiteratureImportResponse(LiteratureExtensibleResponse):
    imported: list[LiteratureImportMembershipResponse]
    existing: list[LiteratureImportMembershipResponse]
    resource_ids: list[str]
    notebook: dict[str, Any] | None
    imported_count: int
    existing_count: int


class LiteratureReviewResponse(LiteratureExtensibleResponse):
    id: str | None
    title: str | None
    question: str
    protocol: str
    criteria: dict[str, Any]
    reviewer_mode: str
    reviewers: list[str]
    status: str
    configuration: dict[str, Any]
    created_at: str | None
    updated_at: str | None


class LiteratureReviewsResponse(LiteratureExtensibleResponse):
    reviews: list[LiteratureReviewResponse]


class LiteratureActivityResponse(LiteratureExtensibleResponse):
    id: str | None
    review_id: str | None = None
    activity_type: str | None = None
    version: int | None = None
    exact_queries: dict[str, Any] | None = None
    errors: list[dict[str, Any]] | None = None
    occurred_at: str | None = None


class LiteratureCandidateResponse(LiteratureExtensibleResponse):
    id: str | None
    title: str | None
    review_id: str | None
    work: dict[str, Any]
    phase: str
    full_text: str
    full_text_evidence: dict[str, Any]
    resource_id: str | None
    activity_id: str | None
    conflict: bool
    blind_pending: bool | None = None


class LiteratureReviewDetailResponse(LiteratureExtensibleResponse):
    review: LiteratureReviewResponse
    activities: list[LiteratureActivityResponse]
    candidates: list[LiteratureCandidateResponse]
    prisma: dict[str, Any]


class LiteratureCandidateMutationResponse(LiteratureExtensibleResponse):
    added: list[LiteratureCandidateResponse]
    existing: list[LiteratureCandidateResponse]
    added_count: int
    existing_count: int


class LiteratureDecisionMutationResponse(LiteratureExtensibleResponse):
    decision: dict[str, Any]
    phase: str
    conflict: bool
    blind_released: bool | None = None


class LiteratureSnowballResponse(LiteratureExtensibleResponse):
    provider: str
    works: list[dict[str, Any]]
    exact_queries: dict[str, Any]
    counts: dict[str, Any]
    activity_id: str | None


class LiteratureManualCaptureResponse(LiteratureExtensibleResponse):
    lookup: dict[str, Any]
    work: dict[str, Any]


class LiteratureAiResponse(LiteratureExtensibleResponse):
    operation: str
    result: Any
    audit: dict[str, Any]


__all__ = [
    "LiteratureActivityResponse",
    "LiteratureAiResponse",
    "LiteratureCandidateMutationResponse",
    "LiteratureCandidateResponse",
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
    "LiteratureSearchResponse",
    "LiteratureSearchesResponse",
    "LiteratureSnowballResponse",
    "LiteratureSyncResponse",
]
