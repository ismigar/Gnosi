"""Public request and response contracts for the Reader domain."""

from __future__ import annotations

from pydantic import BaseModel, Field


class ReaderMessageResponse(BaseModel):
    """Stable message payload returned by simple Reader mutations."""

    message: str


class NewsletterConnectionTestResponse(ReaderMessageResponse):
    """Result of a POP3 connection test."""

    ok: bool
    messages: int


class NewsletterSyncResponse(ReaderMessageResponse):
    """Acknowledgement that newsletter ingestion was queued."""

    ok: bool


class ReaderScopeResponse(BaseModel):
    """Normalized scope shared by Reader inventory and analysis jobs."""

    unread_only: bool = True
    read_status: str = "unread"
    source_ids: list[int] = Field(default_factory=list)
    source_names: list[str] = Field(default_factory=list)
    categories: list[str] = Field(default_factory=list)
    date_from: str = ""
    date_to: str = ""
    include_full_content: bool = False
    limit: int = 200
    offset: int = 0


class ReaderInventoryFeedResponse(BaseModel):
    """Per-feed count in a Reader inventory."""

    id: int
    name: str
    category: str | None = None
    count: int


class ReaderInventoryCategoryResponse(BaseModel):
    """Per-category count in a Reader inventory."""

    category: str
    count: int


class ReaderInventoryResponse(BaseModel):
    """Exact aggregate counts for one normalized Reader scope."""

    source: str
    count: int
    read_count: int
    unread_count: int
    feed_count: int
    category_count: int
    oldest: str | None = None
    newest: str | None = None
    feeds: list[ReaderInventoryFeedResponse]
    categories: list[ReaderInventoryCategoryResponse]
    record_fields: list[str]
    scope: ReaderScopeResponse


class ReaderAnalysisRetryResponse(BaseModel):
    """Persisted retry budget and scheduling state for an analysis."""

    automatic_enabled: bool = True
    attempt: int = 0
    max_attempts: int = 3
    base_delay_seconds: int = 5
    max_delay_seconds: int = 300
    next_retry_at: str | None = None
    model_call_budget: int = 100
    model_calls_used: int = 0
    last_retry_reason: str | None = None
    last_resume_kind: str = "initial"
    budget_exhausted: bool = False


class ReaderAnalysisJobResponse(BaseModel):
    """Public durable state for one Reader analysis job."""

    job_id: str
    state: str
    phase: str = ""
    progress: int = 0
    total_articles: int = 0
    processed_articles: int = 0
    total_batches: int = 0
    completed_batches: int = 0
    language: str = "Catalan"
    scope: ReaderScopeResponse = Field(default_factory=ReaderScopeResponse)
    snapshot_digest: str = ""
    created_at: str = ""
    updated_at: str = ""
    completed_at: str | None = None
    error: str | None = None
    result_available: bool = False
    retry: ReaderAnalysisRetryResponse = Field(default_factory=ReaderAnalysisRetryResponse)


class ReaderAnalysisTopicResponse(BaseModel):
    """One synthesized topic in a completed Reader analysis."""

    topic: str
    evolution: str = ""
    turning_points: list[object] = Field(default_factory=list)
    article_ids: list[str] = Field(default_factory=list)
    fallback: bool = False
    article_count: int = 0
    period_start: str | None = None
    period_end: str | None = None


class ReaderAnalysisResultResponse(BaseModel):
    """Structured result plus the rendered report for a completed analysis."""

    job_id: str
    article_count: int = 0
    snapshot_digest: str = ""
    language: str = "Catalan"
    scope: ReaderScopeResponse = Field(default_factory=ReaderScopeResponse)
    request: str = ""
    topics: list[ReaderAnalysisTopicResponse] = Field(default_factory=list)
    created_at: str = ""
    completed_at: str = ""
    report_markdown: str = ""


class ReaderArticleReadResponse(ReaderMessageResponse):
    """Acknowledgement for an article read-state mutation."""


class ReaderArticleExtractResponse(ReaderMessageResponse):
    """Result of extracting one article's full body."""

    length: int


class ReaderBackfillStatusResponse(BaseModel):
    """Progress of the full-content backfill worker."""

    running: bool
    total: int
    done: int
    extracted: int
    failed: int
    current: str
    error: str | None = None


class ReaderBackfillTriggerResponse(ReaderBackfillStatusResponse):
    """Backfill launch state, including current progress when already running."""

    status: str
    running: bool = False
    total: int = 0
    done: int = 0
    extracted: int = 0
    failed: int = 0
    current: str = ""


class ReaderPodcastGenerationResponse(BaseModel):
    """Acknowledgement for background podcast generation."""

    status: str
    message: str
    progress: str = ""


class ReaderPodcastStatusResponse(BaseModel):
    """Observable podcast-generation state."""

    running: bool
    progress: str
    error: str | None = None
    result_filename: str | None = None


class ReaderPodcastInfoResponse(BaseModel):
    """Metadata for the latest generated podcast, when one exists."""

    exists: bool
    filename: str | None = None
    created_at: str | None = None
    formatted_date: str | None = None
    formatted_time: str | None = None
