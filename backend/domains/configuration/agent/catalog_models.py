"""Typed JSON responses for governed skill catalogs and automations."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, JsonValue

from backend.models.agent_skills import SkillDescriptor, ToolDescriptor, ToolEffect


class ForwardCompatibleCatalogResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    __pydantic_extra__: dict[str, JsonValue] = Field(init=False)


class AgentSkillCatalogItemResponse(SkillDescriptor):
    """Flattened effective skill descriptor returned by the catalog route."""

    model_config = ConfigDict(extra="forbid")

    available: bool
    missing_tool_ids: list[str]
    effects: list[ToolEffect]
    editable: bool
    deletable: bool
    revision: str


class AgentSkillCatalogIssueResponse(BaseModel):
    """Validation issue for one user-provided skill package."""

    model_config = ConfigDict(extra="forbid")

    package: str
    error: str


class AgentSkillCatalogResponse(BaseModel):
    """Effective skills plus package issues and the catalog revision."""

    model_config = ConfigDict(extra="forbid")

    skills: list[AgentSkillCatalogItemResponse]
    issues: list[AgentSkillCatalogIssueResponse]
    catalog_revision: str


class AgentSkillValidationSuccessResponse(BaseModel):
    valid: bool
    descriptor: SkillDescriptor
    missing_tool_ids: list[str]


class AgentSkillValidationErrorResponse(BaseModel):
    valid: Literal[False]
    errors: list[str]


AgentSkillValidationResponse = (
    AgentSkillValidationSuccessResponse | AgentSkillValidationErrorResponse
)


class AgentSkillDeleteResponse(BaseModel):
    status: str
    skill_id: str
    affected_agents: list[str]


class AgentToolCatalogItemResponse(ToolDescriptor):
    skill_ids: list[str]
    runtime_adapter_available: bool


class AgentToolCatalogResponse(BaseModel):
    tools: list[AgentToolCatalogItemResponse]
    catalog_revision: str


class AgentSkillAssignmentResponse(ForwardCompatibleCatalogResponse):
    agent_id: str
    skill_ids: list[str] | str
    required_skill_ids: list[str] | str
    revision: str


class AutomationBudgetsResponse(BaseModel):
    max_runs_per_day: int
    max_ai_calls_per_run: int
    max_runtime_seconds: int


class SkillAutomationResponse(ForwardCompatibleCatalogResponse):
    id: str
    name: str
    agent_id: str
    skill_id: str
    instruction: str
    interval_minutes: int
    enabled: bool
    budgets: AutomationBudgetsResponse
    next_run_at: float | None
    last_run_at: float | None
    last_status: str
    created_at: float
    updated_at: float
    revision: str


class SkillAutomationsResponse(BaseModel):
    automations: list[SkillAutomationResponse]


class SkillAutomationDeleteResponse(BaseModel):
    status: str
    automation_id: str


class SkillAutomationRunResponse(ForwardCompatibleCatalogResponse):
    id: str
    automation_id: str
    status: str
    ai_calls: int
    confirmation_count: int
    error_code: str | None
    started_at: float
    finished_at: float | None


class SkillAutomationRunsResponse(BaseModel):
    runs: list[SkillAutomationRunResponse]


class SkillAutomationQueuedResponse(BaseModel):
    status: str
    automation_id: str
