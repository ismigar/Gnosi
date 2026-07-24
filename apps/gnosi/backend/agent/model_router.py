"""Data-driven, budget-aware model router.

Replaces the HARDCODED model stacks from `factory._resolve_auto_llm` with an
**editable registry** + a **selection policy** that considers: capability required
by the request, provider availability/health, remaining tokens/quota, and cost.

Design: the core (`classify_request`, `route_model`) is PURE — it receives availability, usage,
and budget INJECTED, so it can be tested without a backend or network (cf.
directive `vault_knowledge_agents.md`, memory `feedback_local_backend_test_verification`).
"""
from __future__ import annotations

import threading
from typing import Any, Callable, Dict, List, Optional

# ---------------------------------------------------------------------------
# Default registry (the old hardcoded stacks, now as DATA)
# One entry: provider, model_id, is_local, enabled, priority (lower=preferred),
# cost_in/out (USD per 1M tokens; 0 = local), context_window, quality (1..3),
        # tags (capabilities: "code", "vision", "long", "tools"...), monthly_quota? (tokens).
# ---------------------------------------------------------------------------
DEFAULT_REGISTRY: List[Dict[str, Any]] = [
    {"provider": "groq", "model_id": "llama-3.1-8b-instant", "is_local": False,
     "enabled": True, "priority": 10, "cost_in": 0.05, "cost_out": 0.08,
     "context_window": 128000, "quality": 1, "tags": ["fast"]},
    {"provider": "groq", "model_id": "llama-3.3-70b-versatile", "is_local": False,
     "enabled": True, "priority": 20, "cost_in": 0.59, "cost_out": 0.79,
     "context_window": 128000, "quality": 3, "tags": ["code", "long"]},
    {"provider": "openai", "model_id": "gpt-4o-mini", "is_local": False,
     "enabled": True, "priority": 30, "cost_in": 0.15, "cost_out": 0.60,
     "context_window": 128000, "quality": 2, "tags": ["vision", "tools", "long"]},
    {"provider": "openai", "model_id": "gpt-4o", "is_local": False,
     "enabled": True, "priority": 40, "cost_in": 2.50, "cost_out": 10.0,
     "context_window": 128000, "quality": 3, "tags": ["code", "vision", "tools", "long"]},
    # Canonical ids, never "-latest" aliases: models.dev does not publish the
    # aliases, so an alias here resolves to NO catalog price → the model would
    # be billed as free and slip past the monthly spend cap.
    {"provider": "anthropic", "model_id": "claude-haiku-4-5", "is_local": False,
     "enabled": True, "priority": 35, "cost_in": 1.0, "cost_out": 5.0,
     "context_window": 200000, "quality": 2, "tags": ["fast", "vision", "tools", "long"]},
    {"provider": "anthropic", "model_id": "claude-sonnet-4-5", "is_local": False,
     "enabled": True, "priority": 45, "cost_in": 3.0, "cost_out": 15.0,
     "context_window": 1000000, "quality": 3, "tags": ["code", "vision", "tools", "long"]},
    {"provider": "ollama", "model_id": "llama3.2:latest", "is_local": True,
     "enabled": True, "priority": 50, "cost_in": 0.0, "cost_out": 0.0,
     "context_window": 8192, "quality": 1, "tags": ["fast"]},
]

_COMPLEX_KW = {"analitza", "analiza", "analyze", "explica", "compara", "dissenya",
               "disseny", "refactor", "arquitectura", "estratègia", "pla", "plan"}
_SIMPLE_KW = {"hola", "gràcies", "gracias", "sí", "no", "ok", "quan", "què", "qui", "on"}
_CODE_KW = {"code", "codi", "codigo", "programa", "programar", "bug", "error", "python",
            "funció", "funcion", "test", "git"}


def classify_request(message: str, *, has_images: bool = False,
                     context_tokens: int = 0) -> Dict[str, Any]:
    """Extracts the request features that guide routing (PURE)."""
    text = (message or "").strip().lower()
    tokens = set(text.replace("\n", " ").split())
    is_complex = len(text) > 320 or bool(_COMPLEX_KW & tokens)
    is_simple = len(text) < 120 and (bool(_SIMPLE_KW & tokens) or "?" in text) and not is_complex
    needs: set = set()
    if _CODE_KW & tokens:
        needs.add("code")
    if has_images:
        needs.add("vision")
    if context_tokens > 16000:
        needs.add("long")
    quality = 1 if is_simple else (3 if (is_complex or "code" in needs) else 2)
    return {"desired_quality": quality, "needs": needs, "context_tokens": context_tokens}


# Above this fraction of the monthly cost cap the router behaves as
# budget-tight (prefer local/cheap) before hard-stopping at the cap itself.
_NEAR_CAP_RATIO = 0.8


def _is_free(model: Dict[str, Any]) -> bool:
    """Models that cost nothing to run (local, or 0-priced remote)."""
    return bool(model.get("is_local")) or (
        not model.get("cost_in") and not model.get("cost_out"))


def _quota_exhausted(model: Dict[str, Any], usage: Dict[str, int]) -> bool:
    quota = model.get("monthly_quota")
    if not quota:
        return False
    key = f"{model['provider']}:{model['model_id']}"
    return usage.get(key, 0) >= quota


def _fits_context(model: Dict[str, Any], features: Dict[str, Any]) -> bool:
    return model.get("context_window", 0) >= features.get("context_tokens", 0)


def route_model(
    message: str,
    registry: Optional[List[Dict[str, Any]]] = None,
    *,
    is_available: Callable[[str], bool],
    usage: Optional[Dict[str, int]] = None,
    budget: Optional[Dict[str, Any]] = None,
    manual: Optional[Dict[str, str]] = None,
    has_images: bool = False,
    context_tokens: int = 0,
) -> Dict[str, Any]:
    """Picks the best model based on capability + availability + budget + cost (PURE).

    - `is_available(provider)`: injected (in the backend = `_provider_is_available`).
    - `usage`: {f"{provider}:{model_id}": tokens_used_this_period}.
    - `budget`: {"prefer_local": bool, "remaining_tokens": int|None,
                 "prefer_local_below": int} → if few paid tokens remain, it degrades to local.
      Money cap (both INJECTED, cf. `budget_status`): {"cost_cap_usd": float,
      "spent_usd": float} → ≥80% of the cap prefers cheap/local, at/over the cap
      only zero-cost models remain (reason "budget_exhausted" if none).
    - `manual`: {provider, model_id} → forces a model (manual mode), if available.
    Returns {provider, model_id, reason, estimated_cost_per_1k}.

    """
    registry = registry or DEFAULT_REGISTRY
    usage = usage or {}
    budget = budget or {}
    features = classify_request(message, has_images=has_images, context_tokens=context_tokens)

    # Manual mode: respects the choice if the provider is alive
    if manual and manual.get("model_id"):
        if is_available(manual.get("provider", "")):
            return {**manual, "reason": "manual"}

    # Tight budget → prefer local (cost 0).
    remaining = budget.get("remaining_tokens")
    below = budget.get("prefer_local_below", 0)
    # Money cap (injected by the caller: cap in USD + USD spent this period)
    cap_usd = budget.get("cost_cap_usd") or 0
    spent_usd = budget.get("spent_usd") or 0
    over_cap = bool(cap_usd) and spent_usd >= cap_usd
    near_cap = bool(cap_usd) and not over_cap and spent_usd >= _NEAR_CAP_RATIO * cap_usd
    budget_tight = bool(budget.get("prefer_local")) or near_cap or (
        remaining is not None and below and remaining <= below)

    # Candidates: enabled, available, with required capabilities, within context, with quota
    needs = features["needs"]
    candidates = [
        m for m in registry
        if m.get("enabled", True)
        and is_available(m["provider"])
        and needs.issubset(set(m.get("tags", [])))
        and _fits_context(m, features)
        and not _quota_exhausted(m, usage)
    ]
    if not candidates:
        # Degradation: relaxes capabilities (except context) and retries
        candidates = [
            m for m in registry
            if m.get("enabled", True) and is_available(m["provider"])
            and _fits_context(m, features) and not _quota_exhausted(m, usage)
        ]
    if not candidates:
        return {"provider": None, "model_id": None, "reason": "cap proveïdor disponible"}

    # Spend cap reached → only zero-cost models survive; with none available
    # the caller degrades gracefully (503 on one-shot endpoints).
    if over_cap:
        free = [m for m in candidates if _is_free(m)]
        if not free:
            return {"provider": None, "model_id": None, "reason": "budget_exhausted"}
        candidates = free

    desired = features["desired_quality"]

    def score(m: Dict[str, Any]) -> tuple:
        # 1) Penalize falling short on quality; excess quality is a minor waste.
        q_gap = max(0, desired - m.get("quality", 1)) * 10 + max(0, m.get("quality", 1) - desired)
        avg_cost = (m.get("cost_in", 0) + m.get("cost_out", 0)) / 2
        if budget_tight:
    # Cost takes precedence; local (cost 0) wins.
            return (0 if m.get("is_local") else 1, avg_cost, q_gap, m.get("priority", 999))
        # Normal case: quality fit first, then cost, then priority
        return (q_gap, avg_cost, m.get("priority", 999))

    best = sorted(candidates, key=score)[0]
    if over_cap:
        reason = "budget_cap→free"
    elif budget_tight and best.get("is_local"):
        reason = "budget→local"
    elif budget_tight:
        reason = "budget→barat"
    else:
        reason = f"qualitat≈{desired}"
    return {
        "provider": best["provider"], "model_id": best["model_id"],
        "reason": reason,
        "estimated_cost_per_1k": (best.get("cost_in", 0) + best.get("cost_out", 0)) / 2,
    }


# ---------------------------------------------------------------------------
# Load the registry from config (with fallback to the default)
# ---------------------------------------------------------------------------
def apply_catalog_prices(registry: List[Dict[str, Any]],
                         price_index: Dict[str, Dict[str, float]]) -> List[Dict[str, Any]]:
    """Overwrite each entry's cost with the catalog price (PURE).

    The catalog (models.dev, refreshed daily) is the single source of truth for
    prices: providers change tariffs and a value frozen in params.yaml silently
    rots, skewing both the router's cost ranking and the spend ledger. Entries
    with no catalog match (custom/free-text models) keep their stored value, and
    gain `price_unknown: True` so the UI can say so instead of showing a
    made-up 0. `price_from_catalog` marks the ones that were refreshed.
    """
    priced: List[Dict[str, Any]] = []
    for entry in registry or []:
        row = dict(entry)
        rates = (price_index or {}).get(f"{row.get('provider')}:{row.get('model_id')}")
        if rates:
            row["cost_in"] = rates["cost_in"]
            row["cost_out"] = rates["cost_out"]
            row["price_from_catalog"] = True
            # Always explicit: a client merging this over its own defaults
            # would otherwise keep a stale "unknown" for a priced row.
            row["price_unknown"] = False
        else:
            row["price_from_catalog"] = False
            # Local models are free by definition — not an unknown price
            row["price_unknown"] = not row.get("is_local")
        priced.append(row)
    return priced


def load_registry(with_catalog_prices: bool = True) -> List[Dict[str, Any]]:
    """Reads `ai.models` from config; if absent, seeds with DEFAULT_REGISTRY.

    Prices are refreshed from the catalog unless explicitly disabled (the
    stored cost is only a fallback for models the catalog doesn't know).
    """
    registry = DEFAULT_REGISTRY
    try:
        from backend.config.app_config import load_params
        models = (load_params(strict_env=False).get("ai", {}) or {}).get("models")
        if isinstance(models, list) and models:
            registry = models
    except Exception:
        pass
    if not with_catalog_prices:
        return registry
    try:
        from backend.agent.model_catalog import catalog_price_index
        return apply_catalog_prices(registry, catalog_price_index())
    except Exception:
        return registry


# ---------------------------------------------------------------------------
# Usage accounting (tokens + USD cost per model/period) — feeds the budget cap
# ---------------------------------------------------------------------------
# One lock for EVERY instance: stores are constructed ad-hoc at each call site,
# so an instance-level lock would not serialize two concurrent recorders
# (read-modify-write race, cf. memory feedback_json_store_rmw_race_pattern).
_usage_lock = threading.Lock()


def _normalize_usage_entry(value: Any) -> Dict[str, Any]:
    """Accept both the v2 shape and the legacy plain-int token counter."""
    if isinstance(value, dict):
        return {
            "in": int(value.get("in") or 0),
            "out": int(value.get("out") or 0),
            "cost_usd": float(value.get("cost_usd") or 0.0),
        }
    try:
        return {"in": int(value), "out": 0, "cost_usd": 0.0}
    except Exception:
        return {"in": 0, "out": 0, "cost_usd": 0.0}


class UsageStore:
    """Persistent per-`provider:model_id` counter of tokens and USD cost.

    Monthly period (YYYY-MM). File format v2:
    ``{"2026-07": {"groq:llama-3.1-8b-instant": {"in": 1200, "out": 340,
    "cost_usd": 0.0003}}}`` — legacy plain-int values (total tokens) are
    still read correctly.
    """

    def __init__(self, path: Optional[str] = None):
        self._path = path
        self._data: Dict[str, Dict[str, Any]] = {}
        self._load()

    def _resolve_path(self):
        if self._path:
            from pathlib import Path
            return Path(self._path)
        try:
            from backend.config.app_config import load_params
            # Canonical key is LOCAL_CACHE (paths_config); the old
            # "GNOSI_LOCAL_DATA" lookup matched nothing and silently sent every
            # ledger write to /dev/null.
            paths = load_params(strict_env=False).paths
            base = paths.get("LOCAL_CACHE") or paths.get("LOCAL_DATA")
            if base:
                from pathlib import Path
                d = Path(base)
                if d.name != "cache":
                    d = d / "cache"
                d.mkdir(parents=True, exist_ok=True)
                return d / "llm_usage.json"
        except Exception:
            pass
        return None

    def _load(self):
        p = self._resolve_path()
        if p and p.exists():
            try:
                import json
                self._data = json.loads(p.read_text(encoding="utf-8"))
            except Exception:
                self._data = {}

    def _save(self):
        p = self._resolve_path()
        if not p:
            return
        try:
            import json
            import os
            import tempfile
            # Atomic replace: a crash mid-write must not corrupt the ledger
            fd, tmp = tempfile.mkstemp(dir=str(p.parent), prefix=".llm_usage-")
            with os.fdopen(fd, "w", encoding="utf-8") as fh:
                json.dump(self._data, fh, ensure_ascii=False, indent=2)
            os.replace(tmp, p)
        except Exception:
            pass

    def record(self, provider: str, model_id: str, in_tok: int, out_tok: int,
               period: str, cost_usd: float = 0.0):
        with _usage_lock:
            # Re-read under the lock: another instance may have written since
            # this one loaded (the whole cycle must sit inside the lock).
            self._load()
            bucket = self._data.setdefault(period, {})
            key = f"{provider}:{model_id}"
            entry = _normalize_usage_entry(bucket.get(key, {}))
            entry["in"] += int(in_tok)
            entry["out"] += int(out_tok)
            entry["cost_usd"] = round(entry["cost_usd"] + float(cost_usd or 0.0), 6)
            bucket[key] = entry
            self._save()

    def usage_for(self, period: str) -> Dict[str, int]:
        """Total tokens per key — the shape `route_model`'s quota check expects."""
        out: Dict[str, int] = {}
        for key, value in (self._data.get(period, {}) or {}).items():
            entry = _normalize_usage_entry(value)
            out[key] = entry["in"] + entry["out"]
        return out

    def spend_usd(self, period: str) -> float:
        """Total recorded USD cost for the period."""
        return round(sum(
            _normalize_usage_entry(v)["cost_usd"]
            for v in (self._data.get(period, {}) or {}).values()
        ), 6)

    def rows(self, period: str) -> List[Dict[str, Any]]:
        """Per-model breakdown for the usage API, most expensive first."""
        rows: List[Dict[str, Any]] = []
        for key, value in (self._data.get(period, {}) or {}).items():
            provider, _, model_id = key.partition(":")
            entry = _normalize_usage_entry(value)
            rows.append({"provider": provider, "model_id": model_id, **entry})
        rows.sort(key=lambda r: (-r["cost_usd"], -(r["in"] + r["out"])))
        return rows


def model_cost_rates(provider: str, model_id: str,
                     registry: Optional[List[Dict[str, Any]]] = None) -> tuple:
    """(cost_in, cost_out) in USD per 1M tokens.

    The catalog wins: it tracks the provider's current tariff, while a value
    sitting in params.yaml is a snapshot from whenever the row was saved. The
    registry is only the fallback for models the catalog doesn't know (custom
    endpoints); unknown → 0/0 (treated as free)."""
    try:
        from backend.agent.model_catalog import catalog_model_cost
        rates = catalog_model_cost(provider, model_id)
        if rates:
            return rates["cost_in"], rates["cost_out"]
    except Exception:
        pass
    entries = registry if registry is not None else load_registry(with_catalog_prices=False)
    for m in entries:
        if m.get("provider") == provider and m.get("model_id") == model_id:
            return float(m.get("cost_in") or 0), float(m.get("cost_out") or 0)
    return 0.0, 0.0


def usage_from_message(message: Any) -> Optional[tuple]:
    """(input_tokens, output_tokens) from a langchain AIMessage, or None.

    Duck-typed on `usage_metadata` so this module keeps zero langchain
    imports (the core stays PURE/testable)."""
    meta = getattr(message, "usage_metadata", None)
    if not isinstance(meta, dict):
        return None
    in_tok = int(meta.get("input_tokens") or 0)
    out_tok = int(meta.get("output_tokens") or 0)
    if in_tok <= 0 and out_tok <= 0:
        return None
    return in_tok, out_tok


def record_llm_usage(provider: Optional[str], model_id: Optional[str],
                     in_tok: int, out_tok: int) -> None:
    """Best-effort ledger write after a real LLM call. Never raises: usage
    accounting must not take down the request that produced it."""
    if not provider or not model_id or (in_tok <= 0 and out_tok <= 0):
        return
    try:
        from datetime import datetime
        cost_in, cost_out = model_cost_rates(provider, model_id)
        cost = (in_tok * cost_in + out_tok * cost_out) / 1_000_000
        UsageStore().record(provider, model_id, in_tok, out_tok,
                            datetime.now().strftime("%Y-%m"), cost_usd=cost)
    except Exception:
        pass


def budget_status(period: Optional[str] = None) -> Dict[str, Any]:
    """Effective budget picture for a period: config cap (in the Settings
    currency) + ledger spend (USD) + conversion. Feeds both the router
    (`cost_cap_usd`/`spent_usd` injected into `route_model`) and the
    GET /api/ai/usage endpoint. Blocking (disk + possibly one FX fetch):
    call via asyncio.to_thread from async endpoints."""
    from datetime import datetime
    from backend.config.app_config import load_params
    from backend.services.fx_rates import parse_currency_code, rate_info, usd_to_currency

    period = period or datetime.now().strftime("%Y-%m")
    cfg = load_params(strict_env=False)
    budget_cfg = dict((cfg.get("ai", {}) or {}).get("budget") or {})
    currency = rate_info(parse_currency_code(
        (cfg.get("settings", {}) or {}).get("currency")))

    store = UsageStore()
    spent_usd = store.spend_usd(period)
    rows = store.rows(period)
    for row in rows:
        row["cost_ccy"] = usd_to_currency(row["cost_usd"], currency["code"])

    cap_ccy = float(budget_cfg.get("monthly_cost_cap") or 0) or None
    cap_usd = round(cap_ccy / currency["usd_rate"], 4) if cap_ccy else None
    ratio = (spent_usd / cap_usd) if cap_usd else None
    return {
        "period": period,
        "currency": currency,
        "spent_usd": spent_usd,
        "spent_ccy": usd_to_currency(spent_usd, currency["code"]),
        "cap_ccy": cap_ccy,
        "cap_usd": cap_usd,
        "ratio": round(ratio, 4) if ratio is not None else None,
        "over_cap": bool(cap_usd) and spent_usd >= cap_usd,
        "budget": budget_cfg,
        "per_model": rows,
    }
