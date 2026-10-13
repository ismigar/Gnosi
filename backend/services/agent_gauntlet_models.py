"""Fixed acceptance criteria and evidence-backed automatic quality reviews."""
from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class GauntletPlan(BaseModel):
    model_config = ConfigDict(extra="forbid", json_schema_extra={"required": ["mode"]})
    mode: Literal["routine", "elaborate"] = "routine"
    reason: str = Field(default="", max_length=1000)
    criteria: list[Annotated[str, Field(min_length=1, max_length=4096)]] = Field(default_factory=list, max_length=8)

    @model_validator(mode="after")
    def concrete_criteria(self) -> GauntletPlan:
        if any(not item.strip() for item in self.criteria):
            raise ValueError("agent_gauntlet_invalid_criterion")
        if len(set(self.criteria)) != len(self.criteria):
            raise ValueError("agent_gauntlet_duplicate_criterion")
        if self.mode == "elaborate" and (not self.reason.strip() or not self.criteria):
            raise ValueError("agent_gauntlet_criteria_required")
        return self


class GauntletCheck(BaseModel):
    model_config = ConfigDict(extra="forbid")
    criterion_id: str = Field(pattern=r"^C[1-8]$")
    outcome: Literal["passed", "failed", "unverifiable"]
    severity: Literal["none", "low", "medium", "high", "critical"]
    evidence: str = Field(min_length=1, max_length=4000)
    issue: str = Field(default="", max_length=2000)

    @model_validator(mode="after")
    def evidence_required(self) -> GauntletCheck:
        if not self.evidence.strip():
            raise ValueError("agent_gauntlet_evidence_required")
        if self.outcome == "failed" and (self.severity == "none" or not self.issue.strip()):
            raise ValueError("agent_gauntlet_finding_required")
        if self.outcome != "failed" and self.severity != "none":
            raise ValueError("agent_gauntlet_invalid_severity")
        if self.outcome == "passed" and self.issue.strip():
            raise ValueError("agent_gauntlet_invalid_issue")
        return self


class GauntletReview(BaseModel):
    model_config = ConfigDict(extra="forbid")
    checks: list[GauntletCheck] = Field(min_length=1, max_length=8)

    def validate_coverage(self, criteria: list[dict[str, str]]) -> GauntletReview:
        ids = [item.criterion_id for item in self.checks]
        if len(set(ids)) != len(ids) or set(ids) != {item["id"] for item in criteria}:
            raise ValueError("agent_gauntlet_incomplete_criteria")
        return self

    @property
    def accepted(self) -> bool:
        return all(item.outcome == "passed" for item in self.checks)

    @property
    def unverifiable(self) -> bool:
        return any(item.outcome == "unverifiable" for item in self.checks)

    @property
    def findings(self) -> dict[str, int]:
        weights = {"none": 0, "low": 1, "medium": 2, "high": 3, "critical": 4}
        return {item.criterion_id: weights[item.severity] for item in self.checks if item.outcome == "failed"}


def improved(previous: GauntletReview, current: GauntletReview) -> bool:
    """Renaming or moving a defect cannot count as measurable progress."""
    before, after = previous.findings, current.findings
    return (all(weight <= before.get(key, 0) for key, weight in after.items())
            and any(after.get(key, 0) < weight for key, weight in before.items()))
