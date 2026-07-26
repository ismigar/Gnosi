"""Artificial Analysis model-comparison feed.

The official Data API is fetched server-side so its key is never exposed to
the browser. The Free endpoint is paginated; every page is required because a
single page is only a partial model list.
"""

from __future__ import annotations

from bisect import bisect_left, bisect_right
import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

import requests

from backend.agent.model_catalog import load_catalog


ARTIFICIAL_ANALYSIS_URL = (
    "https://artificialanalysis.ai/api/v2/language/models/free"
)
_TIMEOUT_SECONDS = 12
_CACHE_MAX_AGE_SECONDS = 24 * 3600
_FALLBACK_CODES = {"rate_limited", "network_error", "upstream_error"}
_PROFILE_PERCENTILE_CEILINGS = (
    ("worker", 0.2),
    ("administrative", 0.4),
    ("documentalist", 0.6),
    ("allrounder", 0.8),
)


def _cache_path() -> Optional[Path]:
    """Return a local cache path outside the vault and OneDrive."""
    try:
        from backend.config.app_config import load_params

        paths = load_params(strict_env=False).paths
        base = paths.get("LOCAL_CACHE") or paths.get("LOCAL_DATA")
    except Exception:
        base = None
    root = Path(base) if base else Path.home() / ".cache" / "gnosi"
    if root.name != "cache":
        root = root / "cache"
    try:
        root.mkdir(parents=True, exist_ok=True)
    except OSError:
        return None
    return root / "artificial_analysis_comparison.json"


def _read_cache() -> Optional[Dict[str, Any]]:
    path = _cache_path()
    try:
        payload = json.loads(path.read_text(encoding="utf-8")) if path else None
    except (OSError, ValueError, TypeError):
        return None
    return payload if isinstance(payload, dict) and payload.get("models") else None


def _write_cache(payload: Dict[str, Any]) -> None:
    path = _cache_path()
    if not path:
        return
    try:
        path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    except OSError:
        return


def _cache_is_fresh(
    payload: Dict[str, Any],
    *,
    now: Optional[datetime] = None,
) -> bool:
    """Return whether a complete cached feed is recent enough to reuse."""
    raw_fetched_at = payload.get("fetched_at")
    if not raw_fetched_at:
        return False
    try:
        fetched_at = datetime.fromisoformat(
            str(raw_fetched_at).replace("Z", "+00:00")
        )
    except ValueError:
        return False
    if fetched_at.tzinfo is None:
        fetched_at = fetched_at.replace(tzinfo=timezone.utc)
    current = now or datetime.now(timezone.utc)
    return (current - fetched_at).total_seconds() <= _CACHE_MAX_AGE_SECONDS


class ArtificialAnalysisError(RuntimeError):
    """Structured upstream failure safe to map to a localized UI state."""

    def __init__(
        self,
        code: str,
        status_code: int = 502,
        *,
        retry_at: Optional[str] = None,
    ) -> None:
        super().__init__(code)
        self.code = code
        self.status_code = status_code
        self.retry_at = retry_at


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


def _intelligence_percentile(
    intelligence: float,
    ordered_intelligence: List[float],
) -> float:
    """Return a stable zero-to-one percentile, assigning ties to one band."""
    if len(ordered_intelligence) == 1:
        return 1.0
    lower = bisect_left(ordered_intelligence, intelligence)
    upper = bisect_right(ordered_intelligence, intelligence)
    midpoint = (lower + upper - 1) / 2
    return midpoint / (len(ordered_intelligence) - 1)


def _recommended_profile(
    model: Dict[str, Any],
    ordered_intelligence: List[float],
) -> str:
    """Assign one closed task-profile band from benchmark percentile."""
    intelligence = model.get("intelligence")
    if intelligence is None or not ordered_intelligence:
        return "unrated"
    percentile = _intelligence_percentile(intelligence, ordered_intelligence)
    for profile, ceiling in _PROFILE_PERCENTILE_CEILINGS:
        if percentile < ceiling:
            return profile
    return "expert"


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

    intelligence_values = sorted(
        model["intelligence"] for model in models if model["intelligence"] is not None
    )
    for model in models:
        model["profile"] = _recommended_profile(model, intelligence_values)

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


def build_catalog_fallback_payload(catalog: Dict[str, Any], reason: str) -> Dict[str, Any]:
    """Build an explicitly attributed comparison feed from models.dev metadata."""
    rows: List[Dict[str, Any]] = []
    seen = set()
    for provider in catalog.get("providers") or []:
        for model in provider.get("models") or []:
            key = _normalize_name(str(model.get("id") or model.get("name") or ""))
            if not key or key in seen:
                continue
            seen.add(key)
            rows.append({
                "id": str(model.get("id") or model.get("name") or ""),
                "slug": str(model.get("id") or ""),
                "name": str(model.get("name") or model.get("id") or ""),
                "release_date": model.get("release_date") or "",
                "context_window_tokens": int(model.get("context_window") or 0),
                "model_creator": {"name": str(provider.get("name") or "")},
                "pricing": {
                    "price_1m_input_tokens": model.get("cost_in"),
                    "price_1m_output_tokens": model.get("cost_out"),
                },
            })
    payload = build_comparison_payload(rows, catalog)
    payload.update({
        "source": "models.dev",
        "source_url": "https://models.dev",
        "fallback": True,
        "fallback_reason": reason,
    })
    return payload


def _fallback_payload(error: ArtificialAnalysisError) -> Dict[str, Any]:
    cached = _read_cache()
    if cached:
        return {
            **cached,
            "fallback": True,
            "fallback_reason": error.code,
            "stale": True,
        }
    if error.code not in _FALLBACK_CODES:
        raise error
    catalog = load_catalog(force_refresh=False)
    payload = build_catalog_fallback_payload(catalog, error.code)
    if error.retry_at:
        payload["retry_at"] = error.retry_at
    return payload


def fetch_all_models() -> Dict[str, Any]:
    """Fetch every page from Artificial Analysis and build the comparison feed."""
    cached = _read_cache()
    if cached and _cache_is_fresh(cached):
        return cached

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
        return _fallback_payload(ArtificialAnalysisError("api_key_missing", 503))

    rows: List[Dict[str, Any]] = []
    page = 1
    index_version = None
    session = requests.Session()
    try:
        while True:
            response = session.get(
                ARTIFICIAL_ANALYSIS_URL,
                headers={"x-api-key": api_key},
                params={"page": page},
                timeout=_TIMEOUT_SECONDS,
            )
            if response.status_code == 401:
                raise ArtificialAnalysisError("api_key_invalid", 401)
            if response.status_code == 403:
                raise ArtificialAnalysisError("tier_forbidden", 403)
            if response.status_code == 429:
                reset_value = getattr(response, "headers", {}).get(
                    "X-Ratelimit-Reset"
                )
                try:
                    retry_at = datetime.fromtimestamp(
                        float(reset_value),
                        timezone.utc,
                    ).isoformat(timespec="seconds")
                except (TypeError, ValueError, OSError):
                    retry_at = None
                raise ArtificialAnalysisError(
                    "rate_limited",
                    429,
                    retry_at=retry_at,
                )
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
    except requests.RequestException as exc:
        return _fallback_payload(ArtificialAnalysisError("network_error", 502))
    except ArtificialAnalysisError as exc:
        return _fallback_payload(exc)

    # Artificial Analysis is authoritative for benchmark/pricing/performance.
    # models.dev only fills fields omitted by the Free API.
    catalog = load_catalog(force_refresh=True)
    result = build_comparison_payload(
        rows,
        catalog,
        intelligence_index_version=index_version,
    )
    _write_cache(result)
    return result
