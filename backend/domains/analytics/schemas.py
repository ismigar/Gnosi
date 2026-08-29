"""Public request and response contracts for workspace analytics."""

from __future__ import annotations

from pydantic import BaseModel, Field


class ToolAnalyticsResponse(BaseModel):
    """Generated-tool registry counters exposed by the dashboard."""

    total_tools: int
    pending: int
    approved: int
    rejected: int
    by_risk_level: dict[str, int] = Field(default_factory=dict)
    created_last_7_days: int
    internal_skills: int


class DirectiveSummaryResponse(BaseModel):
    """Aggregate development-memory counters."""

    total: int
    traps_documented: int


class AnalyticsOverviewResponse(BaseModel):
    """Dashboard analytics overview."""

    tools: ToolAnalyticsResponse
    directives: DirectiveSummaryResponse
    errors_prevented: int


class DirectiveAnalyticsResponse(BaseModel):
    """One directive or consolidated skill visible to an administrator."""

    name: str
    category: str
    size_bytes: int
    trap_count: int
    path: str


class DirectiveAnalyticsPageResponse(BaseModel):
    """Paginated directive inventory."""

    directives: list[DirectiveAnalyticsResponse]
    total: int
    limit: int
    offset: int
    has_more: bool


class TrapAnalyticsResponse(BaseModel):
    """One documented development trap."""

    date: str
    trap: str
    solution: str
    source: str
    category: str


class TrapAnalyticsPageResponse(BaseModel):
    """Paginated development-trap inventory."""

    traps: list[TrapAnalyticsResponse]
    total: int
    limit: int
    offset: int
    has_more: bool


class DirectiveContentResponse(BaseModel):
    """Editable directive text and its canonical path."""

    path: str
    content: str


class DirectiveContentUpdateRequest(BaseModel):
    """Replacement content for one validated directive path."""

    path: str
    content: str


class DirectiveMutationResponse(BaseModel):
    """Acknowledgement for directive save and delete operations."""

    message: str
    path: str | None = None
