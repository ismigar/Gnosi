"""Router de models data-driven i conscient de pressupost.

Substitueix els stacks de models HARDCODED de `factory._resolve_auto_llm` per un
**registry editable** + una **política de selecció** que considera: capacitat requerida
per la petició, disponibilitat/salut del proveïdor, tokens/quota restants i cost.

Disseny: el nucli (`classify_request`, `route_model`) és PUR — rep la disponibilitat, l'ús
i el pressupost INJECTATS, de manera que es pot testejar sense backend ni xarxa (cf.
directiva `vault_knowledge_agents.md`, memòria `feedback_local_backend_test_verification`).
"""
from __future__ import annotations

from typing import Any, Callable, Dict, List, Optional

# ---------------------------------------------------------------------------
# Registry per defecte (els antics stacks hardcoded, ara com a DADES)
# Una entrada: provider, model_id, is_local, enabled, priority (menor=preferit),
# cost_in/out (USD per 1k tokens; 0 = local), context_window, quality (1..3),
# tags (capacitats: "code", "vision", "long", "tools"...), monthly_quota? (tokens).
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
    {"provider": "anthropic", "model_id": "claude-3-5-haiku-latest", "is_local": False,
     "enabled": True, "priority": 35, "cost_in": 0.80, "cost_out": 4.0,
     "context_window": 200000, "quality": 2, "tags": ["tools", "long"]},
    {"provider": "anthropic", "model_id": "claude-3-5-sonnet-latest", "is_local": False,
     "enabled": True, "priority": 45, "cost_in": 3.0, "cost_out": 15.0,
     "context_window": 200000, "quality": 3, "tags": ["code", "vision", "tools", "long"]},
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
    """Extreu les característiques de la petició que guien el routing (PUR)."""
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
    """Tria el millor model segons capacitat + disponibilitat + pressupost + cost (PUR).

    - `is_available(provider)`: injectat (al backend = `_provider_is_available`).
    - `usage`: {f"{provider}:{model_id}": tokens_usats_aquest_període}.
    - `budget`: {"prefer_local": bool, "remaining_tokens": int|None,
                 "prefer_local_below": int} → si queden pocs tokens de pagament, degrada a local.
    - `manual`: {provider, model_id} → força un model (mode manual), si està disponible.
    Retorna {provider, model_id, reason, estimated_cost_per_1k}.
    """
    registry = registry or DEFAULT_REGISTRY
    usage = usage or {}
    budget = budget or {}
    features = classify_request(message, has_images=has_images, context_tokens=context_tokens)

    # Mode manual: respecta l'elecció si el proveïdor està viu
    if manual and manual.get("model_id"):
        if is_available(manual.get("provider", "")):
            return {**manual, "reason": "manual"}

    # Pressupost prim → preferir local (cost 0)
    remaining = budget.get("remaining_tokens")
    below = budget.get("prefer_local_below", 0)
    budget_tight = bool(budget.get("prefer_local")) or (
        remaining is not None and below and remaining <= below)

    # Candidats: habilitats, disponibles, amb capacitats requerides, dins context, amb quota
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
        # Degradació: relaxa les capacitats (excepte context) i torna a provar
        candidates = [
            m for m in registry
            if m.get("enabled", True) and is_available(m["provider"])
            and _fits_context(m, features) and not _quota_exhausted(m, usage)
        ]
    if not candidates:
        return {"provider": None, "model_id": None, "reason": "cap proveïdor disponible"}

    desired = features["desired_quality"]

    def score(m: Dict[str, Any]) -> tuple:
        # 1) Penalitza quedar-se curt de qualitat; sobra-qualitat és lleu malbaratament.
        q_gap = max(0, desired - m.get("quality", 1)) * 10 + max(0, m.get("quality", 1) - desired)
        avg_cost = (m.get("cost_in", 0) + m.get("cost_out", 0)) / 2
        if budget_tight:
            # Cost mana; local (cost 0) guanya
            return (0 if m.get("is_local") else 1, avg_cost, q_gap, m.get("priority", 999))
        # Cas normal: encaix de qualitat primer, després cost, després prioritat
        return (q_gap, avg_cost, m.get("priority", 999))

    best = sorted(candidates, key=score)[0]
    reason = "budget→local" if (budget_tight and best.get("is_local")) else \
             ("budget→barat" if budget_tight else f"qualitat≈{desired}")
    return {
        "provider": best["provider"], "model_id": best["model_id"],
        "reason": reason,
        "estimated_cost_per_1k": (best.get("cost_in", 0) + best.get("cost_out", 0)) / 2,
    }


# ---------------------------------------------------------------------------
# Càrrega del registry des de config (amb fallback al per defecte)
# ---------------------------------------------------------------------------
def load_registry() -> List[Dict[str, Any]]:
    """Llegeix `ai.models` de la config; si no hi és, sembra amb DEFAULT_REGISTRY."""
    try:
        from backend.config.app_config import load_params
        models = (load_params(strict_env=False).get("ai", {}) or {}).get("models")
        if isinstance(models, list) and models:
            return models
    except Exception:
        pass
    return DEFAULT_REGISTRY


# ---------------------------------------------------------------------------
# Comptabilitat d'ús (tokens per model/període) — alimenta "queden tokens"
# ---------------------------------------------------------------------------
class UsageStore:
    """Comptador persistent de tokens per `provider:model_id`. Període mensual (YYYY-MM)."""

    def __init__(self, path: Optional[str] = None):
        self._path = path
        self._data: Dict[str, Dict[str, int]] = {}
        self._load()

    def _resolve_path(self):
        if self._path:
            from pathlib import Path
            return Path(self._path)
        try:
            from backend.config.app_config import load_params
            base = load_params(strict_env=False).paths.get("GNOSI_LOCAL_DATA")
            if base:
                from pathlib import Path
                d = Path(base) / "cache"
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
            p.write_text(json.dumps(self._data, ensure_ascii=False, indent=2), encoding="utf-8")
        except Exception:
            pass

    def record(self, provider: str, model_id: str, in_tok: int, out_tok: int, period: str):
        bucket = self._data.setdefault(period, {})
        key = f"{provider}:{model_id}"
        bucket[key] = bucket.get(key, 0) + int(in_tok) + int(out_tok)
        self._save()

    def usage_for(self, period: str) -> Dict[str, int]:
        return dict(self._data.get(period, {}))
