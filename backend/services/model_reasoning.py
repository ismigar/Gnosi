"""Provider-declared reasoning choices and profile-scoped request settings."""

from __future__ import annotations

import json
import threading
import time
from pathlib import Path
from typing import Any, Mapping

EFFORTS = ("none", "minimal", "low", "medium", "high", "xhigh", "max")
_URL = "https://openrouter.ai/api/v1/models"
_TTL = 3600
_lock = threading.Lock()
_cached: dict[str, dict[str, Any]] | None = None
_checked_at = 0.0

# Offline fallback verified against the provider's exact model id on 2026-09-27.
# Live declarations (including an absent supported_efforts) always take priority.
_VERIFIED = {
    "openai/gpt-6-luna": {
        "supported_efforts": ["none", "low", "medium", "high", "xhigh", "max"],
        "default_effort": "medium", "source": "verified_snapshot",
    },
}


def _cache_path() -> Path | None:
    from backend.agent.model_catalog import _cache_path as catalog_cache_path
    path = catalog_cache_path()
    return path.with_name("model_reasoning.json") if path else None


def parse_openrouter_models(payload: Any) -> dict[str, dict[str, Any]]:
    """Missing effort metadata is not permission to offer every level."""
    if not isinstance(payload, dict) or not isinstance(payload.get("data"), list):
        raise ValueError("Invalid OpenRouter model metadata")
    result = {}
    for row in payload["data"]:
        if not isinstance(row, dict) or not isinstance(row.get("id"), str):
            continue
        reasoning = row.get("reasoning")
        reasoning = reasoning if isinstance(reasoning, dict) else {}
        raw = reasoning.get("supported_efforts", [])
        allowed = EFFORTS if raw is None else raw if isinstance(raw, list) else []
        efforts = [value for value in EFFORTS if value in allowed
                   and not (value == "none" and reasoning.get("mandatory") is True)]
        default = reasoning.get("default_effort")
        result[row["id"]] = {
            "supported_efforts": efforts,
            "default_effort": default if default in efforts else None,
            "source": "openrouter",
        }
    return result


def _openrouter_options() -> dict[str, dict[str, Any]]:
    global _cached, _checked_at
    with _lock:
        if _cached is not None and time.monotonic() - _checked_at < _TTL:
            return _cached
        path = _cache_path()
        if _cached is None and path:
            try:
                _cached = parse_openrouter_models(json.loads(path.read_text(encoding="utf-8")))
            except (OSError, ValueError):
                pass
        try:
            import requests
            response = requests.get(_URL, timeout=4)
            response.raise_for_status()
            payload = response.json()
            _cached = parse_openrouter_models(payload)
            if path:
                from backend.utils.safe_io import safe_write_text
                # Store only capability declarations, never credentials or prompts.
                compact = {"data": [{"id": row["id"], "reasoning": row.get("reasoning")}
                                    for row in payload["data"] if isinstance(row, dict) and isinstance(row.get("id"), str)]}
                safe_write_text(path, json.dumps(compact))
        except (ValueError, OSError, requests.RequestException):
            # Keep the last verified metadata when offline; never invent options.
            if _cached is None:
                _cached = dict(_VERIFIED)
        _checked_at = time.monotonic()
        return _cached


def reasoning_options(provider: str, model: str) -> dict[str, Any]:
    options = _openrouter_options().get(model) if provider == "openrouter" else None
    return dict(options or {"supported_efforts": [], "default_effort": None,
                            "source": "unavailable"})


def validate_agent_reasoning(agents: list[dict[str, Any]]) -> None:
    for agent in agents:
        effort = agent.get("reasoning_effort")
        if effort is None or effort == "":
            continue
        choices = reasoning_options(str(agent.get("provider") or ""),
                                    str(agent.get("model") or ""))
        if not isinstance(effort, str) or effort not in choices["supported_efforts"]:
            raise ValueError(f"Unsupported reasoning effort for agent {agent.get('id', '')}")


def agent_reasoning_kwargs(agent: Mapping[str, Any], provider: str, model: str | None) -> dict[str, Any]:
    """Never carry a profile's effort onto a different manual/adaptive route."""
    effort = agent.get("reasoning_effort")
    if (effort and provider == agent.get("provider") and model == agent.get("model")):
        return {"reasoning_effort": effort}
    return {}


def reasoning_client_kwargs(provider: str, model: str | None, effort: str | None) -> dict[str, Any]:
    if not effort and not (provider == "openrouter" and model == "openai/gpt-6-luna"):
        return {}
    if provider != "openrouter" or (effort and effort not in EFFORTS):
        raise ValueError("Unsupported reasoning provider or effort")
    # Luna needs Responses for reasoning with tools. OpenRouter's endpoint is
    # stateless: carry the full tool history and encrypted reasoning each turn.
    return {"use_responses_api": True, "use_previous_response_id": False,
            **({"reasoning": {"effort": effort}} if effort else {}), "store": False,
            "include": ["reasoning.encrypted_content"]}
