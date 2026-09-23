"""Hard constraints shared by internal and external model selectors."""

from __future__ import annotations

from typing import Any, Callable, Mapping


def model_cost(row: Mapping[str, Any]) -> float:
    if row.get("is_local"):
        return 0.0
    if row.get("price_unknown"):
        return float("inf")
    return float(row.get("cost_in") or 0) + float(row.get("cost_out") or 0)


def eligible_routes(
    rows: list[dict[str, Any]],
    *,
    is_available: Callable[[str], bool],
    usage: Mapping[str, Any],
    budget: Mapping[str, Any],
    required_tags: set[str],
    context_tokens: int,
) -> list[dict[str, Any]]:
    """Remove forbidden routes before any selector sees the candidate list."""
    candidates = []
    for row in rows:
        if row.get("enabled") is not True or not is_available(str(row["provider"])):
            continue
        if not required_tags.issubset(set(row.get("tags") or [])):
            continue
        if context_tokens > int(row.get("context_window") or 0):
            continue
        quota = int(row.get("monthly_quota") or 0)
        used = int(usage.get(f"{row['provider']}:{row['model_id']}", 0))
        if quota > 0 and used >= quota:
            continue
        candidates.append(row)
    return constrain_budget(candidates, budget)


def constrain_budget(
    candidates: list[dict[str, Any]], budget: Mapping[str, Any],
) -> list[dict[str, Any]]:
    cap = budget.get("cost_cap_usd")
    spent = float(budget.get("spent_usd") or 0)
    if cap is not None and spent >= float(cap):
        if budget.get("enforce_block"):
            return []
        return [row for row in candidates if model_cost(row) == 0]
    near_cap = cap is not None and spent >= 0.8 * float(cap)
    remaining = budget.get("remaining_tokens")
    below = budget.get("prefer_local_below", 0)
    tight = near_cap or bool(budget.get("prefer_local")) or (
        remaining is not None and below and remaining <= below
    )
    if candidates and tight:
        local = [row for row in candidates if row.get("is_local")]
        candidates = local or candidates
        cheapest = min(model_cost(row) for row in candidates)
        return [row for row in candidates if model_cost(row) == cheapest]
    return candidates


def current_routing_limits() -> tuple[dict[str, int], dict[str, Any]]:
    """Read current usage and the effective currency-converted budget."""
    from backend.agent.model_router import UsageStore, budget_status

    status = budget_status()
    budget = dict(status.get("budget") or {})
    budget.update(cost_cap_usd=status.get("cap_usd"), spent_usd=status["spent_usd"])
    return UsageStore().usage_for(status["period"]), budget
