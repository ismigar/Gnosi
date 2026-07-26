"""Artificial Analysis model-comparison feed.

The official Data API is fetched server-side so its key is never exposed to
the browser. The Free endpoint is paginated; every page is required because a
single page is only a partial model list.
"""

from __future__ import annotations

import os
import re
from datetime import datetime, timezone
from statistics import median
from typing import Any, Dict, Iterable, List, Optional

import requests

from backend.agent.model_catalog import load_catalog


ARTIFICIAL_ANALYSIS_URL = (
    "https://artificialanalysis.ai/api/v2/language/models/free"
)
_TIMEOUT_SECONDS = 12


class ArtificialAnalysisError(RuntimeError):
    """Structured upstream failure safe to map to a localized UI state."""

    def __init__(self, code: str, status_code: int = 502) -> None:
        super().__init__(code)
        self.code = code
        self.status_code = status_code


def _number(value: Any) -> Optional[float]:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result


def _normalize_name(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", (value or "").lower())


def _catalog_enrichment_index(catalog: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
    """Index metadata and usable router routes by normalized model id/name."""
    index: Dict[str, Dict[str, Any]] = {}
    for provider in catalog.get("providers") or []:
        for model in provider.get("models") or []:
            candidate = {
                "context_window": int(model.get("context_window") or 0),
                "tags": list(model.get("tags") or []),
                "release_date": model.get("release_date") or "",
            }
            route = {
                "provider": str(provider.get("id") or ""),
                "provider_name": str(provider.get("name") or provider.get("id") or ""),
                "model_id": str(model.get("id") or ""),
                "model_name": str(model.get("name") or model.get("id") or ""),
                "is_local": bool(provider.get("is_local")),
                "cost_in": _number(model.get("cost_in")) or 0,
                "cost_out": _number(model.get("cost_out")) or 0,
                "context_window": int(model.get("context_window") or 8192),
                "quality": int(model.get("quality") or 2),
                "tags": list(model.get("tags") or []),
            }
            for raw_key in (model.get("id"), model.get("name")):
                key = _normalize_name(str(raw_key or ""))
                if not key:
                    continue
                current = index.get(key)
                if current is None:
                    current = {**candidate, "routes": []}
                    index[key] = current
                elif candidate["context_window"] > current["context_window"]:
                    current.update(candidate)
                route_key = (route["provider"], route["model_id"])
                if route["provider"] and route["model_id"] and not any(
                    (item["provider"], item["model_id"]) == route_key
                    for item in current["routes"]
                ):
                    current["routes"].append(route)
    return index


def _percentile(values: Iterable[float], fraction: float) -> float:
    ordered = sorted(values)
    if not ordered:
        return 0
    position = min(len(ordered) - 1, round((len(ordered) - 1) * fraction))
    return ordered[position]


def _recommended_profile(
    model: Dict[str, Any],
    intelligence_frontier: float,
    intelligence_typical: float,
    speed_fast: float,
) -> str:
    intelligence = model.get("intelligence")
    context = int(model.get("context_window") or 0)
    speed = model.get("speed")
    input_price = model.get("input_price")
    output_price = model.get("output_price")
    name = (model.get("name") or "").lower()
    tags = set(model.get("tags") or [])
    reasoning = (
        "reasoning" in tags
        or any(marker in name for marker in ("reasoning", "(high)", "(max)", "xhigh", "thinking"))
    )
    blended_price = None
    if input_price is not None and output_price is not None:
        blended_price = (3 * input_price + output_price) / 4

    if intelligence is not None and (
        intelligence >= intelligence_frontier
        or (reasoning and intelligence >= intelligence_typical)
    ):
        return "expert"
    if context >= 500_000:
        return "documentalist"
    if (
        blended_price is not None
        and blended_price <= 0.25
        and (intelligence is None or intelligence < intelligence_typical)
    ):
        return "worker"
    if (
        blended_price is not None
        and blended_price <= 1.5
        and speed is not None
        and speed >= speed_fast
    ):
        return "administrative"
    return "allrounder"


def build_comparison_payload(
    rows: List[Dict[str, Any]],
    catalog: Optional[Dict[str, Any]] = None,
    *,
    intelligence_index_version: Any = None,
) -> Dict[str, Any]:
    """Normalize API rows, enrich known metadata, and assign one recommended role."""
    enrichment = _catalog_enrichment_index(catalog or {})
    models: List[Dict[str, Any]] = []

    for row in rows:
        pricing = row.get("pricing") or {}
        performance = row.get("performance") or {}
        evaluations = row.get("evaluations") or {}
        creator = row.get("model_creator") or {}
        matched_entries = []
        for raw_key in (row.get("slug"), row.get("name")):
            entry = enrichment.get(_normalize_name(str(raw_key or "")))
            if entry is not None and entry not in matched_entries:
                matched_entries.append(entry)
        match = max(
            matched_entries,
            key=lambda item: item.get("context_window") or 0,
            default={},
        )
        routes = []
        route_keys = set()
        for entry in matched_entries:
            for route in entry.get("routes") or []:
                route_key = (route.get("provider"), route.get("model_id"))
                if route_key not in route_keys:
                    route_keys.add(route_key)
                    routes.append(route)
        context_window = int(row.get("context_window_tokens") or match.get("context_window") or 0)
        models.append({
            "id": str(row.get("id") or row.get("slug") or row.get("name") or ""),
            "slug": str(row.get("slug") or ""),
            "name": str(row.get("name") or row.get("slug") or ""),
            "creator": str(creator.get("name") or ""),
            "release_date": row.get("release_date") or match.get("release_date") or "",
            "input_price": _number(pricing.get("price_1m_input_tokens")),
            "output_price": _number(pricing.get("price_1m_output_tokens")),
            "context_window": context_window or None,
            "speed": _number(performance.get("median_output_tokens_per_second")),
            "latency": _number(performance.get("median_time_to_first_token_seconds")),
            "end_to_end": _number(performance.get("median_end_to_end_response_time_seconds")),
            "intelligence": _number(evaluations.get("artificial_analysis_intelligence_index")),
            "coding": _number(evaluations.get("artificial_analysis_coding_index")),
            "agentic": _number(evaluations.get("artificial_analysis_agentic_index")),
            "tags": list(match.get("tags") or []),
            "routes": routes,
        })

    intelligence_values = [
        model["intelligence"] for model in models if model["intelligence"] is not None
    ]
    speed_values = [model["speed"] for model in models if model["speed"] is not None]
    frontier = _percentile(intelligence_values, 0.8)
    typical = median(intelligence_values) if intelligence_values else 0
    fast = _percentile(speed_values, 0.65)
    for model in models:
        model["profile"] = _recommended_profile(model, frontier, typical, fast)

    models.sort(key=lambda model: (
        model["intelligence"] is not None,
        model["intelligence"] or -1,
        model["release_date"],
    ), reverse=True)
    return {
        "source": "Artificial Analysis",
        "source_url": "https://artificialanalysis.ai",
        "fetched_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "intelligence_index_version": intelligence_index_version,
        "count": len(models),
        "models": models,
    }


def fetch_all_models() -> Dict[str, Any]:
    """Fetch every page from Artificial Analysis and build the comparison feed."""
    api_key = (
        os.getenv("ARTIFICIAL_ANALYSIS_API_KEY")
        or os.getenv("AA_API_KEY")
        or ""
    ).strip()
    if not api_key:
        try:
            from backend.config.app_config import load_params
            from backend.security.ai_credentials import resolve_provider_api_key

            ai_config = dict(load_params(strict_env=False).get("ai", {}) or {})
            provider_config = dict(
                (ai_config.get("providers") or {}).get("artificial_analysis") or {}
            )
            api_key = (
                resolve_provider_api_key("artificial_analysis", provider_config)
                or ""
            ).strip()
        except Exception:
            api_key = ""
    if not api_key:
        raise ArtificialAnalysisError("api_key_missing", 503)

    rows: List[Dict[str, Any]] = []
    page = 1
    index_version = None
    session = requests.Session()
    while True:
        try:
            response = session.get(
                ARTIFICIAL_ANALYSIS_URL,
                headers={"x-api-key": api_key},
                params={"page": page},
                timeout=_TIMEOUT_SECONDS,
            )
        except requests.RequestException as exc:
            raise ArtificialAnalysisError("network_error", 502) from exc

        if response.status_code == 401:
            raise ArtificialAnalysisError("api_key_invalid", 401)
        if response.status_code == 403:
            raise ArtificialAnalysisError("tier_forbidden", 403)
        if response.status_code == 429:
            raise ArtificialAnalysisError("rate_limited", 429)
        if not response.ok:
            raise ArtificialAnalysisError("upstream_error", 502)
        try:
            payload = response.json()
        except ValueError as exc:
            raise ArtificialAnalysisError("invalid_response", 502) from exc

        data = payload.get("data")
        if not isinstance(data, list):
            raise ArtificialAnalysisError("invalid_response", 502)
        rows.extend(data)
        index_version = payload.get("intelligence_index_version", index_version)
        pagination = payload.get("pagination") or {}
        if not pagination.get("has_more"):
            break
        page += 1
        if page > int(pagination.get("total_pages") or page):
            break

    # Artificial Analysis is authoritative for benchmark/pricing/performance.
    # models.dev only fills fields omitted by the Free API.
    catalog = load_catalog(force_refresh=True)
    return build_comparison_payload(
        rows,
        catalog,
        intelligence_index_version=index_version,
    )
