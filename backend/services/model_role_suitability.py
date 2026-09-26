"""Independent role assessments with explicit provenance and untested abilities."""
from __future__ import annotations

from typing import Any, Literal
from math import isfinite
from bisect import bisect_left, bisect_right
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
    status: Literal["catalog_compatible", "tested", "insufficient_data", "limitation", "below_threshold"]
    evidence: list[str] = Field(default_factory=list)
    proofs: list[RoleEvidence] = Field(default_factory=list)
    missing: list[str] = Field(default_factory=list)
    source: str = "catalog"
    checked_at: str | None = None
    evaluation_id: int | None = None
    score: float | None = None
    coverage: float = 0
    method: str = "weighted_catalog_v1"
    weights: dict[str, float] = Field(default_factory=dict)


# Versioned recommendation heuristics, not measured task quality. Weights sum to 1.
ROLE_WEIGHTS = {
    "director": {"intelligence": .30, "agentic": .25, "tool_support": .20, "long_context": .10, "token_cost": .10, "latency": .05},
    "allrounder": {"intelligence": .30, "tool_support": .25, "long_context": .10, "speed": .10, "latency": .10, "token_cost": .15},
    "documentalist": {"long_context": .45, "intelligence": .25, "token_cost": .15, "speed": .10, "latency": .05},
    "expert": {"intelligence": .60, "coding": .10, "long_context": .15, "token_cost": .10, "latency": .05},
    "administrative": {"tool_or_structured_support": .30, "intelligence": .25, "token_cost": .20, "speed": .15, "latency": .10},
    "worker": {"text_support": .10, "intelligence": .15, "token_cost": .35, "speed": .25, "latency": .15},
}
PENDING = {
    "director": ["planning_quality", "executor_selection", "delegation_cost"],
    "allrounder": ["catalan_quality", "instruction_following", "tool_reliability"],
    "documentalist": ["citation_fidelity", "passage_retrieval", "coverage"],
    "expert": ["complex_reasoning", "uncertainty_calibration"],
    "administrative": ["schema_accuracy", "extraction_accuracy"],
    "worker": ["task_accuracy", "measured_task_cost"],
}


def _number(value: Any) -> float | None:
    return float(value) if isinstance(value, (int, float)) and not isinstance(value, bool) and isfinite(value) and value >= 0 else None


def _rank(value: float, values: list[float]) -> float:
    # Mid-rank keeps ties equal; an isolated benchmark supplies no relative advantage.
    if len(values) < 2:
        return .5
    return (bisect_left(values, value) + bisect_right(values, value) - 1) / (2 * (len(values) - 1))


def assess_roles(model: dict[str, Any], peers: list[dict[str, Any]] | None = None) -> list[dict[str, Any]]:
    tags = set(model.get("tags") or [])
    tools = model.get("supports_tools", True if "tools" in tags else None)
    structured = model.get("structured_output")
    procedure = True if tools is True or structured is True else False if tools is False and structured is False else None
    modes = model.get("modes") or []
    raw = {key: _number(model.get(key)) for key in ("intelligence", "agentic", "coding", "speed", "latency")}
    raw.update(long_context=_number(model.get("context_window")), tool_support=tools,
               tool_or_structured_support=procedure, text_support=("text" in modes) if modes else None)
    input_price, output_price = _number(model.get("input_price")), _number(model.get("output_price"))
    # Fixed 4:1 token mix is a price proxy, never a measured task cost.
    raw["token_cost"] = (4 * input_price + output_price) / 5 if input_price is not None and output_price is not None else None
    normalized: dict[str, float] = {}
    for key, value in raw.items():
        if value is None:
            continue
        if key in {"intelligence", "agentic", "coding"}:
            values = sorted(v for peer in (peers or [model]) if (v := _number(peer.get(key))) is not None)
            normalized[key] = _rank(value, values)
        elif key in {"tool_support", "tool_or_structured_support", "text_support"}:
            normalized[key] = float(value)
        elif key == "long_context":
            normalized[key] = min(value / 200_000, 1)
        elif key == "speed":
            normalized[key] = min(value / 100, 1)
        else:
            normalized[key] = 1 / (1 + value / 2)
    result = []
    for role, weights in ROLE_WEIGHTS.items():
        coverage = sum(weight for key, weight in weights.items() if key in normalized)
        score = round(100 * sum(normalized[key] * weight for key, weight in weights.items() if key in normalized) / coverage, 1) if coverage else None
        required = {"director": ["intelligence", "agentic", "tool_support"], "allrounder": ["intelligence", "tool_support"],
                    "documentalist": ["intelligence", "long_context"], "expert": ["intelligence"],
                    "administrative": ["intelligence", "tool_or_structured_support"], "worker": ["text_support", "token_cost", "speed"]}[role]
        limitation = (tools is False and role in {"director", "allrounder"}) or (procedure is False and role == "administrative") or (role == "documentalist" and raw["long_context"] is not None and raw["long_context"] < 100_000) or (role == "worker" and raw["text_support"] is False)
        enough = coverage >= .6 and all(key in normalized for key in required)
        status = "limitation" if limitation else "insufficient_data" if not enough else "catalog_compatible" if score is not None and score >= 60 else "below_threshold"
        proofs = [RoleEvidence(metric=key, source="benchmark" if key in {"intelligence", "coding", "agentic", "speed", "latency"} else "declared", value=raw[key], checked_at=model.get("fetched_at")) for key in weights if raw[key] is not None]
        result.append(RoleAssessment(role=role, status=status, score=score if enough else None, coverage=round(coverage * 100, 1), weights=weights,
            evidence=[p.metric for p in proofs], proofs=proofs, missing=[key for key in weights if key not in normalized] + PENDING[role],
            source="mixed" if len({p.source for p in proofs}) > 1 else proofs[0].source if proofs else "catalog", checked_at=model.get("fetched_at")).model_dump())
    return result
