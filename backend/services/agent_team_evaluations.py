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


def compare_case_quality(reference: list[dict[str, Any]], candidate: list[dict[str, Any]],
                         *, criteria: tuple[str, ...] = ("completed", "content_checks_pass")) -> dict[str, Any]:
    """Require complete per-case evidence; improvements cannot offset regressions."""
    if not criteria or len(set(criteria)) != len(criteria):
        raise ValueError("quality_criteria_required_and_unique")

    def indexed(rows: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
        result: dict[str, dict[str, Any]] = {}
        for row in rows:
            identifier = row.get("id")
            if not isinstance(identifier, str) or not identifier or identifier in result:
                raise ValueError("quality_case_ids_required_and_unique")
            result[identifier] = row
        return result

    before, after = indexed(reference), indexed(candidate)
    missing = sorted(set(before) - set(after))
    unexpected = sorted(set(after) - set(before))
    regressions, incomplete, changed, failures = [], [], [], []
    for identifier in sorted(set(before) & set(after)):
        previous, current = before[identifier], after[identifier]
        if any(previous.get(key) != current.get(key) for key in ("prompt", "checks")):
            changed.append(identifier)
        for criterion in criteria:
            old, new = previous.get(criterion), current.get(criterion)
            if type(old) is not bool or type(new) is not bool:
                incomplete.append({"id": identifier, "criterion": criterion})
            if old is True and new is False:
                regressions.append({"id": identifier, "criterion": criterion})
            if new is not True:
                failures.append({"id": identifier, "criterion": criterion})
    return {"accepted": bool(before) and not any((missing, unexpected, regressions, incomplete, changed, failures)),
            "criteria": list(criteria), "cases": len(before), "regressions": regressions,
            "candidate_failures": failures, "incomplete_evidence": incomplete,
            "missing_cases": missing, "unexpected_cases": unexpected, "changed_case_definitions": changed}
