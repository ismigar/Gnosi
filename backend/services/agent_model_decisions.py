"""Optional decision adapters. They advise; Gnosi owns the allowed routes."""

from __future__ import annotations

from backend.services.agent_behavior import resource as behavior_resource

import json
import math
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Callable, Mapping, TypeGuard

import httpx

from backend.agent.model_router import UsageStore
from backend.security.ai_credentials import resolve_provider_api_key

JEV_ENDPOINT = "https://api.typesafe.ai/v1/systemone"
JEV_MODEL = "jev-latest"
# TypeSafe's published tariff, verified 2026-09-23. Outputs are currently free.
JEV_INPUT_USD_PER_MILLION = 0.042
MAX_REQUEST_CHARS = 12_000
MIN_CONFIDENCE = 0.75


@dataclass(frozen=True)
class ModelDecision:
    route: str | None = None
    confidence: float | None = None
    status: str = "unavailable"


DecisionSelector = Callable[[str, list[dict[str, Any]]], ModelDecision]


def _probability(value: Any) -> TypeGuard[float]:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and (
        math.isfinite(value) and 0 <= value <= 1
    )


def parse_jev_decision(payload: Mapping[str, Any], routes: list[str]) -> ModelDecision:
    """Treat provider output as untrusted, including confidence and choice ids."""
    answers = payload.get("answers")
    answer = answers.get("route") if isinstance(answers, dict) else None
    if not isinstance(answer, dict) or answer.get("type") != "choice":
        return ModelDecision(status="invalid_response")
    probabilities = answer.get("probabilities")
    choice, confidence = answer.get("choice"), answer.get("confidence")
    ids = [f"m{index}" for index in range(len(routes))]
    if not isinstance(probabilities, dict) or set(probabilities) != set(ids):
        return ModelDecision(status="invalid_response")
    if choice not in ids or not _probability(confidence):
        return ModelDecision(status="invalid_response")
    if not all(_probability(value) for value in probabilities.values()):
        return ModelDecision(status="invalid_response")
    if abs(sum(probabilities.values()) - 1) > 0.02:
        return ModelDecision(status="invalid_response")
    if probabilities[choice] != max(probabilities.values()):
        return ModelDecision(status="invalid_response")
    if confidence < MIN_CONFIDENCE or probabilities[choice] < MIN_CONFIDENCE:
        return ModelDecision(confidence=confidence, status="low_confidence")
    return ModelDecision(routes[ids.index(choice)], confidence, "selected")


def _record_usage(payload: Mapping[str, Any], estimated_tokens: int) -> None:
    usage = payload.get("usage")
    usage = usage if isinstance(usage, dict) else {}
    in_tokens = usage.get("input_tokens", estimated_tokens)
    out_tokens = usage.get("output_tokens", 0)
    if not isinstance(in_tokens, int) or isinstance(in_tokens, bool) or in_tokens < 0:
        in_tokens = estimated_tokens
    if not isinstance(out_tokens, int) or isinstance(out_tokens, bool) or out_tokens < 0:
        out_tokens = 0
    UsageStore().record(
        "typesafe", JEV_MODEL, in_tokens, out_tokens,
        datetime.now().strftime("%Y-%m"),
        cost_usd=in_tokens * JEV_INPUT_USD_PER_MILLION / 1_000_000,
    )


def _request_jev(api_key: str, body: dict[str, Any]) -> Any:
    with httpx.Client(timeout=3.0, follow_redirects=False) as client:
        with client.stream("POST", JEV_ENDPOINT, headers={"Authorization": f"Bearer {api_key}"}, json=body) as response:
            response.raise_for_status()
            content = bytearray()
            for chunk in response.iter_bytes():
                content.extend(chunk)
                if len(content) > 65_536:
                    raise ValueError("Decision response exceeds limit")
            return json.loads(content)


def decide_with_jev(
    message: str, candidates: list[dict[str, Any]],
    *, provider_config: Mapping[str, Any], budget: Mapping[str, Any],
) -> ModelDecision:
    """One bounded call, no redirects or retries, no memory or attached sources."""
    if provider_config.get("enabled", True) is False:
        return ModelDecision(status="disabled")
    api_key = resolve_provider_api_key("typesafe", provider_config)
    if not api_key:
        return ModelDecision(status="missing_credentials")
    routes = [f"{row['provider']}:{row['model_id']}" for row in candidates]
    criteria = {
        f"m{index}": {
            "model": route,
            "quality": row.get("quality", 2),
            "capabilities": row.get("tags") or [],
            "input_cost_per_million": row.get("cost_in"),
            "output_cost_per_million": row.get("cost_out"),
        }
        for index, (route, row) in enumerate(zip(routes, candidates))
    }
    body = {
        "model": JEV_MODEL,
        "state": {
            "request": message[:MAX_REQUEST_CHARS],
            "request_characters": len(message),
            "truncated": len(message) > MAX_REQUEST_CHARS,
        },
        "questions": {"route": {
            "type": "choice",
            "instructions": (
                behavior_resource('system/model-selection-1.md')
            ),
            "criteria": criteria,
        }},
    }
    # UTF-8 bytes are a conservative token estimate, also covering the criteria.
    estimated_tokens = len(json.dumps(body, ensure_ascii=False).encode("utf-8"))
    cap = budget.get("cost_cap_usd")
    estimated_cost = estimated_tokens * JEV_INPUT_USD_PER_MILLION / 1_000_000
    if cap is not None and float(budget.get("spent_usd") or 0) + estimated_cost >= float(cap):
        return ModelDecision(status="budget_limit")
    from backend.services.agent_execution import reserve_decision_call

    if not reserve_decision_call():
        return ModelDecision(status="budget_limit")
    from backend.services.agent_execution_trace import record
    record("selector.request", {"provider": "typesafe", "body": body, "provider_internal_visibility": False})
    try:
        payload = _request_jev(api_key, body)
        record("selector.response", payload)
        if not isinstance(payload, dict):
            _record_usage({}, estimated_tokens)
            return ModelDecision(status="invalid_response")
        _record_usage(payload, estimated_tokens)
        return parse_jev_decision(payload, routes)
    except httpx.TimeoutException:
        # A timeout may already have been billed. Reserve the estimated usage.
        _record_usage({}, estimated_tokens)
        return ModelDecision(status="timeout")
    except ValueError:
        _record_usage({}, estimated_tokens)
        return ModelDecision(status="invalid_response")
    except httpx.HTTPError:
        return ModelDecision(status="unavailable")


def decision_selector(
    engine: str, providers: Mapping[str, Any], budget: Mapping[str, Any],
    *, disconnected: list[str],
) -> DecisionSelector | None:
    """Adapter boundary: new decision providers do not change the agent or policy."""
    if engine != "jev":
        return None
    config = providers.get("typesafe") or {}
    config = dict(config) if isinstance(config, Mapping) else {}
    if "typesafe" in disconnected:
        config["enabled"] = False
    return lambda message, candidates: decide_with_jev(
        message, candidates, provider_config=config, budget=budget,
    )
