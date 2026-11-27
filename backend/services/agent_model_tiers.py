"""Opt-in model tier table and automatic same-locality fallback resolution."""
from __future__ import annotations

from pathlib import Path
from typing import Any, Callable, Iterable, Literal, Mapping

import yaml
from pydantic import BaseModel, Field

from backend.services.agent_model_strategy import is_local_provider, route_key
from backend.services.agent_routing_policy import eligible_routes

TierName = Literal["minimal", "standard", "advanced"]
OptionalTierName = Literal["", "minimal", "standard", "advanced"]
VALID_TIERS: tuple[TierName, ...] = ("minimal", "standard", "advanced")
MAX_TIER_ROUTES = 4


class ModelTierRoute(BaseModel):
    provider: str
    model: str


class ModelTiersConfig(BaseModel):
    minimal: list[ModelTierRoute] = Field(default_factory=list)
    standard: list[ModelTierRoute] = Field(default_factory=list)
    advanced: list[ModelTierRoute] = Field(default_factory=list)
    gauntlet_reviewer_tier: OptionalTierName = ""


def _normalize_routes(raw: Any) -> list[dict[str, str]]:
    if not isinstance(raw, list):
        return []
    routes: list[dict[str, str]] = []
    seen: set[str] = set()
    for item in raw:
        if not isinstance(item, Mapping):
            continue
        provider = str(item.get("provider") or "").strip().lower()
        model = str(item.get("model") or item.get("model_id") or "").strip()
        key = route_key(provider, model)
        if not provider or not model or key in seen:
            continue
        seen.add(key)
        routes.append({"provider": provider, "model": model})
        if len(routes) >= MAX_TIER_ROUTES:
            break
    return routes


def normalize_model_tiers(ai_cfg: Mapping[str, Any] | None) -> dict[str, Any]:
    """Normalize persisted model tier configuration without mutating input."""
    cfg = ai_cfg if isinstance(ai_cfg, Mapping) else {}
    raw_tiers = cfg.get("model_tiers")
    tiers = raw_tiers if isinstance(raw_tiers, Mapping) else {}
    reviewer_tier = str(cfg.get("gauntlet_reviewer_tier") or "").strip().lower()
    if reviewer_tier not in VALID_TIERS:
        reviewer_tier = ""
    return {
        "minimal": _normalize_routes(tiers.get("minimal")),
        "standard": _normalize_routes(tiers.get("standard")),
        "advanced": _normalize_routes(tiers.get("advanced")),
        "gauntlet_reviewer_tier": reviewer_tier,
    }


def validate_model_tiers(
    payload: Mapping[str, Any],
    registry: Iterable[Mapping[str, Any]],
) -> dict[str, Any]:
    """Validate that every configured tier route is enabled in the registry."""
    enabled = {
        route_key(row.get("provider"), row.get("model_id"))
        for row in registry
        if isinstance(row, Mapping) and row.get("enabled") is True
    }
    normalized = normalize_model_tiers(
        {
            "model_tiers": {tier: payload.get(tier) for tier in VALID_TIERS},
            "gauntlet_reviewer_tier": payload.get("gauntlet_reviewer_tier", ""),
        }
    )
    for tier in VALID_TIERS:
        for item in normalized[tier]:
            if route_key(item["provider"], item["model"]) not in enabled:
                raise ValueError(f"Tier '{tier}' references disabled or unknown model {item['provider']}/{item['model']}.")
    return normalized


def load_model_tiers(ai_cfg: Mapping[str, Any] | None = None) -> dict[str, Any]:
    if ai_cfg is None:
        from backend.config.app_config import load_params

        ai_cfg = dict(load_params(strict_env=False).ai)
    return normalize_model_tiers(ai_cfg)


def save_model_tiers(payload: ModelTiersConfig) -> dict[str, Any]:
    """Validate and atomically persist model tiers into params.yaml."""
    from backend.agent.model_router import load_registry
    from backend.config.app_config import load_params
    from backend.utils.metadata_io import read_vault_text
    from backend.utils.safe_io import safe_write_text

    normalized = validate_model_tiers(payload.model_dump(), load_registry())
    cfg = load_params(strict_env=False)
    params_path = Path(cfg.params_source)
    loaded = yaml.safe_load(read_vault_text(params_path)) if params_path.exists() else {}
    doc: dict[str, Any] = dict(loaded) if isinstance(loaded, Mapping) else {}
    raw_ai = doc.get("ai")
    ai = dict(raw_ai) if isinstance(raw_ai, Mapping) else {}
    ai["model_tiers"] = {tier: normalized[tier] for tier in VALID_TIERS}
    ai["gauntlet_reviewer_tier"] = normalized["gauntlet_reviewer_tier"]
    doc["ai"] = ai
    safe_write_text(params_path, yaml.safe_dump(doc, sort_keys=False, allow_unicode=True))
    return normalized


def resolve_tier_route(
    profile: Mapping[str, Any],
    ai_cfg: Mapping[str, Any],
    registry: Iterable[Mapping[str, Any]],
    *,
    is_available: Callable[[str], bool],
    usage: Mapping[str, Any] | None = None,
    budget: Mapping[str, Any] | None = None,
    message: str = "",
) -> tuple[str, str | None, dict[str, Any]] | None:
    """Resolve an opt-in tier route and same-locality fallbacks, or None if pinned."""
    tier = str(profile.get("model_tier") or "").strip().lower()
    if tier not in VALID_TIERS:
        return None
    tiers = normalize_model_tiers(ai_cfg)
    configured = tiers.get(tier) or []
    if not configured:
        return None
    enabled = {
        route_key(row.get("provider"), row.get("model_id")): dict(row)
        for row in registry
        if isinstance(row, Mapping) and row.get("enabled") is True
    }
    primary_provider = str(profile.get("provider") or "").strip().lower()
    expected_local = is_local_provider(primary_provider) if primary_provider else is_local_provider(configured[0]["provider"])
    candidates = []
    for item in configured:
        row = enabled.get(route_key(item["provider"], item["model"]))
        if not row or is_local_provider(item["provider"]) != expected_local:
            continue
        candidates.append({**row, "provider": item["provider"], "model_id": item["model"]})
    if not candidates:
        return None
    fallback_enabled = bool(profile.get("model_tier_fallback"))
    evaluated = candidates if fallback_enabled else candidates[:1]
    if usage is None or budget is None:
        from backend.services.agent_routing_policy import current_routing_limits

        cur_usage, cur_budget = current_routing_limits()
        usage = cur_usage if usage is None else usage
        budget = cur_budget if budget is None else budget
    eligible = eligible_routes(
        evaluated,
        is_available=is_available,
        usage=usage,
        budget=budget,
        required_tags=set(),
        context_tokens=max(1, len(message) // 3),
    )
    if not eligible:
        return None
    selected = eligible[0]
    fallbacks = (
        [{"provider": str(row["provider"]), "model": str(row["model_id"])} for row in eligible[1:]]
        if fallback_enabled
        else []
    )
    reason = "model_tier_primary" if route_key(selected["provider"], selected["model_id"]) == route_key(candidates[0]["provider"], candidates[0]["model_id"]) else "model_tier_fallback"
    return (
        str(selected["provider"]),
        str(selected["model_id"]),
        {
            "mode": "tier_fallback" if fallback_enabled else "tier",
            "tier": tier,
            "fallback_models": fallbacks,
            "selection_reason": reason,
        },
    )


def apply_gauntlet_reviewer_tier(
    profile: dict[str, Any],
    ai_cfg: Mapping[str, Any] | None = None,
    registry: Iterable[Mapping[str, Any]] | None = None,
) -> None:
    """Optionally switch Gauntlet review phase to a configured same-locality tier model."""
    tiers = load_model_tiers(ai_cfg)
    tier = tiers.get("gauntlet_reviewer_tier") or ""
    if tier not in VALID_TIERS:
        return
    routes = tiers.get(tier) or []
    if not routes:
        return
    if registry is None:
        from backend.agent.model_router import load_registry

        registry = load_registry()
    enabled = {
        route_key(row.get("provider"), row.get("model_id"))
        for row in registry
        if isinstance(row, Mapping) and row.get("enabled") is True
    }
    source_local = is_local_provider(profile.get("provider"))
    for item in routes:
        if route_key(item["provider"], item["model"]) in enabled and is_local_provider(item["provider"]) == source_local:
            profile["provider"] = item["provider"]
            profile["model"] = item["model"]
            profile["openrouter_route"] = None
            profile["model_tier"] = ""
            profile["model_tier_fallback"] = False
            return
