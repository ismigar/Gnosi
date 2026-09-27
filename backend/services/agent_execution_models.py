"""Transport-independent contracts for principal-agent operations."""
from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


ExecutionOrigin = Literal["button", "chat", "automation", "worker"]


class ExecutionScope(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    user_id: str = Field(min_length=1)
    workspace_id: str = Field(min_length=1)
    vault_path: str = Field(min_length=1)
    role: Literal["viewer", "editor", "admin", "owner"]


class AgentOperation(BaseModel):
    model_config = ConfigDict(extra="forbid")
    skill_id: str = Field(min_length=1)
    operation: str = Field(min_length=1)
    input: str = ""
    data: dict[str, Any] = Field(default_factory=dict)
    options: dict[str, Any] = Field(default_factory=dict)
    language: str = ""
    origin: ExecutionOrigin = "button"
    context_refs: list[dict[str, Any]] = Field(default_factory=list)
    output_schema: dict[str, Any] | None = None
    timeout_seconds: int = Field(default=120, ge=1, le=3600)
    max_model_calls: int = Field(default=2, ge=1, le=2)
    parent_run_id: str = ""
    resume_requires_parent: bool = False


class AgentExecutionSnapshot(BaseModel):
    model_config = ConfigDict(extra="forbid")
    scope: ExecutionScope
    agent_id: str
    profile: dict[str, Any]
    skill_ids: list[str]
    instructions: list[str]
    catalog_revision: str
    revision: str
    origin: ExecutionOrigin = "button"
    parent_run_id: str = ""
    skill_versions: dict[str, str] = Field(default_factory=dict)
    skill_instructions: dict[str, str] = Field(default_factory=dict)
    skill_companions: dict[str, list[str]] = Field(default_factory=dict)
    behavior_resources: dict[str, str] = Field(default_factory=dict)


class AgentRun(BaseModel):
    model_config = ConfigDict(extra="forbid")
    run_id: str
    parent_run_id: str = ""
    agent_id: str
    skill_id: str
    operation: str
    origin: str
    status: str
    created_at: float
    updated_at: float
    model: str = ""
    provider: str = ""
    input_tokens: int = 0
    output_tokens: int = 0
    model_calls: int = 0
    usage_available: bool = False
    resumable: bool = False
    result: str = ""
    error: str = ""
    execution_revision: str = ""
    closed_at: float | None = None
    trace_state: str = "available"
