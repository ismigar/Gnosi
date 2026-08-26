"""Profile-owned model routing for Gnosi agents."""

from __future__ import annotations

from typing import Any, Callable, Iterable, Mapping


VALID_MODES = {"pinned", "resilient", "adaptive"}
LOCAL_PROVIDERS = {"ollama", "lmstudio", "local", "llama-cpp", "llamacpp", "llama.cpp", "generic"}
MAX_ALTERNATIVES = 8


def route_key(provider: Any, model: Any) -> str:
    """Return one normalized provider/model route key."""
    return f"{str(provider or '').strip().lower()}:{str(model or '').strip()}"


def is_local_provider(provider: Any) -> bool:
    return str(provider or "").strip().lower() in LOCAL_PROVIDERS


def normalize_model_strategy(agent: Mapping[str, Any]) -> dict[str, Any]:
    """Normalize an agent strategy without expanding its authority."""
    raw = agent.get("model_strategy")
    raw = dict(raw) if isinstance(raw, Mapping) else {}
    mode = str(raw.get("mode") or "pinned").strip().lower()
    if mode not in VALID_MODES:
        mode = "pinned"
    alternatives = []
    seen = set()
    for item in raw.get("allowed_models") or []:
        if not isinstance(item, Mapping):
            continue
        provider = str(item.get("provider") or "").strip().lower()
        model = str(item.get("model") or item.get("model_id") or "").strip()
        key = route_key(provider, model)
        if not provider or not model or key in seen:
            continue
        seen.add(key)
        alternatives.append({"provider": provider, "model": model})
        if len(alternatives) >= MAX_ALTERNATIVES:
            break
    return {"schema_version": 1, "mode": mode, "allowed_models": alternatives}


def resolve_model_strategy(
    agent: Mapping[str, Any],
    registry: Iterable[Mapping[str, Any]],
) -> dict[str, Any]:
    """Resolve only explicitly enabled, same-locality routes for one agent."""
    strategy = normalize_model_strategy(agent)
    primary = {
        "provider": str(agent.get("provider") or "").strip().lower(),
        "model": str(agent.get("model") or "").strip(),
    }
    enabled = {
        route_key(row.get("provider"), row.get("model_id")): dict(row)
        for row in registry
        if isinstance(row, Mapping) and row.get("enabled") is True
    }
    primary_row = enabled.get(route_key(primary["provider"], primary["model"]), {})
    protected_tags = {
        tag for tag in (primary_row.get("tags") or [])
        if tag in {"tools", "vision"}
    }
    primary_local = is_local_provider(primary["provider"])
    eligible = []
    rejected = []
    for item in strategy["allowed_models"]:
        key = route_key(item["provider"], item["model"])
        reason = ""
        if key == route_key(primary["provider"], primary["model"]):
            reason = "duplicates_primary"
        elif key not in enabled:
            reason = "model_not_enabled"
        elif is_local_provider(item["provider"]) != primary_local:
            reason = "trust_boundary_mismatch"
        elif not protected_tags.issubset(set(enabled[key].get("tags") or [])):
            reason = "capability_mismatch"
        if reason:
            rejected.append({**item, "reason": reason})
        else:
            eligible.append({**enabled[key], "provider": item["provider"], "model_id": item["model"]})
    return {
        **strategy,
        "primary": primary,
        "eligible_models": eligible,
        "rejected_models": rejected,
    }


def validate_model_strategies(
    agents: Iterable[Mapping[str, Any]],
    registry: Iterable[Mapping[str, Any]],
) -> list[dict[str, Any]]:
    """Normalize configured strategies and reject any unauthorized route."""
    rows = [dict(row) for row in registry if isinstance(row, Mapping)]
    validated = []
    for raw_agent in agents:
        if not isinstance(raw_agent, Mapping):
            raise ValueError("Every AI agent must be an object.")
        agent = dict(raw_agent)
        resolved = resolve_model_strategy(agent, rows)
        if resolved["rejected_models"]:
            identifier = str(agent.get("id") or agent.get("name") or "agent")[:128]
            reasons = ", ".join(sorted({
                str(item.get("reason") or "invalid_route")
                for item in resolved["rejected_models"]
            }))
            raise ValueError(
                f"Invalid model strategy for {identifier}: {reasons}."
            )
        agent["model_strategy"] = {
            "schema_version": 1,
            "mode": resolved["mode"],
            "allowed_models": [
                {"provider": item["provider"], "model": item["model_id"]}
                for item in resolved["eligible_models"]
            ],
        }
        validated.append(agent)
    return validated


def choose_agent_model(
    message: str,
    agent: Mapping[str, Any],
    registry: Iterable[Mapping[str, Any]],
    *,
    is_available: Callable[[str], bool],
    usage: Mapping[str, Any] | None = None,
    budget: Mapping[str, Any] | None = None,
    quality_scores: Mapping[str, float] | None = None,
) -> dict[str, Any]:
    """Choose a route while keeping the agent's primary model authoritative."""
    from backend.agent.model_router import classify_request, route_model

    resolved = resolve_model_strategy(agent, registry)
    primary = resolved["primary"]
    candidates = []
    registry_by_key = {
        route_key(row.get("provider"), row.get("model_id")): dict(row)
        for row in registry if isinstance(row, Mapping)
    }
    primary_row = registry_by_key.get(route_key(primary["provider"], primary["model"]), {
        "provider": primary["provider"], "model_id": primary["model"], "enabled": True,
    })
    candidates.append(primary_row)
    required_tags = set(classify_request(message).get("needs") or [])
    candidates.extend(
        row for row in resolved["eligible_models"]
        if required_tags.issubset(set(row.get("tags") or []))
    )
    scores = quality_scores or {}
    for row in candidates:
        score = scores.get(route_key(row.get("provider"), row.get("model_id")))
        if score is not None:
            row["quality"] = max(1, min(3, int(round(1 + 2 * float(score)))))

    selected = dict(primary)
    reason = "agent_primary_pinned"
    if resolved["mode"] == "adaptive" and len(candidates) > 1:
        decision = route_model(
            message,
            candidates,
            is_available=is_available,
            usage=dict(usage or {}),
            budget=dict(budget or {}),
        )
        if decision.get("provider") and decision.get("model_id"):
            selected = {"provider": decision["provider"], "model": decision["model_id"]}
            reason = str(decision.get("reason") or "adaptive_profile_strategy")
    fallbacks = []
    if resolved["mode"] in {"resilient", "adaptive"}:
        fallbacks = [
            {"provider": str(row.get("provider")), "model": str(row.get("model_id"))}
            for row in candidates
            if route_key(row.get("provider"), row.get("model_id"))
            != route_key(selected["provider"], selected["model"])
        ]
    return {
        **resolved,
        "selected": selected,
        "selection_reason": reason,
        "fallback_models": fallbacks,
    }
