"""Model-free eligibility and economic routing. Labels never grant capabilities."""
from __future__ import annotations

import math
import re
from typing import Any, Callable, Iterable

from backend.services.agent_team_models import AgentTeam, TEAM_SKILL
from backend.services.agent_model_strategy import is_local_provider


def team_for(profile: dict[str, Any]) -> AgentTeam:
    return AgentTeam.model_validate(profile.get("team") or {})


def validate_teams(ai: dict[str, Any], registry: list[dict[str, Any]]) -> None:
    profiles = {p["id"]: p for p in ai.get("agents", [])}
    routes = {(r.get("provider"), r.get("model_id")) for r in registry if r.get("enabled") is True}
    from backend.services.agent_operation_catalog import OPERATIONS
    for profile in profiles.values():
        team = team_for(profile)
        if not team.enabled:
            continue
        ids = {team.director_id, *(m.agent_id for m in team.members)}
        if not ids.issubset(profiles):
            raise ValueError("agent_team_profile_missing")
        for identifier in ids:
            target = profiles[identifier]
            if not target.get("enabled", True) or target.get("plugin_suspended"):
                raise ValueError("agent_team_profile_unavailable")
            if is_local_provider(profile.get("provider")) and not is_local_provider(target.get("provider")):
                raise ValueError("agent_team_local_boundary")
        if TEAM_SKILL not in profiles[team.director_id].get("skill_ids", []):
            raise ValueError("agent_team_director_skill_required")
        for route in team.direct_routes:
            if route.operation not in OPERATIONS:
                raise ValueError("agent_team_unknown_operation")
        for candidate in team.temporary.models:
            if (candidate.provider, candidate.model) not in routes:
                raise ValueError("agent_team_model_unavailable")
            if is_local_provider(profile.get("provider")) and not is_local_provider(candidate.provider):
                raise ValueError("agent_team_local_boundary")
        if TEAM_SKILL in team.temporary.skill_ids:
            raise ValueError("agent_team_nested_coordination_forbidden")


def estimate_cost(row: dict[str, Any], input_tokens: int, output_tokens: int = 1024) -> float | None:
    if row.get("price_unknown"):
        return None
    rates = (row.get("cost_in"), row.get("cost_out"))
    if any(not isinstance(v, (int, float)) or isinstance(v, bool) or not math.isfinite(v) or v < 0 for v in rates):
        return None
    return (float(row["cost_in"]) * input_tokens + float(row["cost_out"]) * output_tokens) / 1_000_000


def select_executor(
    profiles: Iterable[dict[str, Any]], registry: Iterable[dict[str, Any]],
    *, allowed_ids: list[str], skill_ids: list[str], input_tokens: int,
    source_provider: str, runtime_check: Callable[[dict[str, Any], list[str]], bool],
    is_available: Callable[[str], bool] = lambda _: True,
    preferred_id: str = "", require_tools: bool = False,
    usage: dict[str, int] | None = None,
) -> tuple[dict[str, Any] | None, str, float | None]:
    by_id = {p["id"]: p for p in profiles}
    models = {(r.get("provider"), r.get("model_id")): r for r in registry if r.get("enabled") is True}
    candidates: list[tuple[float, int, dict[str, Any], float | None]] = []
    for order, identifier in enumerate(allowed_ids):
        p = by_id.get(identifier)
        if not p or not p.get("enabled", True) or p.get("plugin_suspended"):
            continue
        provider = str(p.get("provider") or "")
        row = models.get((provider, p.get("model")))
        if not row or not is_available(provider):
            continue
        quota = int(row.get("monthly_quota") or 0)
        if quota > 0 and (usage or {}).get(f"{provider}:{p.get('model')}", 0) >= quota:
            continue
        if is_local_provider(source_provider) and not is_local_provider(provider):
            continue
        if input_tokens + 1024 > int(row.get("context_window") or 0):
            continue
        if require_tools and "tools" not in (row.get("tags") or []):
            continue
        if not runtime_check(p, skill_ids):
            continue
        cost = estimate_cost(row, input_tokens)
        candidates.append((cost if cost is not None else math.inf, order, p, cost))
    if not candidates:
        return None, "no_eligible_executor", None
    known = [c for c in candidates if c[3] is not None]
    selected = min(known, key=lambda c: (c[0], c[1])) if known else candidates[0]
    return selected[2], "lowest_estimated_cost" if known else "configured_order_cost_unknown", selected[3]


def chat_operation(message: str) -> str:
    """Only recognize whole, explicit text transformations; no keyword routing.

    A colon and supplied text are required. Compound requests and pronouns that
    require resolving a conversation are left to the director.
    """
    patterns = {
        "writing": r"(?:resumeix|resumir|summarize|summarise|resume|résume|corrigeix|correct|corrige)\s*:\s*\S[\s\S]*",
        "translation": r"(?:tradueix\s+al|translate\s+to|traduce\s+al|traduis\s+en)\s+(?:català|catalan|catalán|anglès|english|inglés|anglais|castellà|spanish|español|espagnol|francès|french|francés|français)\s*:\s*\S[\s\S]*",
    }
    return next((key for key, pattern in patterns.items() if re.fullmatch(pattern, message.strip(), re.I)), "")
