import asyncio
import os
from typing import Optional

import yaml
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from backend.config.app_config import load_params
from backend.security.ai_credentials import (
    get_ai_catalog_with_status,
    migrate_ai_provider_secrets,
    resolve_provider_api_key,
    sanitize_ai_config,
    set_provider_api_key,
)
from backend.services.workspace_service import require_role
from backend.utils.errors import safe_error_detail
from backend.utils.safe_io import safe_write_text


router = APIRouter(prefix="/ai", tags=["AI Settings"])

from backend.agent.factory import get_llm

class ValidatePayload(BaseModel):
    api_key: Optional[str] = None
    base_url: Optional[str] = None
    model: Optional[str] = None

@router.post("/providers/{provider_id}/validate", dependencies=[Depends(require_role("admin"))])
async def validate_provider(provider_id: str, payload: ValidatePayload):
    """
    Attempts to validate the provider by making a simple 'ping' request.
    If api_key is provided in payload, it uses it. Otherwise, it uses the saved one.
    """
    provider = provider_id.lower().strip()
    
    # Resolve API Key
    api_key = payload.api_key
    if not api_key:
        api_key = resolve_provider_api_key(provider, {})
    
    if not api_key and provider not in ["ollama", "local", "generic"]:
        return {"success": False, "error": f"Falta la clau API per validar el proveïdor {provider.capitalize()}."}

    # Ping model: explicit payload > cheapest model from the live catalog >
    # legacy hardcoded fallback. The hardcoded ids rot (providers retire them —
    # e.g. OpenRouter dropped its gpt-4o-mini alias) and then the ping fails
    # even with a valid key; the catalog tracks what actually exists.
    default_models = {
        "openai": "gpt-4o-mini",
        "anthropic": "claude-3-5-haiku-latest",
        "groq": "llama-3.3-70b-versatile",
        "google": "gemini-1.5-flash",
        "openrouter": "openai/gpt-4o-mini"
    }
    target_model = payload.model
    if not target_model:
        from backend.agent.model_catalog import ping_model_for
        target_model = await asyncio.to_thread(ping_model_for, provider)
    if not target_model:
        target_model = default_models.get(provider)

    try:
        # timeout=10 is applied when building the client (REAL network timeout). It can NOT be
        # passed to .invoke() via config={"timeout":...}: langchain ignores it, and the "validate"
        # would hang if the provider doesn't respond. cf. directive ai_error_handling.md.
        llm = get_llm(
            provider=provider,
            model=target_model,
            api_key=api_key,
            base_url=payload.base_url,
            timeout=10,
        )

        if not llm:
            return {"success": False, "error": f"Could not instantiate provider {provider}. Check the dependency and API key. Model: {target_model}"}

        # Minimal invocation attempt — to_thread avoids blocking the event loop
        # (some LLMs don't expose `ainvoke` or their sync version is the primary path).
        from langchain_core.messages import HumanMessage
        response = await asyncio.to_thread(
            llm.invoke,
            [HumanMessage(content="Say 'ok'")],
        )

        return {"success": True, "response": response.content}
    except Exception as e:
        error_msg = str(e)
        # Groq/OpenAI SDKs raise AuthenticationError/401 without the literal
        # words "API key" — without this match a bad key surfaced as a cryptic
        # "Internal error [hash]" instead of the actionable message.
        if any(marker in error_msg for marker in ("API key", "AuthenticationError", "401", "Unauthorized")):
            return {"success": False, "error": f"Clau API invàlida per a {provider.capitalize()}."}
        return {"success": False, "error": safe_error_detail(e, context=f"POST /ai/providers/{provider}/validate")}



# Note: We now fetch the dynamic path from app_config at runtime


class ProviderCredentialPayload(BaseModel):
    api_key: str
    base_url: Optional[str] = ""


@router.get("/catalog")
async def get_ai_catalog():
    # to_thread: the provider list is now fed by the model catalog, whose
    # loader does blocking I/O (disk cache / short HTTP fetches).
    def _load():
        cfg = load_params(strict_env=False)
        ai_cfg = dict(cfg.get("ai", {}) or {})
        return {
            "catalog": get_ai_catalog_with_status(ai_cfg),
            "config": sanitize_ai_config(ai_cfg),
        }

    return await asyncio.to_thread(_load)


@router.post("/providers/{provider_id}/credentials", dependencies=[Depends(require_role("admin"))])
async def set_provider_credentials(provider_id: str, payload: ProviderCredentialPayload):
    provider = (provider_id or "").strip().lower()
    if not provider:
        raise HTTPException(status_code=400, detail="provider_id is required")
    if not payload.api_key or not payload.api_key.strip():
        raise HTTPException(status_code=400, detail="api_key is required")

    ok, credential_ref = set_provider_api_key(provider, payload.api_key.strip())
    if not ok or not credential_ref:
        raise HTTPException(status_code=500, detail="Could not save provider credential")

    cfg = load_params(strict_env=False)
    params_path = cfg.params_source
    current_config = {}
    if params_path.exists():
        with open(params_path, "r", encoding="utf-8") as f:
            current_config = yaml.safe_load(f) or {}

    ai_cfg = dict(current_config.get("ai") or {})
    providers = dict(ai_cfg.get("providers") or {})
    provider_cfg = dict(providers.get(provider) or {})
    provider_cfg["credential_ref"] = credential_ref
    provider_cfg.pop("api_key", None)
    if payload.base_url is not None:
        provider_cfg["base_url"] = payload.base_url
    providers[provider] = provider_cfg
    ai_cfg["providers"] = providers

    migrated_ai_cfg, _ = migrate_ai_provider_secrets(ai_cfg)
    current_config["ai"] = migrated_ai_cfg

    # Atomic write: params.yaml contains all the app's main config
    # (including AI provider). A crash halfway through would leave it corrupted.
    yaml_text = yaml.safe_dump(
        current_config, default_flow_style=False,
        allow_unicode=True, sort_keys=False,
    )
    safe_write_text(params_path, yaml_text)

    return {
        "status": "success",
        "provider": provider,
        "credential_ref": credential_ref,
        "has_api_key": True,
    }

class ProviderStatusPayload(BaseModel):
    enabled: bool


def _registry_rows_without_provider(effective_registry: list, provider: str) -> tuple:
    """(filtered_rows, removed_count) — pure, so the cascade is testable.

    `effective_registry` is what the router actually uses (ai.models, or the
    seed default when unset): filtering THAT list is what makes the cascade
    also clear seed rows of a deleted provider instead of leaving phantoms.
    """
    filtered = [m for m in (effective_registry or [])
                if (m or {}).get("provider") != provider]
    return filtered, len(effective_registry or []) - len(filtered)


@router.delete("/providers/{provider_id}", dependencies=[Depends(require_role("admin"))])
async def delete_provider(provider_id: str):
    """Disconnect a provider: config entry, its stored credential AND its
    router-registry rows.

    - The keychain secret must go too — leaving it made the router keep
      routing to a "deleted" provider (resolve_provider_api_key falls back to
      the keychain even with no config entry).
    - Registry rows of the provider are removed from the EFFECTIVE registry
      (materializing the seed default if needed): rows of a provider that no
      longer exists are exactly the "models without providers" confusion this
      screen is meant to kill.
    """
    provider = (provider_id or "").strip().lower()
    if not provider:
        raise HTTPException(status_code=400, detail="provider_id is required")

    def _delete() -> dict:
        from backend.agent.model_router import load_registry
        from backend.security.ai_credentials import credential_key_for_provider
        from backend.security.keychain_manager import get_keychain

        cfg = load_params(strict_env=False)
        params_path = cfg.params_source
        current_config = {}
        if params_path.exists():
            with open(params_path, "r", encoding="utf-8") as f:
                current_config = yaml.safe_load(f) or {}

        ai_cfg = dict(current_config.get("ai") or {})
        providers = dict(ai_cfg.get("providers") or {})
        existed = provider in providers
        providers.pop(provider, None)
        ai_cfg["providers"] = providers

        # Cascade: drop the provider's rows from the effective registry
        # (raw stored prices — this is persisted config, not display data)
        effective = load_registry(with_catalog_prices=False)
        filtered, removed_models = _registry_rows_without_provider(effective, provider)
        if removed_models:
            ai_cfg["models"] = filtered

        current_config["ai"] = ai_cfg
        if existed or removed_models:
            yaml_text = yaml.safe_dump(
                current_config, default_flow_style=False,
                allow_unicode=True, sort_keys=False,
            )
            safe_write_text(params_path, yaml_text)

        # Credential: best-effort delete; missing key is not an error
        credential_deleted = False
        key = credential_key_for_provider(provider)
        if key:
            try:
                credential_deleted = bool(get_keychain().delete_credential(key))
            except Exception:
                credential_deleted = False

        if not existed and not removed_models:
            return {"status": "skipped",
                    "message": f"Provider {provider} not found in config",
                    "removed_models": 0, "credential_deleted": credential_deleted}
        return {"status": "success", "message": f"Provider {provider} deleted",
                "removed_models": removed_models,
                "credential_deleted": credential_deleted}

    # to_thread: params.yaml I/O + registry load + keychain access are blocking
    return await asyncio.to_thread(_delete)


@router.patch("/providers/{provider_id}/status", dependencies=[Depends(require_role("admin"))])
async def update_provider_status(provider_id: str, payload: ProviderStatusPayload):
    provider = (provider_id or "").strip().lower()
    if not provider:
        raise HTTPException(status_code=400, detail="provider_id is required")

    cfg = load_params(strict_env=False)
    params_path = cfg.params_source
    current_config = {}
    if params_path.exists():
        with open(params_path, "r", encoding="utf-8") as f:
            current_config = yaml.safe_load(f) or {}

    ai_cfg = dict(current_config.get("ai") or {})
    providers = dict(ai_cfg.get("providers") or {})
    provider_cfg = dict(providers.get(provider) or {})
    
    provider_cfg["enabled"] = payload.enabled
    providers[provider] = provider_cfg
    ai_cfg["providers"] = providers
    current_config["ai"] = ai_cfg

    yaml_text = yaml.safe_dump(
        current_config, default_flow_style=False,
        allow_unicode=True, sort_keys=False,
    )
    safe_write_text(params_path, yaml_text)

    return {"status": "success", "provider": provider, "enabled": payload.enabled}


# ---------------------------------------------------------------------------
# Router model registry (data-driven) + budget policy
# cf. backend/agent/model_router.py i directiva vault_knowledge_agents.md
# ---------------------------------------------------------------------------
class ModelsPayload(BaseModel):
    models: list
    budget: Optional[dict] = None


@router.get("/models")
async def get_model_registry():
    """Returns the router's model registry (config `ai.models`, or the default)
    and the budget policy (`ai.budget`).

    Prices come refreshed from the catalog (each row carries
    `price_from_catalog` / `price_unknown`), so the UI never shows a tariff
    that went stale in params.yaml. to_thread: load_registry now consults the
    catalog, whose loader does blocking I/O.
    """
    from backend.agent.model_router import load_registry, DEFAULT_REGISTRY
    cfg = load_params(strict_env=False)
    ai_cfg = dict(cfg.get("ai", {}) or {})
    return {
        "models": await asyncio.to_thread(load_registry),
        "budget": dict(ai_cfg.get("budget") or {}),
        "default": DEFAULT_REGISTRY,
    }


@router.get("/model-catalog")
async def get_model_catalog(refresh: bool = False):
    """Provider → model catalog (ids + cost/context/capabilities) feeding the
    registry UI dropdowns. Sources: models.dev (day-cached) → disk cache →
    vendored JSON, plus the live Ollama model list. Each provider is annotated
    with `connected` (credential/env present, or local) so the UI can group
    usable providers and flag registry rows the router would skip. to_thread:
    the loader does blocking I/O (disk + short HTTP fetches) and must not
    freeze the event loop."""
    from backend.agent.model_catalog import load_catalog
    from backend.security.ai_credentials import (
        env_keys_for_provider,
        has_provider_api_key,
        is_provider_connected,
    )

    def _load():
        catalog = load_catalog(refresh)
        providers_cfg = dict(
            (load_params(strict_env=False).get("ai", {}) or {}).get("providers") or {})
        # Copy before annotating: load_catalog memoizes and returns the SAME
        # dict across requests — mutating it would freeze a stale connection
        # state into the cache.
        annotated = dict(catalog)
        annotated_providers = []
        for entry in catalog.get("providers", []):
            provider_id = entry.get("id", "")
            configured = provider_id in providers_cfg
            provider_cfg = providers_cfg.get(provider_id) if configured else None
            connected = is_provider_connected(provider_id, provider_cfg)
            has_api_key = (
                has_provider_api_key(provider_id, provider_cfg)
                if configured
                else any(os.environ.get(key) for key in env_keys_for_provider(provider_id))
            )
            annotated_providers.append({
                **entry,
                "connected": connected,
                "configured": configured,
                "enabled": (provider_cfg or {}).get("enabled", True),
                "has_api_key": has_api_key,
                "base_url": (provider_cfg or {}).get("base_url", ""),
            })
        annotated["providers"] = annotated_providers
        return annotated

    return await asyncio.to_thread(_load)


@router.get("/model-comparison")
async def get_model_comparison():
    """Complete, freshly paginated Artificial Analysis language-model feed."""
    from backend.services.artificial_analysis import (
        ArtificialAnalysisError,
        fetch_all_models,
    )

    try:
        return await asyncio.to_thread(fetch_all_models)
    except ArtificialAnalysisError as exc:
        raise HTTPException(
            status_code=exc.status_code,
            detail={"code": exc.code},
        ) from exc


@router.get("/usage")
async def get_ai_usage():
    """Current-period AI spend: USD + the Settings currency, cap, ratio and a
    per-model breakdown. to_thread: reads the ledger from disk and may do one
    short FX fetch."""
    from backend.agent.model_router import budget_status
    return await asyncio.to_thread(budget_status)


def _sanitize_budget(raw: dict) -> dict:
    """Keep only known budget keys, safely typed; drop everything else."""
    budget: dict = {
        "prefer_local": bool(raw.get("prefer_local")),
        "prefer_local_below": int(raw.get("prefer_local_below") or 0),
    }
    if raw.get("remaining_tokens") not in (None, ""):
        try:
            budget["remaining_tokens"] = int(raw["remaining_tokens"])
        except (TypeError, ValueError):
            pass
    try:
        cap = float(raw.get("monthly_cost_cap") or 0)
        if cap > 0:
            budget["monthly_cost_cap"] = round(cap, 2)
    except (TypeError, ValueError):
        pass
    return budget


@router.put("/models", dependencies=[Depends(require_role("admin"))])
async def set_model_registry(payload: ModelsPayload):
    """Saves the model registry and the budget policy to params.yaml.

    Prices are NOT taken from the payload: the catalog owns them (the UI shows
    them read-only). What lands in params.yaml is the catalog price, kept as an
    offline snapshot; only models the catalog doesn't know fall back to the
    client's value, so custom endpoints keep whatever they had.
    """
    if not isinstance(payload.models, list):
        raise HTTPException(status_code=400, detail="models ha de ser una llista")

    from backend.agent.model_catalog import catalog_price_index
    price_index = await asyncio.to_thread(catalog_price_index)

    # Minimal validation of each entry
    cleaned = []
    for m in payload.models:
        if not isinstance(m, dict) or not m.get("provider") or not m.get("model_id"):
            raise HTTPException(status_code=400, detail="cada model necessita provider i model_id")
        provider = str(m["provider"]).strip().lower()
        model_id = str(m["model_id"]).strip()
        rates = price_index.get(f"{provider}:{model_id}")
        cleaned.append({
            "provider": provider,
            "model_id": model_id,
            "is_local": bool(m.get("is_local", False)),
            "enabled": bool(m.get("enabled", True)),
            "priority": int(m.get("priority", 100)),
            "cost_in": rates["cost_in"] if rates else float(m.get("cost_in", 0) or 0),
            "cost_out": rates["cost_out"] if rates else float(m.get("cost_out", 0) or 0),
            "context_window": int(m.get("context_window", 8192) or 8192),
            "quality": int(m.get("quality", 2) or 2),
            "tags": [str(t) for t in (m.get("tags") or [])],
            **({"monthly_quota": int(m["monthly_quota"])} if m.get("monthly_quota") else {}),
            **({"endpoint": str(m["endpoint"])} if m.get("endpoint") else {}),
        })

    cfg = load_params(strict_env=False)
    params_path = cfg.params_source
    current_config = {}
    if params_path.exists():
        with open(params_path, "r", encoding="utf-8") as f:
            current_config = yaml.safe_load(f) or {}

    ai_cfg = dict(current_config.get("ai") or {})
    ai_cfg["models"] = cleaned
    if payload.budget is not None:
        ai_cfg["budget"] = _sanitize_budget(dict(payload.budget))
    current_config["ai"] = ai_cfg

    yaml_text = yaml.safe_dump(
        current_config, default_flow_style=False, allow_unicode=True, sort_keys=False,
    )
    safe_write_text(params_path, yaml_text)
    return {"status": "success", "count": len(cleaned)}


# ── AI content generation (for the Vault editor) ──────────────────

class GeneratePayload(BaseModel):
    prompt: Optional[str] = ""
    context: Optional[str] = ""
    mode: Optional[str] = "free"   # free | continue | summarize | improve | translate
    language: Optional[str] = None


def _build_generation_prompt(payload: "GeneratePayload") -> str:
    """Build the final prompt according to the mode (Notion-style presets)."""
    instruction = (payload.prompt or "").strip()
    context = (payload.context or "").strip()
    mode = (payload.mode or "free").strip().lower()
    language = (payload.language or "").strip()

    style = (
        "Respond ONLY with the requested content in clean Markdown (headings, "
        "lists, **bold**, and tables where appropriate). Do not add an "
        "introduction such as “Here you go” or wrap the entire response in a "
        "code block. Keep the same language as the input text"
    )
    if mode == "translate" and language:
        style += f", except in this case: translate it into {language}."
    else:
        style += "."

    if mode == "continue":
        body = (
            "Continue the following text naturally and coherently by adding one "
            "or two new paragraphs. Do NOT repeat existing content.\n\n"
            f"--- CURRENT TEXT ---\n{context}"
        )
    elif mode == "summarize":
        body = (
            "Create a clear, structured summary of the following content, using "
            f"bullet points where appropriate.\n\n--- CONTENT ---\n{context}"
        )
    elif mode == "improve":
        target = context or instruction
        body = (
            "Rewrite the following text to improve its wording, clarity, and "
            "tone without changing its meaning or language.\n\n"
            f"--- TEXT ---\n{target}"
        )
    elif mode == "translate":
        target = context or instruction
        body = (
            f"Translate the following text faithfully into {language or 'English'}.\n\n"
            f"--- TEXT ---\n{target}"
        )
    else:  # free
        if context:
            body = (
                f"{instruction}\n\nUse this context from the current page as a "
                f"reference when needed:\n--- CONTEXT ---\n{context}"
            )
        else:
            body = instruction or "Write a useful paragraph about the topic."

    return f"{style}\n\n{body}"


@router.post("/generate")
async def generate_content(payload: GeneratePayload):
    """One-shot AI text generation to insert into Vault pages.

    Uses the MODERN path `factory.generate_text` (get_llm + resolve_provider_api_key),
    the same one used by the agent and the «validate» button in Settings › AI. Each call is
    fresh (no caching), so calling «keep writing» twice gives different text.
    Degrades with 503 if no provider is available, never with a hard
    error.
    
    """
    from backend.agent.factory import generate_text

    final_prompt = _build_generation_prompt(payload)
    if not final_prompt.strip() or final_prompt.strip() == ".":
        raise HTTPException(status_code=400, detail="A prompt or context is required.")

    try:
        content, provider = await asyncio.to_thread(
            generate_text, final_prompt, (payload.prompt or ""),
        )
    except RuntimeError as e:
        raise HTTPException(
            status_code=503,
            detail="No AI provider is available. Check Settings › AI.",
        ) from e
    except Exception as e:
        # Invalid/expired key, rate-limit, or permissions → actionable message.
        msg = str(e).lower()
        if any(k in msg for k in ("timeout", "timed out", "timed_out")):
            raise HTTPException(
                status_code=504,
                detail="The AI provider did not respond in time. Try again.",
            ) from e
        if any(k in msg for k in (
            "authentication", "api key", "api_key", "invalid_api_key",
            "unauthor", "permission", "401", "403",
        )):
            raise HTTPException(
                status_code=503,
                detail="The AI provider rejected the key. Check Settings › AI.",
            ) from e
        raise HTTPException(
            status_code=502,
            detail=safe_error_detail(e, context="POST /ai/generate"),
        )

    return {"content": (content or "").strip(), "provider": provider}


class CorrectPayload(BaseModel):
    text: str
    language: Optional[str] = None   # "Catalan" | "Spanish" | "English"… (optional hint)
    scope: Optional[str] = "selection"  # selection | block | page (only for prompt nuance)


_LANG_LABELS = {
    "ca": "Catalan",
    "es": "Spanish",
    "en": "English",
}


@router.post("/correct")
async def correct_text(payload: CorrectPayload):
    """Corrects spelling and grammar of a fragment using AI.

    Sibling of `/ai/generate` but with a strict contract: it returns ONLY the
    corrected text, preserving meaning, tone, language, and format. Meant to be applied to
    a selection, a block, or an entire editor page. Degrades with a 503 if there's
    no provider, never with a hard error.
    
    """
    from backend.agent.factory import generate_text

    text = (payload.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Text is required for correction.")

    hint = (payload.language or "").strip()
    lang_note = f" The text is in {_LANG_LABELS.get(hint, hint)}." if hint else ""

    prompt = (
        "You are a spelling and grammar checker. Correct spelling, diacritics, "
        "punctuation, agreement, and grammar in the following text."
        f"{lang_note} Preserve EXACTLY the same language, meaning, tone, and register. "
        "Do not rewrite the style, summarize, add, or remove ideas. Preserve "
        "Markdown formatting, line breaks, [[wiki]] links, URLs, and code exactly. "
        "Respond ONLY with the corrected text, without quotation marks, "
        "explanations, or comments.\n\n"
        f"--- TEXT ---\n{text}"
    )

    try:
        content, provider = await asyncio.to_thread(
            generate_text, prompt, text[:200],
        )
    except RuntimeError as e:
        raise HTTPException(
            status_code=503,
            detail="No AI provider is available. Check Settings › AI.",
        ) from e
    except Exception as e:
        msg = str(e).lower()
        if any(k in msg for k in ("timeout", "timed out", "timed_out")):
            raise HTTPException(
                status_code=504,
                detail="The AI provider did not respond in time. Try again.",
            ) from e
        if any(k in msg for k in (
            "authentication", "api key", "api_key", "invalid_api_key",
            "unauthor", "permission", "401", "403",
        )):
            raise HTTPException(
                status_code=503,
                detail="The AI provider rejected the key. Check Settings › AI.",
            ) from e
        raise HTTPException(
            status_code=502,
            detail=safe_error_detail(e, context="POST /ai/correct"),
        )

    return {"corrected": (content or "").strip(), "provider": provider}
