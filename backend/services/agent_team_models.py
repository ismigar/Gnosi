"""Explicit, additive contracts for governed agent teams."""
from __future__ import annotations

from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, model_validator

TeamRole = Literal["director", "allrounder", "documentalist", "expert", "administrative", "worker"]
TEAM_SKILL = "core.gnosi-coordination"


class TeamMember(BaseModel):
    model_config = ConfigDict(extra="forbid")
    agent_id: str = Field(min_length=1, max_length=128)
    roles: list[TeamRole] = Field(default_factory=list, max_length=6)


class TeamModel(BaseModel):
    model_config = ConfigDict(extra="forbid")
    provider: str = Field(min_length=1, max_length=128)
    model: str = Field(min_length=1, max_length=256)


class DirectRoute(BaseModel):
    model_config = ConfigDict(extra="forbid")
    operation: str = Field(min_length=1, max_length=128)
    agent_ids: list[str] = Field(min_length=1, max_length=32)


class TemporaryAgentPolicy(BaseModel):
    model_config = ConfigDict(extra="forbid")
    enabled: bool = False
    models: list[TeamModel] = Field(default_factory=list, max_length=32)
    skill_ids: list[str] = Field(default_factory=list, max_length=128)

    @model_validator(mode="after")
    def explicit_allowlists(self) -> TemporaryAgentPolicy:
        if self.enabled and (not self.models or not self.skill_ids):
            raise ValueError("agent_team_temporary_allowlists_required")
        return self


class AgentTeam(BaseModel):
    model_config = ConfigDict(extra="forbid")
    version: Literal[1] = 1
    enabled: bool = False
    director_id: str = ""
    members: list[TeamMember] = Field(default_factory=list, max_length=32)
    direct_routes: list[DirectRoute] = Field(default_factory=list, max_length=64)
    temporary: TemporaryAgentPolicy = Field(default_factory=TemporaryAgentPolicy)

    @model_validator(mode="after")
    def unique_members(self) -> AgentTeam:
        ids = [member.agent_id for member in self.members]
        operations = [route.operation for route in self.direct_routes]
        if len(ids) != len(set(ids)) or len(operations) != len(set(operations)):
            raise ValueError("agent_team_duplicate_member_or_route")
        if self.enabled and not self.director_id:
            raise ValueError("agent_team_director_required")
        for route in self.direct_routes:
            if not set(route.agent_ids).issubset(ids):
                raise ValueError("agent_team_route_outside_members")
        return self


class TemporaryAgentSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=120)
    instructions: str = Field(min_length=1, max_length=12000)
    provider: str = Field(min_length=1, max_length=128)
    model: str = Field(min_length=1, max_length=256)
    skill_ids: list[str] = Field(min_length=1, max_length=32)
    acceptance: list[str] = Field(min_length=1, max_length=8)


class TeamTask(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(pattern=r"^[a-z][a-z0-9_-]{0,31}$")
    agent_id: str = ""
    objective: str = Field(min_length=1, max_length=8000)
    expected_result: str = Field(default="Satisfy the original output contract", max_length=4000)
    acceptance: list[str] = Field(default_factory=list, max_length=8)
    skill_ids: list[str] = Field(min_length=1, max_length=32)
    depends_on: list[str] = Field(default_factory=list, max_length=3)
    read_only: bool = True
    temporary: TemporaryAgentSpec | None = None


class TeamPlan(BaseModel):
    model_config = ConfigDict(extra="forbid")
    tasks: list[TeamTask] = Field(min_length=1, max_length=4)
    result_task: str
    synthesize: bool = False

    @model_validator(mode="after")
    def ordered_dag(self) -> TeamPlan:
        seen: set[str] = set()
        for task in self.tasks:
            if task.id in seen or not set(task.depends_on).issubset(seen):
                raise ValueError("agent_team_invalid_dependencies")
            if not task.agent_id and task.temporary is None:
                raise ValueError("agent_team_missing_executor")
            seen.add(task.id)
        if self.result_task not in seen:
            raise ValueError("agent_team_missing_result")
        if sum(task.temporary is not None for task in self.tasks) > 2:
            raise ValueError("agent_team_temporary_limit")
        return self


class RetentionDecision(BaseModel):
    model_config = ConfigDict(extra="forbid")
    accept: bool
    add_to_team: bool = False
    name: str = Field(default="", max_length=120)
    instructions: str | None = Field(default=None, min_length=1, max_length=12000)


class RetentionProposal(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str
    run_id: str
    status: str
    name: str
    instructions: str
    provider: str
    model: str
    skill_ids: list[str]
    acceptance: list[str]
    rationale: str
    evidence_run_ids: list[str]
    limitations: list[str]
    permanent_agent_id: str = ""
    reusable_skills: list[str] = Field(default_factory=list)
    comparisons: list[dict[str, str | bool | list[str]]] = Field(default_factory=list)
    equivalent_agent_ids: list[str] = Field(default_factory=list)
    verified_results: list[dict[str, str]] = Field(default_factory=list)
    instructions_origin: str = "legacy"
