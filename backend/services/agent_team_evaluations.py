"""Metadata-only measurements for comparing the same tasks across team policies.

The caller supplies completed executions; this module never invokes a provider.
Unknown usage or prices remain unknown instead of fabricating savings.
"""
from __future__ import annotations

from typing import Any
from backend.services.agent_team_policy import estimate_cost


def measure_case(case_id: str, strategy: str, runs: list[Any], registry: list[dict[str, Any]], *, director_id: str, contract_valid: bool, direct_route_available: bool, necessary_assignments: int) -> dict[str, Any]:
    models = {(r.get("provider"), r.get("model_id")): r for r in registry}
    # Call owners are the leaf model records, never aggregate job rows.
    calls = [r for r in runs if r.provider and r.model and r.model_calls]
    director_calls = sum(r.model_calls for r in calls if r.agent_id == director_id)
    assignments = len([r for r in calls if r.agent_id != director_id and r.parent_run_id])
    prices = [estimate_cost(models.get((r.provider, r.model), {}), r.input_tokens, r.output_tokens) if r.usage_available else None for r in calls]
    return {"case_id": case_id, "strategy": strategy, "contract_valid": contract_valid,
        "model_calls": sum(r.model_calls for r in calls), "director_calls": director_calls,
        "avoidable_director_calls": director_calls if direct_route_available else 0,
        "unnecessary_assignments": max(0, assignments - necessary_assignments),
        "cost_usd": sum(prices) if all(p is not None for p in prices) else None,
        "usage_available": all(r.usage_available for r in calls),
        "privacy": "synthetic_cases_metadata_only"}
