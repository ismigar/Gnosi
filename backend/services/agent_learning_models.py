"""Bounded, portable contracts for conversation learning."""

from __future__ import annotations

from typing import Literal, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator

from backend.domains.agent.routes.contracts import TurnContextRef


class LearningModel(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class ProjectDraft(LearningModel):
    name: str = Field(min_length=1, max_length=160)
    instructions: str = Field(default="", max_length=8_000)
    context_refs: list[TurnContextRef] = Field(default_factory=list, max_length=16)
    results: list[str] = Field(default_factory=list, max_length=40)
    expected_revision: int | None = Field(default=None, ge=1)

    @model_validator(mode="after")
    def bounded_sources(self) -> Self:
        if any(ref.type == "notebook" for ref in self.context_refs):
            raise ValueError("Use a notebook conversation for notebook sources.")
        if any(len(result) > 2_000 for result in self.results):
            raise ValueError("Result references must be at most 2,000 characters.")
        return self


class LearningProject(ProjectDraft):
    id: str
    revision: int
    updated_at: str


class ProjectBinding(LearningModel):
    project_id: str = Field(default="", max_length=64)


class LearningWorkspace(LearningModel):
    projects: list[LearningProject]
    project_id: str = ""


class SkillExample(LearningModel):
    name: str = Field(min_length=1, max_length=160)
    input: str = Field(min_length=1, max_length=8_000)
    expected: str = Field(min_length=1, max_length=8_000)


class SkillResource(LearningModel):
    name: str = Field(min_length=1, max_length=120, pattern=r"^[\w.-]+\.(?:md|txt|json|csv|yaml)$")
    content: str = Field(max_length=16_000)


class LearnedSkill(LearningModel):
    name: str = Field(min_length=1, max_length=160)
    description: str = Field(default="", max_length=2_000)
    instructions: str = Field(min_length=1, max_length=24_000)
    tool_ids: list[str] = Field(default_factory=list, max_length=64)
    criteria: list[str] = Field(min_length=1, max_length=16)
    examples: list[SkillExample] = Field(default_factory=list, max_length=8)
    resources: list[SkillResource] = Field(default_factory=list, max_length=12)

    @model_validator(mode="after")
    def bounded_criteria(self) -> Self:
        if any(not item.strip() or len(item) > 1_000 for item in self.criteria):
            raise ValueError("Criteria must contain 1–1,000 characters.")
        if len({item.name for item in self.resources}) != len(self.resources):
            raise ValueError("Resource names must be unique.")
        if len(self.model_dump_json().encode("utf-8")) > 80_000:
            raise ValueError("Skill packages must fit within 80 KB.")
        return self


class LearnRequest(LearningModel):
    agent_id: str = Field(min_length=1, max_length=128)
    session_id: str = Field(min_length=1, max_length=128)
    language: Literal["ca", "en", "es", "fr"] = "en"
    goal: str = Field(default="", max_length=2_000)


class SaveLearningRequest(LearningModel):
    skill: LearnedSkill
    agent_id: str = Field(min_length=1, max_length=128)
    session_id: str = Field(default="", max_length=128)
    assign: bool = False


class SkillPackage(LearningModel):
    format: Literal["gnosi-skill-v1"] = "gnosi-skill-v1"
    skill: LearnedSkill


class SkillTrialRequest(LearningModel):
    skill: LearnedSkill
    agent_id: str = Field(min_length=1, max_length=128)
    input: str = Field(min_length=1, max_length=12_000)


class CriterionResult(LearningModel):
    criterion: str = Field(max_length=1_000)
    met: bool
    evidence: str = Field(max_length=2_000)


class SkillTrialResult(LearningModel):
    output: str
    checks: list[CriterionResult]
    mode: Literal["text_trial"] = "text_trial"


class SavedLearning(LearningModel):
    skill_id: str
    assigned: bool
    missing_tools: list[str] = Field(default_factory=list)
