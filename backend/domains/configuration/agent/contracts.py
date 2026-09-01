"""Request contracts for governed agent configuration APIs."""

from __future__ import annotations

from typing import List, Optional

from pydantic import BaseModel, ConfigDict, Field

from backend.models.agent_skills import SkillActivation, SkillKind


class UserSkillWritePayload(BaseModel):
    """Editable fields of a user-owned declarative skill."""

    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=160)
    description: str = Field(default="", max_length=2000)
    version: str = Field(default="1.0.0", max_length=64)
    kind: SkillKind = SkillKind.AGENT
    activation: SkillActivation = SkillActivation.AUTOMATIC
    tool_ids: List[str] = Field(default_factory=list, max_length=64)
    instructions: str = Field(default="", max_length=100_000)
    requested_id: Optional[str] = None
    expected_revision: Optional[str] = None


class CloneSkillPayload(BaseModel):
    """Optional overrides when cloning an immutable catalog skill."""

    model_config = ConfigDict(extra="forbid")

    name: Optional[str] = Field(default=None, min_length=1, max_length=160)


class AgentSkillAssignmentPayload(BaseModel):
    """Revision-aware complete assignment list for one agent."""

    model_config = ConfigDict(extra="forbid")

    skill_ids: List[str] = Field(default_factory=list, max_length=128)
    expected_revision: Optional[str] = None


class AutomationWritePayload(BaseModel):
    """A recurring invocation of one explicitly assigned agent skill."""

    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=160)
    agent_id: str = Field(min_length=1, max_length=128)
    skill_id: str = Field(min_length=1, max_length=256)
    instruction: str = Field(min_length=1, max_length=12_000)
    interval_minutes: int = Field(default=1_440, ge=5, le=525_600)
    enabled: bool = False
    max_runs_per_day: int = Field(default=4, ge=1, le=144)
    max_ai_calls_per_run: int = Field(default=4, ge=1, le=16)
    max_runtime_seconds: int = Field(default=180, ge=15, le=900)
    expected_revision: Optional[str] = None


class EvaluationCandidateReviewPayload(BaseModel):
    """Administrative decision for one privacy-safe evaluation candidate."""

    decision: str = Field(pattern=r"^(pending_review|accepted|rejected)$")


class PersonalMemoryPayload(BaseModel):
    """Explicit user-owned memory fields."""

    model_config = ConfigDict(extra="forbid")
    text: str = Field(min_length=1, max_length=4_000)
    category: str = Field(default="preference", max_length=48)
    provenance: str = Field(default="user", max_length=96)
    expires_at: Optional[str] = Field(default=None, max_length=40)
    enabled: bool = True
    expected_revision: Optional[int] = Field(default=None, ge=1)


class SemanticAssociationPayload(BaseModel):
    """One explicit, reversible personal vocabulary correction."""

    model_config = ConfigDict(extra="forbid")

    trigger: str = Field(min_length=1, max_length=96)
    related_terms: List[str] = Field(min_length=1, max_length=24)
