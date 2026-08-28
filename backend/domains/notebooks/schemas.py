"""Public request and response contracts for the Notebooks domain."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, JsonValue


class NotebookCreateRequest(BaseModel):
    """Create a grounded notebook from one or more reference resources."""

    title: str = Field(default="Untitled notebook", max_length=160)
    visibility: Literal["private", "workspace"] = "private"
    conversation_mode: Literal["shared", "private_member"] = "private_member"
    resource_ids: list[str] = Field(min_length=1, max_length=1_000)


class NotebookPatchRequest(BaseModel):
    """Mutable notebook metadata and resource groups."""

    title: str | None = Field(default=None, max_length=160)
    visibility: Literal["private", "workspace"] | None = None
    conversation_mode: Literal["shared", "private_member"] | None = None
    groups: list[dict[str, Any]] | None = None


class NotebookSourcesRequest(BaseModel):
    """Reference resources to attach to an existing notebook."""

    resource_ids: list[str] = Field(min_length=1, max_length=1_000)


class NotebookRefreshRequest(BaseModel):
    """Options for a complete or targeted notebook refresh."""

    force: bool = True
    reason: str = Field(default="manual", max_length=80)


class NotebookGroupResponse(BaseModel):
    """One named group of resources inside a notebook."""

    id: str
    name: str
    resource_ids: list[str]


class NotebookSourceCountsResponse(BaseModel):
    """Source availability totals for the active notebook revision."""

    total: int
    available: int
    stale: int
    error: int


class NotebookProgressResponse(BaseModel):
    """Observable state of the latest notebook ingestion revision."""

    revision: int
    state: str
    processed: int
    total: int
    percent: int
    job_id: str | None
    error: str | None
    current_resource_id: str | None
    current_resource_title: str | None
    cancel_requested_at: str | None
    cancellable: bool


class NotebookSummaryResponse(BaseModel):
    """Stable notebook inventory item shared by list and detail responses."""

    id: str
    vault_scope: str
    workspace_id: str
    owner_user_id: str
    source_table_id: str
    title: str
    visibility: str
    conversation_mode: str
    active_revision: int | None
    status: str
    last_error: str | None
    created_at: str
    updated_at: str
    groups_json: str = "[]"
    groups: list[NotebookGroupResponse] = Field(default_factory=list)
    resource_count: int
    source_counts: NotebookSourceCountsResponse
    progress: NotebookProgressResponse | None = None
    chat_ready: bool


class NotebookDetailResponse(NotebookSummaryResponse):
    """Notebook summary enriched with permissions and chat identifiers."""

    can_manage: bool
    can_chat: bool
    conversation_principal: str
    conversation_session_id: str


class NotebookPageResponse(BaseModel):
    """One page of notebooks visible in the active workspace."""

    items: list[NotebookSummaryResponse]
    page: int
    page_size: int
    total: int


class ReferenceResourceResponse(BaseModel):
    """One reference resource eligible for notebook ingestion."""

    id: str
    title: str
    last_modified: str | None
    source_count: int
    resource_type: str | None
    authors: list[str]
    tags: list[str]


class ReferenceFacetOptionResponse(BaseModel):
    """One value and count in a reference-resource facet."""

    value: str
    count: int


class ReferenceResourceFacetsResponse(BaseModel):
    """Available type, author and tag filters for reference resources."""

    types: list[ReferenceFacetOptionResponse] = Field(default_factory=list)
    authors: list[ReferenceFacetOptionResponse] = Field(default_factory=list)
    tags: list[ReferenceFacetOptionResponse] = Field(default_factory=list)


class ReferenceResourcePageResponse(BaseModel):
    """Paged reference-resource selector, including optional legacy facets."""

    items: list[ReferenceResourceResponse]
    page: int
    page_size: int
    total: int
    table_id: str | None = None
    source_fields: int = 0
    hidden_without_sources: int = 0
    facets: ReferenceResourceFacetsResponse = Field(default_factory=ReferenceResourceFacetsResponse)


class NotebookSourceResponse(BaseModel):
    """One extracted source in an immutable notebook revision."""

    source_id: str
    resource_id: str
    kind: str
    label: str
    source_url: str | None
    fingerprint: str
    snapshot_id: str | None
    status: str
    error: str | None


class NotebookResourceResponse(BaseModel):
    """One notebook resource and its extracted sources."""

    resource_id: str
    title: str
    state: str
    error: str | None
    updated_at: str
    last_checked_at: str | None
    url_checked_at: str | None
    sources: list[NotebookSourceResponse]


class NotebookSourcesPageResponse(BaseModel):
    """One page of resources and sources attached to a notebook."""

    items: list[NotebookResourceResponse]
    page: int
    page_size: int
    total: int
    active_revision: int | None


class NotebookChatSourceResponse(BaseModel):
    """One source that can be pinned into a future notebook chat turn."""

    source_id: str
    resource_id: str
    kind: str
    label: str
    status: str


class NotebookChatNotebookResponse(BaseModel):
    """Another authorized notebook that can provide chat context."""

    id: str
    title: str
    visibility: str
    active_revision: int
    source_count: int


class NotebookChatSourcesResponse(BaseModel):
    """Authorized source and notebook choices for future chat turns."""

    notebook_id: str
    active_revision: int | None
    sources: list[NotebookChatSourceResponse]
    notebooks: list[NotebookChatNotebookResponse]


class NotebookRefreshResponse(BaseModel):
    """Current, queued, or already-running notebook refresh state."""

    state: str
    revision: int | None
    job_id: str | None = None
    notebook_id: str | None = None
    total_resources: int | None = None
    processed_resources: int | None = None
    available_sources: int | None = None
    error_sources: int | None = None
    created_at: str | None = None
    completed_at: str | None = None
    error: str | None = None
    current_resource_id: str | None = None
    current_resource_title: str | None = None
    cancel_requested_at: str | None = None
    retention_eligible: int | None = None


class NotebookCitationResponse(BaseModel):
    """Stable navigation metadata for one notebook evidence fragment."""

    href: str
    label: str
    resource_id: str
    revision: int
    source_id: str
    chunk_id: str


class NotebookSearchResultResponse(BaseModel):
    """One ranked evidence fragment returned by notebook retrieval."""

    chunk_id: str
    source_id: str
    resource_id: str
    source_label: str
    source_kind: str
    source_status: str
    text: str
    locator: dict[str, JsonValue]
    citation: NotebookCitationResponse
    score: float


class NotebookSearchResponse(BaseModel):
    """Hybrid retrieval results, including the no-active-revision variant."""

    notebook_id: str
    revision: int | None
    query: str | None = None
    results: list[NotebookSearchResultResponse]


class NotebookEvidenceResponse(BaseModel):
    """One complete evidence fragment from a pinned notebook revision."""

    notebook_id: str
    revision: int
    chunk_id: str
    source_id: str
    resource_id: str
    source_label: str
    source_kind: str
    source_status: str
    text: str
    locator: dict[str, JsonValue]
    citation: NotebookCitationResponse


class NotebookConversationMessageResponse(BaseModel):
    """One user-visible notebook transcript message and its public metadata."""

    model_config = ConfigDict(extra="allow")

    role: Literal["user", "assistant"]
    content: str
    author_user_id: str | None = None
    turn_id: str | None = None
    plan: JsonValue = None
    privacy: JsonValue = None
    verification: JsonValue = None
    citations: JsonValue = None
    freshness: JsonValue = None
    job: JsonValue = None
    explanation: JsonValue = None
    quality: JsonValue = None
    conflicts: JsonValue = None
    evidence_security: JsonValue = None
    timings: JsonValue = None


class NotebookConversationResponse(BaseModel):
    """Canonical notebook transcript, including the empty legacy variant."""

    messages: list[NotebookConversationMessageResponse]
    session_id: str
    conversation_mode: str | None = None
