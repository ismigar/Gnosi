"""Artificial Analysis model-comparison feed.

The official Data API is fetched server-side so its key is never exposed to
the browser. The Free endpoint is paginated; every page is required because a
single page is only a partial model list.
"""

from __future__ import annotations

from bisect import bisect_left, bisect_right
import json
import math
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

import requests

from backend.agent.model_catalog import load_catalog


ARTIFICIAL_ANALYSIS_URL = "https://artificialanalysis.ai/api/v2/language/models/free"
_TIMEOUT_SECONDS = 12
_CACHE_MAX_AGE_SECONDS = 24 * 3600
_FALLBACK_CODES = {"rate_limited", "network_error", "upstream_error"}
_PROFILE_PERCENTILE_CEILINGS = (
    ("worker", 0.2),
    ("administrative", 0.4),
    ("documentalist", 0.6),
    ("allrounder", 0.8),
)
_PRESERVED_METRIC_FIELDS = (
    "input_price",
    "output_price",
    "context_window",
    "speed",
    "latency",
    "intelligence",
    "coding",
    "agentic",
)
_SUPPORTED_MODES = {"text", "image", "audio", "video"}


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
        fetched_at = datetime.fromisoformat(str(raw_fetched_at).replace("Z", "+00:00"))
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
    """Coerce to float, rejecting non-finite or negative sentinels.

    NaN/Infinity (Python's json reads the bare ``NaN``/``Infinity`` literals)
    and negative values are treated as missing so the models.dev fallback can
    engage instead of rendering ``$NaN`` or ``$-5``. Zero is preserved because
    genuinely free models report a real price of 0.
    """
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(result) or result < 0:
        return None
    return result


def _normalize_name(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", (value or "").lower())


def _supported_modes(*values: Any) -> List[str]:
    """Normalize modality lists, defaulting language-comparison rows to text."""
    modes = {
        str(mode).lower()
        for value in values
        for mode in (value or [])
        if str(mode).lower() in _SUPPORTED_MODES
    }
    return sorted(modes or {"text"})


def _catalog_enrichment_index(catalog: Dict[str, Any]) -> Dict[str, List[Dict[str, Any]]]:
    """Index metadata and usable router routes by normalized model id/name.

    Each normalized name maps to a list of per-provider entries (a model can be
    listed by its canonical host and several resellers). Keeping entries separate
    — instead of collapsing them by max context_window — lets the caller pick the
    canonical host when the AA model creator is known, avoiding enrichment from a
    third-party whose pricing/window may differ.
    """
    index: Dict[str, List[Dict[str, Any]]] = {}
    for provider in catalog.get("providers") or []:
        for model in provider.get("models") or []:
            provider_id = str(provider.get("id") or "")
            entry = {
                "provider_id": provider_id,
                "context_window": int(model.get("context_window") or 0),
                "input_price": _number(model.get("cost_in")),
                "output_price": _number(model.get("cost_out")),
                "tags": list(model.get("tags") or []),
                "modes": _supported_modes(model.get("modes")),
                "release_date": model.get("release_date") or "",
                "routes": [],
            }
            route = {
                "provider": provider_id,
                "provider_name": str(provider.get("name") or provider_id),
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
                bucket = index.setdefault(key, [])
                existing = next(
                    (item for item in bucket if item["provider_id"] == provider_id),
                    None,
                )
                if existing is None:
                    bucket.append(entry)
                    existing = entry
                if (
                    route["provider"]
                    and route["model_id"]
                    and not any(
                        (item["provider"], item["model_id"])
                        == (route["provider"], route["model_id"])
                        for item in existing["routes"]
                    )
                ):
                    existing["routes"].append(route)
    return index


def _provider_matches_creator(provider_id: str, creator: str) -> bool:
    """Return True when a catalog provider id plausibly owns the AA creator.

    Used to avoid matching a model against a third-party host's catalog entry
    (e.g. AA creator "Anthropic" should not enrich from DigitalOcean's listing).
    Comparison is normalized; "anthropic" matches both "Anthropic" and the
    common alias "anthropic" while "mistral" matches "mistralai".
    """
    provider = _normalize_name(provider_id)
    owner = _normalize_name(creator)
    if not provider or not owner:
        return False
    return owner == provider or provider.startswith(owner) or owner in provider


# Suffixes Artificial Analysis appends to model slugs that models.dev catalog
# usually lists under the bare base name. Stripped iteratively so composite
# suffixes (e.g. "deepseek-v4-flash-0420-high") reduce to the catalog entry.
_EFFORT_SUFFIX_PATTERNS = (
    re.compile(r"-(xhigh|high|medium|low|max|min|nano|mini|small|large)$", re.I),
    re.compile(r"-(adaptive|thinking|reasoning|non-reasoning|instruct|chat|base|omni)$", re.I),
    re.compile(r"-(effort|max-effort|high-effort|medium-effort|low-effort)$", re.I),
    re.compile(r"-\d{3,4}$"),  # compact date like 0420
    re.compile(r"-\d{2}-\d{2}$"),  # MM-DD
    re.compile(r"-20\d{2}-\d{2}-\d{2}$"),
    re.compile(r"-(may|jan|apr|mar|feb|jun|jul|aug|sep|oct|nov|dec)['']?2?5?$", re.I),
    re.compile(r"-(alpha|beta|exp|experimental|preview|latest|canary|stable)$", re.I),
    re.compile(r"-(minimal|maximal)$", re.I),
    re.compile(r"-(build|v\d+)$", re.I),
)


def _slug_candidate_bases(slug: str) -> List[str]:
    """Yield slug variants with known effort/variant suffixes stripped.

    The original slug is yielded first (exact match preferred), then progressively
    stripped forms. A model like ``deepseek-v4-flash-0420-high`` yields:
    ``deepseek-v4-flash-0420-high``, ``deepseek-v4-flash-0420``, ``deepseek-v4-flash``.
    Deduplication keeps the iteration bounded.
    """
    candidates: List[str] = []
    seen: set[str] = set()
    current = slug
    if current:
        candidates.append(current)
        seen.add(current)
    changed = True
    while changed:
        changed = False
        for pattern in _EFFORT_SUFFIX_PATTERNS:
            new = pattern.sub("", current)
            if new != current and new and new not in seen:
                seen.add(new)
                candidates.append(new)
                current = new
                changed = True
                break
    return candidates


def _matching_enrichment_entries(
    model: Dict[str, Any],
    enrichment: Dict[str, List[Dict[str, Any]]],
) -> List[Dict[str, Any]]:
    """Return distinct catalog entries matching a comparison model, creator first.

    The enrichment index holds one entry per provider that lists the model; this
    flattens the buckets for the matching slug/name and orders the canonical host
    (the one matching the AA creator) first so the caller can prefer it. Suffixes
    AA appends for effort/variant (e.g. ``-high``, ``-thinking``, ``-0420``) are
    stripped iteratively so a model listed under its base name still resolves.
    """
    creator_name = str((model.get("model_creator") or {}).get("name") or "")
    seen_ids: set[tuple[Any, Any]] = set()
    matches: List[Dict[str, Any]] = []
    for raw_key in (model.get("slug"), model.get("name")):
        for candidate in _slug_candidate_bases(str(raw_key or "")):
            bucket = enrichment.get(_normalize_name(candidate))
            if not bucket:
                continue
            for entry in bucket:
                entry_id = (entry.get("provider_id"), entry.get("context_window"))
                if entry_id in seen_ids:
                    continue
                seen_ids.add(entry_id)
                matches.append(entry)
    if creator_name and matches:
        matches.sort(
            key=lambda entry: (
                not _provider_matches_creator(entry.get("provider_id") or "", creator_name)
            )
        )
    return matches


def _merge_cached_metrics(
    payload: Dict[str, Any],
    cached: Optional[Dict[str, Any]],
) -> Dict[str, Any]:
    """Fill missing upstream metrics from the last successful AA payload."""
    if not cached:
        return payload
    cached_by_key = _cached_models_by_key(cached)
    for model in payload.get("models") or []:
        previous = _matching_cached_model(model, cached_by_key)
        if previous:
            _restore_cached_metrics(model, previous)
    return payload


def _cached_models_by_key(cached: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
    """Index cached rows under every stable upstream identifier."""
    cached_by_key: Dict[str, Dict[str, Any]] = {}
    for model in cached.get("models") or []:
        for raw_key in (model.get("id"), model.get("slug"), model.get("name")):
            key = _normalize_name(str(raw_key or ""))
            if key:
                cached_by_key.setdefault(key, model)
    return cached_by_key


def _matching_cached_model(
    model: Dict[str, Any],
    cached_by_key: Dict[str, Dict[str, Any]],
) -> Optional[Dict[str, Any]]:
    """Find the first cached row matching a normalized identifier."""
    for raw_key in (model.get("id"), model.get("slug"), model.get("name")):
        previous = cached_by_key.get(_normalize_name(str(raw_key or "")))
        if previous:
            return previous
    return None


def _restore_cached_metrics(
    model: Dict[str, Any],
    previous: Dict[str, Any],
) -> None:
    """Restore only metrics omitted by the latest upstream response."""
    metric_sources = dict(model.get("metric_sources") or {})
    for field in _PRESERVED_METRIC_FIELDS:
        if model.get(field) is None and previous.get(field) is not None:
            model[field] = previous[field]
            metric_sources[field] = "artificial_analysis_cache"
    if metric_sources:
        model["metric_sources"] = metric_sources


def _enrich_cached_payload(
    payload: Dict[str, Any],
    catalog: Dict[str, Any],
) -> Dict[str, Any]:
    """Backfill verifiable catalog metadata in an already normalized cache."""
    enrichment = _catalog_enrichment_index(catalog)
    for model in payload.get("models") or []:
        matches = _matching_enrichment_entries(model, enrichment)
        match = max(
            matches,
            key=lambda item: item.get("context_window") or 0,
            default={},
        )
        metric_sources = dict(model.get("metric_sources") or {})
        for field in ("input_price", "output_price", "context_window"):
            if model.get(field) is None and match.get(field) is not None:
                model[field] = match[field]
                metric_sources[field] = "models_dev"
        if model.get("modes") or match.get("modes"):
            model["modes"] = _supported_modes(model.get("modes"), match.get("modes"))
        if metric_sources:
            model["metric_sources"] = metric_sources
    return payload


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
    if intelligence is not None and ordered_intelligence:
        percentile = _intelligence_percentile(intelligence, ordered_intelligence)
        for profile, ceiling in _PROFILE_PERCENTILE_CEILINGS:
            if percentile < ceiling:
                return profile
        return "expert"

    coding_profile = _profile_from_coding(model.get("coding"))
    if coding_profile is not None:
        return coding_profile
    return _profile_from_tags(set(model.get("tags") or []))


def _profile_from_coding(coding: Any) -> Optional[str]:
    """Map a coding benchmark to its legacy task band."""
    if coding is None:
        return None
    if coding > 70:
        return "expert"
    if coding > 50:
        return "allrounder"
    if coding > 30:
        return "administrative"
    return "worker"


def _profile_from_tags(tags: set[str]) -> str:
    """Fall back to catalog capabilities when no benchmark is available."""
    if "code" in tags:
        return "expert"
    if "long" in tags or "vision" in tags or "tools" in tags:
        return "allrounder"
    if "fast" in tags:
        return "worker"

    return "unrated"


def _routes_for_entries(entries: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Collect unique usable routes from all matching catalog providers."""
    routes: List[Dict[str, Any]] = []
    route_keys: set[tuple[Any, Any]] = set()
    for entry in entries:
        for route in entry.get("routes") or []:
            route_key = (route.get("provider"), route.get("model_id"))
            if route_key not in route_keys:
                route_keys.add(route_key)
                routes.append(route)
    return routes


def _normalized_comparison_model(
    row: Dict[str, Any],
    enrichment: Dict[str, List[Dict[str, Any]]],
) -> Dict[str, Any]:
    """Normalize one authoritative row and apply catalog-only fallbacks."""
    pricing = row.get("pricing") or {}
    performance = row.get("performance") or {}
    evaluations = row.get("evaluations") or {}
    creator = row.get("model_creator") or {}
    creator_name = str(creator.get("name") or "")
    matched_entries = _matching_enrichment_entries(row, enrichment)
    match = max(
        matched_entries,
        key=lambda item: (
            _provider_matches_creator(item.get("provider_id") or "", creator_name),
            item.get("context_window") or 0,
        ),
        default={},
    )
    input_price = _number(pricing.get("price_1m_input_tokens"))
    output_price = _number(pricing.get("price_1m_output_tokens"))
    metric_sources: Dict[str, str] = {}
    if input_price is None and match.get("input_price") is not None:
        input_price = match["input_price"]
        metric_sources["input_price"] = "models_dev"
    if output_price is None and match.get("output_price") is not None:
        output_price = match["output_price"]
        metric_sources["output_price"] = "models_dev"
    if not row.get("context_window_tokens") and match.get("context_window"):
        metric_sources["context_window"] = "models_dev"
    context_window = int(row.get("context_window_tokens") or match.get("context_window") or 0)
    model = {
        "id": str(row.get("id") or row.get("slug") or row.get("name") or ""),
        "slug": str(row.get("slug") or ""),
        "name": str(row.get("name") or row.get("slug") or ""),
        "creator": creator_name,
        "release_date": row.get("release_date") or match.get("release_date") or "",
        "input_price": input_price,
        "output_price": output_price,
        "context_window": context_window or None,
        "speed": _number(performance.get("median_output_tokens_per_second")),
        "latency": _number(performance.get("median_time_to_first_token_seconds")),
        "intelligence": _number(evaluations.get("artificial_analysis_intelligence_index")),
        "coding": _number(evaluations.get("artificial_analysis_coding_index")),
        "agentic": _number(evaluations.get("artificial_analysis_agentic_index")),
        "tags": list(match.get("tags") or []),
        "modes": _supported_modes(row.get("modes"), match.get("modes")),
        "routes": _routes_for_entries(matched_entries),
    }
    if metric_sources:
        model["metric_sources"] = metric_sources
    return model


def build_comparison_payload(
    rows: List[Dict[str, Any]],
    catalog: Optional[Dict[str, Any]] = None,
    *,
    intelligence_index_version: Any = None,
) -> Dict[str, Any]:
    """Normalize API rows, enrich known metadata, and assign one recommended role."""
    enrichment = _catalog_enrichment_index(catalog or {})
    models: List[Dict[str, Any]] = []
    seen: set[str] = set()

    for row in rows:
        dedup_key = _normalize_name(str(row.get("id") or row.get("slug") or row.get("name") or ""))
        if not dedup_key or dedup_key in seen:
            continue
        seen.add(dedup_key)
        models.append(_normalized_comparison_model(row, enrichment))

    intelligence_values = sorted(
        model["intelligence"] for model in models if model["intelligence"] is not None
    )
    for model in models:
        model["profile"] = _recommended_profile(model, intelligence_values)

    models.sort(
        key=lambda model: (
            model["intelligence"] is not None,
            model["intelligence"] or -1,
            model["release_date"],
        ),
        reverse=True,
    )
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
            rows.append(
                {
                    "id": str(model.get("id") or model.get("name") or ""),
                    "slug": str(model.get("id") or ""),
                    "name": str(model.get("name") or model.get("id") or ""),
                    "release_date": model.get("release_date") or "",
                    "context_window_tokens": int(model.get("context_window") or 0),
                    "modes": list(model.get("modes") or []),
                    "model_creator": {"name": str(provider.get("name") or "")},
                    "pricing": {
                        "price_1m_input_tokens": model.get("cost_in"),
                        "price_1m_output_tokens": model.get("cost_out"),
                    },
                }
            )
    payload = build_comparison_payload(rows, catalog)
    payload.update(
        {
            "source": "models.dev",
            "source_url": "https://models.dev",
            "fallback": True,
            "fallback_reason": reason,
        }
    )
    return payload


def _fallback_payload(error: ArtificialAnalysisError) -> Dict[str, Any]:
    cached = _read_cache()
    if cached:
        cached = _enrich_cached_payload(
            cached,
            load_catalog(force_refresh=False),
        )
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


def _configured_api_key() -> str:
    """Resolve the server-side key from process or managed credentials."""
    api_key = (os.getenv("ARTIFICIAL_ANALYSIS_API_KEY") or os.getenv("AA_API_KEY") or "").strip()
    if api_key:
        return api_key
    try:
        from backend.config.app_config import load_params
        from backend.security.ai_credentials import resolve_provider_api_key

        ai_config = dict(load_params(strict_env=False).get("ai", {}) or {})
        provider_config = dict((ai_config.get("providers") or {}).get("artificial_analysis") or {})
        return (resolve_provider_api_key("artificial_analysis", provider_config) or "").strip()
    except Exception:
        return ""


def _rate_limit_retry_at(response: Any) -> Optional[str]:
    """Convert an optional upstream reset epoch to a stable UTC timestamp."""
    reset_value = getattr(response, "headers", {}).get("X-Ratelimit-Reset")
    try:
        return datetime.fromtimestamp(float(str(reset_value)), timezone.utc).isoformat(
            timespec="seconds"
        )
    except (TypeError, ValueError, OSError):
        return None


def _validated_page_payload(response: Any) -> Dict[str, Any]:
    """Validate one upstream page and map statuses to structured failures."""
    if response.status_code == 401:
        raise ArtificialAnalysisError("api_key_invalid", 401)
    if response.status_code == 403:
        raise ArtificialAnalysisError("tier_forbidden", 403)
    if response.status_code == 429:
        raise ArtificialAnalysisError(
            "rate_limited",
            429,
            retry_at=_rate_limit_retry_at(response),
        )
    if not response.ok:
        raise ArtificialAnalysisError("upstream_error", 502)
    try:
        payload = response.json()
    except ValueError as exc:
        raise ArtificialAnalysisError("invalid_response", 502) from exc
    if not isinstance(payload, dict) or not isinstance(payload.get("data"), list):
        raise ArtificialAnalysisError("invalid_response", 502)
    return payload


def _fetch_model_pages(api_key: str) -> tuple[List[Dict[str, Any]], Any]:
    """Fetch the complete paginated upstream feed."""
    rows: List[Dict[str, Any]] = []
    page = 1
    index_version = None
    session = requests.Session()
    while True:
        response = session.get(
            ARTIFICIAL_ANALYSIS_URL,
            headers={"x-api-key": api_key},
            params={"page": page},
            timeout=_TIMEOUT_SECONDS,
        )
        payload = _validated_page_payload(response)
        rows.extend(payload["data"])
        index_version = payload.get("intelligence_index_version", index_version)
        pagination = payload.get("pagination") or {}
        if not pagination.get("has_more"):
            break
        page += 1
        if page > int(pagination.get("total_pages") or page):
            break
    return rows, index_version


def fetch_all_models() -> Dict[str, Any]:
    """Fetch every page from Artificial Analysis and build the comparison feed."""
    cached = _read_cache()
    if cached and _cache_is_fresh(cached):
        return _enrich_cached_payload(
            cached,
            load_catalog(force_refresh=False),
        )

    api_key = _configured_api_key()
    if not api_key:
        return _fallback_payload(ArtificialAnalysisError("api_key_missing", 503))

    try:
        rows, index_version = _fetch_model_pages(api_key)
    except requests.RequestException:
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
    result = _merge_cached_metrics(result, cached)
    _write_cache(result)
    return result
