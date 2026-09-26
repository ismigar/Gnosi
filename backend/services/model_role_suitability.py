"""Independent role assessments with explicit provenance and untested abilities."""
from __future__ import annotations

from typing import Any, Literal
from pydantic import BaseModel, Field
from backend.services.agent_team_models import TeamRole


class RoleEvidence(BaseModel):
    metric: str
    source: Literal["declared", "benchmark", "gnosi"]
    value: float | bool | str
    checked_at: str | None = None
    test_id: str | None = None


class RoleAssessment(BaseModel):
    role: TeamRole
    status: Literal["catalog_compatible", "tested", "insufficient_data", "limitation"]
    evidence: list[str] = Field(default_factory=list)
    proofs: list[RoleEvidence] = Field(default_factory=list)
    missing: list[str] = Field(default_factory=list)
    source: str = "catalog"
    checked_at: str | None = None
    evaluation_id: int | None = None


def assess_roles(model: dict[str, Any]) -> list[dict[str, Any]]:
    tags = set(model.get("tags") or [])
    tools = model.get("supports_tools", True if "tools" in tags else None)
    context = model.get("context_window")
    reasoning = "reasoning" in tags or model.get("intelligence") is not None
    facts: dict[TeamRole, tuple[bool, list[str], list[str]]] = {
        "director": (tools is True and (reasoning or model.get("agentic") is not None), ["tool_support", "reasoning"], ["planning_quality", "executor_selection", "delegation_cost"]),
        "allrounder": (tools is True, ["tool_support"], ["catalan_quality", "instruction_following", "tool_reliability"]),
        "documentalist": (isinstance(context, (int, float)) and context >= 100_000, ["long_context"], ["citation_fidelity", "passage_retrieval", "coverage"]),
        "expert": (reasoning, ["reasoning"], ["complex_reasoning", "uncertainty_calibration"]),
        "administrative": (tools is True or model.get("structured_output") is True, ["tool_or_structured_support"], ["schema_accuracy", "extraction_accuracy"]),
        "worker": ("text" in model.get("modes", []), ["text_support"], ["task_accuracy", "measured_task_cost"]),
    }
    proof_values = {"tool_support": tools, "reasoning": model.get("intelligence", model.get("agentic", "reasoning" in tags)),
        "long_context": context, "tool_or_structured_support": tools is True or model.get("structured_output") is True,
        "text_support": "text" in model.get("modes", [])}
    result = []
    for role, (compatible, evidence, missing) in facts.items():
        limitation = tools is False and role in {"director", "allrounder"}
        proofs = [RoleEvidence(metric=metric,
            source="benchmark" if metric == "reasoning" and (model.get("intelligence") is not None or model.get("agentic") is not None) else "declared",
            value=proof_values[metric], checked_at=model.get("fetched_at")) for metric in evidence if compatible and proof_values[metric] is not None]
        sources = {p.source for p in proofs}
        result.append(RoleAssessment(role=role, status="limitation" if limitation else "catalog_compatible" if compatible else "insufficient_data",
            evidence=evidence if compatible else [], proofs=proofs, missing=missing + ([] if compatible else evidence),
            source="mixed" if len(sources) > 1 else next(iter(sources), "catalog"),
            checked_at=model.get("fetched_at")).model_dump())
    return result
