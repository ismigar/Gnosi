"""Explicit model bindings and safe confirmation of their removal."""
import copy
import hashlib
import json
import threading
from typing import Any


model_configuration_lock = threading.RLock()


def route(value: dict[str, Any]) -> tuple[str, str]:
    return str(value.get("provider") or "").strip().lower(), str(value.get("model") or value.get("model_id") or "").strip()


def detach_models(agents: list[Any], disabled: set[tuple[str, str]]) -> tuple[list[Any], list[dict[str, str]], str]:
    result = copy.deepcopy(agents)
    affected = []
    for agent in result:
        if not isinstance(agent, dict):
            continue
        changed = False
        if route(agent) in disabled:
            agent.update(provider="", model="", reasoning_effort=None)
            changed = True
        strategy = agent.get("model_strategy")
        if isinstance(strategy, dict):
            models = strategy.get("allowed_models") or []
            kept = [model for model in models if not isinstance(model, dict) or route(model) not in disabled]
            if kept != models:
                strategy["allowed_models"] = kept
                changed = True
        team = agent.get("team")
        temporary = team.get("temporary") if isinstance(team, dict) else None
        if isinstance(temporary, dict):
            models = temporary.get("models") or []
            kept = [model for model in models if not isinstance(model, dict) or route(model) not in disabled]
            if kept != models:
                temporary["models"] = kept
                changed = True
        if changed:
            affected.append({"id": str(agent.get("id") or ""), "name": str(agent.get("name") or agent.get("id") or "")})
    revision = hashlib.sha256(json.dumps([agents, sorted(disabled)], sort_keys=True, ensure_ascii=False).encode()).hexdigest()
    return result, affected, revision
