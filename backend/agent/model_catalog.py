"""Provider → model catalog that feeds the router registry UI.

Gives the settings UI real, up-to-date model lists with metadata (cost, context
window, capabilities) so the user picks from dropdowns instead of remembering
provider/model ids by heart (cf. `ModelRegistrySettings.jsx`).

Layered sources, most fresh wins:

1. **Remote**: https://models.dev/api.json — the open-source model database the
   OpenCode harness uses. Fetched at most once per `_CACHE_TTL` and cached on
   disk OUTSIDE the vault/OneDrive (`GNOSI_LOCAL_DATA/cache`, else
   `~/.cache/gnosi`), so offline runs keep the last snapshot.
2. **Vendored**: `backend/data/model_catalog.json`, committed to the repo and
   regenerated with `python -m backend.scripts.refresh_model_catalog`. Works
   with zero network (fresh installs, self-host Docker without egress).
3. **Live local overlay**: the models actually installed in Ollama
   (`GET /api/tags`), merged over whatever static source won.

The transform (`build_catalog`) and heuristics are PURE so they can be tested
without network (cf. memory `feedback_local_backend_test_verification`).
Costs are USD per **1M tokens** (same unit models.dev uses and the values the
router registry already stored).
"""
from __future__ import annotations

import json
import logging
import re
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

log = logging.getLogger(__name__)

MODELS_DEV_URL = "https://models.dev/api.json"
_CACHE_TTL = 24 * 3600  # refresh the remote snapshot at most once a day
_REMOTE_TIMEOUT = 8     # seconds; UI must never hang on models.dev
_OLLAMA_TIMEOUT = 1.5   # seconds; local daemon answers instantly or not at all

# models.dev provider id → Gnosi provider id (only where they differ)
_MODELS_DEV_ALIASES = {"togetherai": "together", "fireworks-ai": "fireworks"}

# Providers exposed in the router UI. Keep in sync with the ids Gnosi already
# understands (security/ai_credentials.py + agent/factory.py). Order = UI order.
CATALOG_PROVIDERS: List[str] = [
    "groq", "openai", "anthropic", "google", "mistral", "deepseek",
    "openrouter", "xai", "together", "fireworks", "perplexity", "cohere",
    "siliconflow", "ollama", "lmstudio",
]

LOCAL_PROVIDER_IDS = {"ollama", "lmstudio", "llama-cpp", "local", "generic"}

_FAST_NAME_RE = re.compile(
    r"instant|flash|mini|nano|lite|haiku|micro|tiny|small", re.IGNORECASE)
_CODE_NAME_RE = re.compile(
    r"code|coder|codex|codestral|devstral|starcoder", re.IGNORECASE)


def _infer_tags(model: Dict[str, Any]) -> List[str]:
    """Map models.dev capability fields to the router's capability tags.

    Tags are DATA matched verbatim by backend/agent/model_router.py — never
    translate them (same contract as TAG_OPTIONS in ModelRegistrySettings.jsx).
    """
    tags: List[str] = []
    name_blob = f"{model.get('id', '')} {model.get('name', '')} {model.get('family', '')}"
    cost = model.get("cost") or {}
    cost_out = float(cost.get("output") or 0)
    if _FAST_NAME_RE.search(name_blob) or 0 < cost_out <= 1.0:
        tags.append("fast")
    if _CODE_NAME_RE.search(name_blob):
        tags.append("code")
    modalities = (model.get("modalities") or {}).get("input") or []
    if model.get("attachment") or "image" in modalities:
        tags.append("vision")
    if int((model.get("limit") or {}).get("context") or 0) >= 100_000:
        tags.append("long")
    if model.get("tool_call"):
        tags.append("tools")
    if model.get("reasoning"):
        tags.append("reasoning")
    return tags


def _infer_quality(model: Dict[str, Any]) -> int:
    """Default 1..3 quality bucket from price + reasoning; user-editable in the UI."""
    cost = model.get("cost") or {}
    avg = (float(cost.get("input") or 0) + float(cost.get("output") or 0)) / 2
    quality = 3 if avg >= 4 else (2 if avg >= 0.5 else 1)
    if model.get("reasoning"):
        quality = 3 if avg >= 2 else max(quality, 2)
    return quality


def _text_output(model: Dict[str, Any]) -> bool:
    outputs = (model.get("modalities") or {}).get("output")
    return "text" in outputs if outputs else True


def build_catalog(models_dev: Dict[str, Any]) -> Dict[str, Any]:
    """Transform a raw models.dev payload into Gnosi's compact catalog (PURE)."""
    by_gnosi_id = {}
    for raw_id, provider in (models_dev or {}).items():
        gnosi_id = _MODELS_DEV_ALIASES.get(raw_id, raw_id)
        if gnosi_id in CATALOG_PROVIDERS:
            by_gnosi_id[gnosi_id] = provider

    providers: List[Dict[str, Any]] = []
    for gnosi_id in CATALOG_PROVIDERS:
        provider = by_gnosi_id.get(gnosi_id)
        if not provider:
            continue
        models = []
        for model in (provider.get("models") or {}).values():
            if not model.get("id") or not _text_output(model):
                continue
            cost = model.get("cost") or {}
            models.append({
                "id": model["id"],
                "name": model.get("name") or model["id"],
                "cost_in": round(float(cost.get("input") or 0), 4),
                "cost_out": round(float(cost.get("output") or 0), 4),
                "context_window": int((model.get("limit") or {}).get("context") or 8192),
                "tags": _infer_tags(model),
                "quality": _infer_quality(model),
                "release_date": model.get("release_date") or "",
            })
        if not models:
            continue
        models.sort(key=lambda m: (m["release_date"], m["name"]), reverse=True)
        providers.append({
            "id": gnosi_id,
            "name": provider.get("name") or gnosi_id.capitalize(),
            "is_local": gnosi_id in LOCAL_PROVIDER_IDS,
            "models": models,
        })

    return {
        "schema": 1,
        "source": "models.dev",
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "providers": providers,
    }


# ---------------------------------------------------------------------------
# Source layers: remote fetch, disk cache, vendored fallback, Ollama overlay
# ---------------------------------------------------------------------------
VENDORED_PATH = Path(__file__).resolve().parent.parent / "data" / "model_catalog.json"


def _cache_path() -> Optional[Path]:
    """Disk cache location; NEVER inside the vault/OneDrive (memory
    `feedback_cache_outside_onedrive`). Mirrors UsageStore._resolve_path."""
    base = None
    try:
        from backend.config.app_config import load_params
        base = load_params(strict_env=False).paths.get("GNOSI_LOCAL_DATA")
    except Exception:
        pass
    root = Path(base) / "cache" if base else Path.home() / ".cache" / "gnosi"
    try:
        root.mkdir(parents=True, exist_ok=True)
    except Exception:
        return None
    return root / "model_catalog.json"


def _read_json(path: Optional[Path]) -> Optional[Dict[str, Any]]:
    if not path or not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def _fetch_remote() -> Optional[Dict[str, Any]]:
    """Download + transform models.dev; returns None on any failure (offline etc.)."""
    try:
        import requests
        resp = requests.get(MODELS_DEV_URL, timeout=_REMOTE_TIMEOUT)
        resp.raise_for_status()
        catalog = build_catalog(resp.json())
        if not catalog["providers"]:
            return None
        return catalog
    except Exception as exc:
        log.info("model catalog: remote refresh unavailable (%s)", exc)
        return None


def _ollama_base_url() -> str:
    try:
        from backend.config.app_config import load_params
        cfg = ((load_params(strict_env=False).get("ai", {}) or {})
               .get("providers", {}) or {}).get("ollama") or {}
        base = (cfg.get("base_url") or "").strip()
        if base:
            return base.rstrip("/")
    except Exception:
        pass
    from backend.config.env_config import default_ollama_base_url
    return default_ollama_base_url()


def _live_ollama_models() -> Optional[List[Dict[str, Any]]]:
    """Models actually installed in the local Ollama daemon (GET /api/tags)."""
    try:
        import requests
        resp = requests.get(f"{_ollama_base_url()}/api/tags", timeout=_OLLAMA_TIMEOUT)
        resp.raise_for_status()
        entries = (resp.json() or {}).get("models") or []
    except Exception:
        return None
    models = []
    for entry in entries:
        name = (entry.get("name") or "").strip()
        if not name:
            continue
        models.append({
            "id": name,
            "name": name,
            "cost_in": 0.0,
            "cost_out": 0.0,
            # /api/tags does not expose the context window; conservative default,
            # editable in the UI.
            "context_window": 8192,
            "tags": ["fast"] if _FAST_NAME_RE.search(name) else [],
            "quality": 1,
            "release_date": "",
        })
    return models


def pick_ping_model(catalog: Dict[str, Any], provider_id: str) -> Optional[str]:
    """Cheapest chat model of a provider (PURE) — used by the credential "test
    ping", which only needs a live round-trip, not quality. Ties keep the first
    (= newest, models are sorted newest-first); unknown provider → None."""
    for provider in catalog.get("providers", []):
        if provider.get("id") != provider_id:
            continue
        models = provider.get("models") or []
        if not models:
            return None
        best = min(models, key=lambda m: (float(m.get("cost_in") or 0)
                                          + float(m.get("cost_out") or 0)) / 2)
        return best.get("id")
    return None


def ping_model_for(provider_id: str) -> Optional[str]:
    """Catalog-backed ping model. Blocking (may hit disk/network via
    load_catalog): call via asyncio.to_thread from async endpoints."""
    try:
        return pick_ping_model(load_catalog(), (provider_id or "").strip().lower())
    except Exception:
        return None


def merge_ollama_overlay(catalog: Dict[str, Any],
                         live_models: Optional[List[Dict[str, Any]]]) -> Dict[str, Any]:
    """Replace/insert the ollama provider with the live local model list (PURE)."""
    if not live_models:
        return catalog
    merged = dict(catalog)
    providers = [p for p in catalog.get("providers", []) if p.get("id") != "ollama"]
    providers.append({"id": "ollama", "name": "Ollama (Local)", "is_local": True,
                      "models": live_models, "live": True})
    # Keep the catalog's canonical provider order
    order = {pid: i for i, pid in enumerate(CATALOG_PROVIDERS)}
    providers.sort(key=lambda p: order.get(p.get("id"), len(order)))
    merged["providers"] = providers
    return merged


_mem_lock = threading.Lock()
_mem_cache: Optional[Dict[str, Any]] = None
_mem_cached_at = 0.0
_MEM_TTL = 300  # avoid re-reading disk / re-probing Ollama on every request


def _is_fresh(catalog: Optional[Dict[str, Any]]) -> bool:
    if not catalog:
        return False
    try:
        fetched = datetime.fromisoformat(catalog.get("fetched_at", ""))
        return (datetime.now(timezone.utc) - fetched).total_seconds() < _CACHE_TTL
    except Exception:
        return False


def load_catalog(force_refresh: bool = False) -> Dict[str, Any]:
    """Best available catalog: remote (day-cached) → disk cache → vendored, plus
    the live Ollama overlay. Sync + blocking: call via asyncio.to_thread from
    async endpoints (upload freeze lesson, PR #813)."""
    global _mem_cache, _mem_cached_at
    with _mem_lock:
        if (not force_refresh and _mem_cache
                and time.monotonic() - _mem_cached_at < _MEM_TTL):
            return _mem_cache

        cache_path = _cache_path()
        cached = _read_json(cache_path)

        catalog = cached if (_is_fresh(cached) and not force_refresh) else None
        if catalog is None:
            remote = _fetch_remote()
            if remote is not None:
                remote["fetched_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
                catalog = remote
                if cache_path:
                    try:
                        cache_path.write_text(
                            json.dumps(remote, ensure_ascii=False), encoding="utf-8")
                    except Exception:
                        pass
            else:
                catalog = cached  # stale beats vendored: it was fresher once
        if catalog is None:
            catalog = _read_json(VENDORED_PATH) or {"schema": 1, "providers": []}
            catalog.setdefault("source", "vendored")

        catalog = merge_ollama_overlay(catalog, _live_ollama_models())
        _mem_cache = catalog
        _mem_cached_at = time.monotonic()
        return catalog
