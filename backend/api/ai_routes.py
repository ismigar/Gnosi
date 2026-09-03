import asyncio
import os
from pathlib import Path
from typing import Any, cast

import yaml
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, JsonValue

from backend.config.app_config import load_params
from backend.config.env_config import remove_env_keys
from backend.domains.configuration.ai.contracts import (
    AiCatalogResponse,
    AiUsageHistoryResponse,
    AiUsageResponse,
    ModelCatalogResponse,
    ModelComparisonResponse,
    ModelRegistryResponse,
    ModelRegistryUpdateResponse,
    ModelsPayload,
    ProviderCredentialsResponse,
    ProviderDeletionResponse,
    ProviderStatusResponse,
    ProviderValidationResponse,
)
from backend.domains.configuration.ai.content_routes import (
    CorrectPayload,
    GeneratePayload,
    build_generation_prompt as _build_generation_prompt,
    correct_text,
    generate_content,
    router as content_router,
)
from backend.security.ai_credentials import (
    env_keys_for_provider,
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
JsonObject = dict[str, Any]


def _load_yaml_mapping(path: Path) -> JsonObject:
    """Load one YAML object, rejecting non-mapping configuration roots."""
    if not path.exists():
        return {}
    with path.open("r", encoding="utf-8") as stream:
        loaded = yaml.safe_load(stream)
    return cast(JsonObject, loaded) if isinstance(loaded, dict) else {}


def _evict_agent_graphs(request: Request) -> None:
    """Drop workflows that embed model, provider, and tool capability state."""
    cache = getattr(request.app.state, "agent_cache", None)
    if cache:
        cache.clear()


from backend.agent.factory import get_llm


class ValidatePayload(BaseModel):
    api_key: str | None = None
    base_url: str | None = None
    model: str | None = None


@router.post(
    "/providers/{provider_id}/validate",
    dependencies=[Depends(require_role("admin"))],
    response_model=ProviderValidationResponse,
    response_model_exclude_unset=True,
)
async def validate_provider(
    provider_id: str,
    payload: ValidatePayload,
) -> dict[str, JsonValue]:
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
        return {
            "success": False,
            "error": f"Falta la clau API per validar el proveïdor {provider.capitalize()}.",
        }

    # Ping model: explicit payload > cheapest model from the live catalog >
    # legacy hardcoded fallback. The hardcoded ids rot (providers retire them —
    # e.g. OpenRouter dropped its gpt-4o-mini alias) and then the ping fails
    # even with a valid key; the catalog tracks what actually exists.
    default_models = {
        "openai": "gpt-4o-mini",
        "anthropic": "claude-3-5-haiku-latest",
        "groq": "llama-3.3-70b-versatile",
        "google": "gemini-1.5-flash",
        "openrouter": "openai/gpt-4o-mini",
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
            return {
                "success": False,
                "error": f"Could not instantiate provider {provider}. Check the dependency and API key. Model: {target_model}",
            }

        # Minimal invocation attempt — to_thread avoids blocking the event loop
        # (some LLMs don't expose `ainvoke` or their sync version is the primary path).
        from langchain_core.messages import HumanMessage

        response = await asyncio.to_thread(
            llm.invoke,
            [HumanMessage(content="Say 'ok'")],
        )

        return ProviderValidationResponse.model_validate(
            {"success": True, "response": response.content}
        ).model_dump(exclude_unset=True)
    except Exception as e:
        error_msg = str(e)
        # Groq/OpenAI SDKs raise AuthenticationError/401 without the literal
        # words "API key" — without this match a bad key surfaced as a cryptic
        # "Internal error [hash]" instead of the actionable message.
        if any(
            marker in error_msg
            for marker in ("API key", "AuthenticationError", "401", "Unauthorized")
        ):
            return {"success": False, "error": f"Clau API invàlida per a {provider.capitalize()}."}
        return {
            "success": False,
            "error": safe_error_detail(e, context=f"POST /ai/providers/{provider}/validate"),
        }


# Note: We now fetch the dynamic path from app_config at runtime


class ProviderCredentialPayload(BaseModel):
    api_key: str
    base_url: str | None = ""


def _set_provider_disconnected(ai_cfg: JsonObject, provider: str, disconnected: bool) -> bool:
    """Update the persistent provider tombstone and report whether it changed."""
    current = {
        str(item).strip().lower()
        for item in (ai_cfg.get("disconnected_providers") or [])
        if str(item).strip()
    }
    before = set(current)
    if disconnected:
        current.add(provider)
    else:
        current.discard(provider)
    if current:
        ai_cfg["disconnected_providers"] = sorted(current)
    else:
        ai_cfg.pop("disconnected_providers", None)
    return current != before


@router.get(
    "/catalog",
    response_model=AiCatalogResponse,
    response_model_exclude_unset=True,
)
async def get_ai_catalog() -> JsonObject:
    # to_thread: the provider list is now fed by the model catalog, whose
    # loader does blocking I/O (disk cache / short HTTP fetches).
    def _load() -> JsonObject:
        cfg = load_params(strict_env=False)
        ai_cfg = dict(cfg.get("ai", {}) or {})
        return {
            "catalog": get_ai_catalog_with_status(ai_cfg),
            "config": sanitize_ai_config(ai_cfg),
        }

    return await asyncio.to_thread(_load)


@router.post(
    "/providers/{provider_id}/credentials",
    dependencies=[Depends(require_role("admin"))],
    response_model=ProviderCredentialsResponse,
)
async def set_provider_credentials(
    provider_id: str,
    payload: ProviderCredentialPayload,
    request: Request,
) -> dict[str, JsonValue]:
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
    current_config = _load_yaml_mapping(params_path)

    ai_cfg = dict(current_config.get("ai") or {})
    providers = dict(ai_cfg.get("providers") or {})
    provider_cfg = dict(providers.get(provider) or {})
    provider_cfg["credential_ref"] = credential_ref
    provider_cfg.pop("api_key", None)
    if payload.base_url is not None:
        provider_cfg["base_url"] = payload.base_url
    providers[provider] = provider_cfg
    ai_cfg["providers"] = providers
    _set_provider_disconnected(ai_cfg, provider, False)

    migrated_ai_cfg, _ = migrate_ai_provider_secrets(ai_cfg)
    current_config["ai"] = migrated_ai_cfg

    # Atomic write: params.yaml contains all the app's main config
    # (including AI provider). A crash halfway through would leave it corrupted.
    yaml_text = yaml.safe_dump(
        current_config,
        default_flow_style=False,
        allow_unicode=True,
        sort_keys=False,
    )
    safe_write_text(params_path, yaml_text)
    _evict_agent_graphs(request)

    return {
        "status": "success",
        "provider": provider,
        "credential_ref": credential_ref,
        "has_api_key": True,
    }


class ProviderStatusPayload(BaseModel):
    enabled: bool


def _registry_rows_without_provider(
    effective_registry: list[JsonObject], provider: str
) -> tuple[list[JsonObject], int]:
    """(filtered_rows, removed_count) — pure, so the cascade is testable.

    `effective_registry` is what the router actually uses (ai.models, or the
    seed default when unset): filtering THAT list is what makes the cascade
    also clear seed rows of a deleted provider instead of leaving phantoms.
    """
    filtered = [m for m in (effective_registry or []) if (m or {}).get("provider") != provider]
    return filtered, len(effective_registry or []) - len(filtered)


@router.delete(
    "/providers/{provider_id}",
    dependencies=[Depends(require_role("admin"))],
    response_model=ProviderDeletionResponse,
)
async def delete_provider(
    provider_id: str,
    request: Request,
) -> dict[str, JsonValue]:
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

    def _delete() -> JsonObject:
        from backend.agent.model_router import load_registry
        from backend.security.ai_credentials import credential_key_for_provider
        from backend.security.keychain_manager import get_keychain

        cfg = load_params(strict_env=False)
        params_path = cfg.params_source
        current_config = _load_yaml_mapping(params_path)

        ai_cfg = dict(current_config.get("ai") or {})
        providers = dict(ai_cfg.get("providers") or {})
        existed = provider in providers
        providers.pop(provider, None)
        ai_cfg["providers"] = providers
        tombstone_changed = _set_provider_disconnected(ai_cfg, provider, True)

        # Cascade: drop the provider's rows from the effective registry
        # (raw stored prices — this is persisted config, not display data)
        effective = load_registry(with_catalog_prices=False)
        filtered, removed_models = _registry_rows_without_provider(effective, provider)
        if removed_models:
            ai_cfg["models"] = filtered

        current_config["ai"] = ai_cfg
        if existed or removed_models or tombstone_changed:
            yaml_text = yaml.safe_dump(
                current_config,
                default_flow_style=False,
                allow_unicode=True,
                sort_keys=False,
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
        env_keys_deleted = remove_env_keys(env_keys_for_provider(provider))

        if not existed and not removed_models and not tombstone_changed:
            return {
                "status": "skipped",
                "message": f"Provider {provider} not found in config",
                "removed_models": 0,
                "credential_deleted": credential_deleted,
                "env_keys_deleted": env_keys_deleted,
            }
        return {
            "status": "success",
            "message": f"Provider {provider} deleted",
            "removed_models": removed_models,
            "credential_deleted": credential_deleted,
            "env_keys_deleted": env_keys_deleted,
        }

    # to_thread: params.yaml I/O + registry load + keychain access are blocking
    result = await asyncio.to_thread(_delete)
    _evict_agent_graphs(request)
    return result


@router.patch(
    "/providers/{provider_id}/status",
    dependencies=[Depends(require_role("admin"))],
    response_model=ProviderStatusResponse,
)
async def update_provider_status(
    provider_id: str,
    payload: ProviderStatusPayload,
    request: Request,
) -> dict[str, JsonValue]:
    provider = (provider_id or "").strip().lower()
    if not provider:
        raise HTTPException(status_code=400, detail="provider_id is required")

    cfg = load_params(strict_env=False)
    params_path = cfg.params_source
    current_config = _load_yaml_mapping(params_path)

    ai_cfg = dict(current_config.get("ai") or {})
    providers = dict(ai_cfg.get("providers") or {})
    provider_cfg = dict(providers.get(provider) or {})

    provider_cfg["enabled"] = payload.enabled
    providers[provider] = provider_cfg
    ai_cfg["providers"] = providers
    if payload.enabled:
        _set_provider_disconnected(ai_cfg, provider, False)
    current_config["ai"] = ai_cfg

    yaml_text = yaml.safe_dump(
        current_config,
        default_flow_style=False,
        allow_unicode=True,
        sort_keys=False,
    )
    safe_write_text(params_path, yaml_text)
    _evict_agent_graphs(request)

    return {"status": "success", "provider": provider, "enabled": payload.enabled}


# ---------------------------------------------------------------------------
# Router model registry (data-driven) + budget policy
# cf. backend/agent/model_router.py i directiva vault_knowledge_agents.md
# ---------------------------------------------------------------------------
@router.get(
    "/models",
    response_model=ModelRegistryResponse,
    response_model_exclude_unset=True,
)
async def get_model_registry() -> JsonObject:
    """Returns the router's model registry (config `ai.models`, or the default)
    and the budget policy (`ai.budget`).

    Prices come refreshed from the catalog (each row carries
    `price_from_catalog` / `price_unknown`), so the UI never shows a tariff
    that went stale in params.yaml. to_thread: load_registry now consults the
    catalog, whose loader does blocking I/O.
    """
    from backend.agent.model_router import (
        DEFAULT_REGISTRY,
        hydrate_registry_metadata,
        load_registry,
        strip_legacy_registry_rows,
    )
    from backend.services.fx_rates import parse_currency_code, rate_info

    def _load() -> JsonObject:
        cfg = load_params(strict_env=False)
        ai_cfg = dict(cfg.get("ai", {}) or {})
        configured_models = ai_cfg.get("models")
        currency = rate_info(
            parse_currency_code((cfg.get("settings", {}) or {}).get("currency"))
        )
        return {
            "models": load_registry(),
            "configured_models": hydrate_registry_metadata(
                strip_legacy_registry_rows(configured_models)
            ),
            "budget": dict(ai_cfg.get("budget") or {}),
            "default": DEFAULT_REGISTRY,
            "currency": currency,
        }

    return await asyncio.to_thread(_load)


@router.get(
    "/model-catalog",
    response_model=ModelCatalogResponse,
    response_model_exclude_unset=True,
)
async def get_model_catalog(refresh: bool = False) -> JsonObject:
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

    def _load() -> JsonObject:
        catalog = load_catalog(refresh)
        providers_cfg = dict(
            (load_params(strict_env=False).get("ai", {}) or {}).get("providers") or {}
        )
        # Copy before annotating: load_catalog memoizes and returns the SAME
        # dict across requests — mutating it would freeze a stale connection
        # state into the cache.
        annotated = dict(catalog)
        annotated_providers: list[JsonObject] = []
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
            annotated_providers.append(
                {
                    **entry,
                    "connected": connected,
                    "configured": configured,
                    "enabled": (provider_cfg or {}).get("enabled", True),
                    "has_api_key": has_api_key,
                    "base_url": (provider_cfg or {}).get("base_url", ""),
                }
            )
        annotated["providers"] = annotated_providers
        return annotated

    return await asyncio.to_thread(_load)


@router.get(
    "/model-comparison",
    response_model=ModelComparisonResponse,
    response_model_exclude_unset=True,
)
async def get_model_comparison() -> JsonObject:
    """Complete, freshly paginated Artificial Analysis language-model feed."""
    from backend.services.artificial_analysis import (
        ArtificialAnalysisError,
        fetch_all_models,
    )
    from backend.services.fx_rates import parse_currency_code, rate_info

    try:
        def _load() -> JsonObject:
            res = fetch_all_models()
            cfg = load_params(strict_env=False)
            currency = rate_info(
                parse_currency_code((cfg.get("settings", {}) or {}).get("currency"))
            )
            if isinstance(res, dict):
                res["currency"] = currency
            return res

        res = await asyncio.to_thread(_load)
        return res
    except ArtificialAnalysisError as exc:
        raise HTTPException(
            status_code=exc.status_code,
            detail={"code": exc.code},
        ) from exc


@router.get(
    "/usage",
    response_model=AiUsageResponse,
    response_model_exclude_unset=True,
)
async def get_ai_usage() -> JsonObject:
    """Current-period AI spend: USD + the Settings currency, cap, ratio and a
    per-model breakdown. to_thread: reads the ledger from disk and may do one
    short FX fetch."""
    from backend.agent.model_router import budget_status

    return await asyncio.to_thread(budget_status)


@router.get(
    "/usage/history",
    response_model=AiUsageHistoryResponse,
    response_model_exclude_unset=True,
)
async def get_ai_usage_history() -> JsonObject:
    """Returns all historical usage records grouped by period, provider, and model."""
    from backend.agent.model_router import UsageStore, _normalize_usage_entry
    from backend.config.app_config import load_params
    from backend.services.fx_rates import parse_currency_code, rate_info, usd_to_currency

    def _history() -> JsonObject:
        store = UsageStore()
        cfg = load_params(strict_env=False)
        currency = rate_info(parse_currency_code((cfg.get("settings", {}) or {}).get("currency")))
        periods: JsonObject = {}
        for period_key, model_data in (store._data or {}).items():
            if not isinstance(model_data, dict):
                continue
            period_rows: list[JsonObject] = []
            period_total_usd = 0.0
            for key, val in model_data.items():
                if ":" in key:
                    provider, model_id = key.split(":", 1)
                else:
                    provider, model_id = "", key
                norm = _normalize_usage_entry(val)
                cost_ccy = usd_to_currency(norm["cost_usd"], currency["code"])
                period_rows.append(
                    {
                        "provider": provider,
                        "model_id": model_id,
                        "in": norm["in"],
                        "out": norm["out"],
                        "cost_usd": norm["cost_usd"],
                        "cost_ccy": cost_ccy,
                    }
                )
                period_total_usd += norm["cost_usd"]
            periods[period_key] = {
                "period": period_key,
                "total_usd": period_total_usd,
                "total_ccy": usd_to_currency(period_total_usd, currency["code"]),
                "models": period_rows,
            }
        return {
            "currency": currency,
            "periods": periods,
        }

    return await asyncio.to_thread(_history)


def _sanitize_budget(raw: JsonObject) -> JsonObject:
    """Keep only known budget keys, safely typed; drop everything else."""
    budget: JsonObject = {
        "prefer_local": bool(raw.get("prefer_local")),
        "prefer_local_below": int(raw.get("prefer_local_below") or 0),
        "enforce_block": bool(raw.get("enforce_block")),
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


@router.put(
    "/models",
    dependencies=[Depends(require_role("admin"))],
    response_model=ModelRegistryUpdateResponse,
)
async def set_model_registry(payload: ModelsPayload, request: Request) -> JsonObject:
    """Saves the model registry and the budget policy to params.yaml.

    Prices are NOT taken from the payload: the catalog owns them (the UI shows
    them read-only). What lands in params.yaml is the catalog price, kept as an
    offline snapshot; only models the catalog doesn't know fall back to the
    client's value, so custom endpoints keep whatever they had.
    """
    if not isinstance(payload.models, list):
        raise HTTPException(status_code=400, detail="models ha de ser una llista")

    from backend.agent.model_catalog import (
        catalog_model_metadata_index,
        catalog_price_index,
    )
    from backend.agent.model_router import hydrate_registry_metadata

    cfg = load_params(strict_env=False)
    params_path = cfg.params_source
    current_config = _load_yaml_mapping(params_path)
    ai_cfg = dict(current_config.get("ai") or {})
    current_rows = [dict(row) for row in (ai_cfg.get("models") or []) if isinstance(row, dict)]
    current_by_key = {
        (
            str(row.get("provider") or "").strip().lower(),
            str(row.get("model_id") or "").strip(),
        ): row
        for row in current_rows
    }
    price_index, metadata_index = await asyncio.gather(
        asyncio.to_thread(catalog_price_index),
        asyncio.to_thread(catalog_model_metadata_index),
    )

    # Minimal validation of each entry
    cleaned: list[JsonObject] = []
    for m in payload.models:
        if not isinstance(m, dict) or not m.get("provider") or not m.get("model_id"):
            raise HTTPException(status_code=400, detail="cada model necessita provider i model_id")
        provider = str(m["provider"]).strip().lower()
        model_id = str(m["model_id"]).strip()
        candidate = {
            **current_by_key.get((provider, model_id), {}),
            **m,
            "provider": provider,
            "model_id": model_id,
        }
        effective = hydrate_registry_metadata(
            [candidate],
            metadata_index,
        )[0]
        rates = price_index.get(f"{provider}:{model_id}")
        cleaned.append(
            {
                "provider": provider,
                "model_id": model_id,
                "is_local": bool(effective.get("is_local", False)),
                "enabled": bool(effective.get("enabled", True)),
                "priority": int(effective.get("priority") or 100),
                "cost_in": rates["cost_in"] if rates else float(effective.get("cost_in") or 0),
                "cost_out": rates["cost_out"] if rates else float(effective.get("cost_out") or 0),
                "context_window": int(effective.get("context_window") or 8192),
                "quality": int(effective.get("quality") or 2),
                "tags": [str(t) for t in (effective.get("tags") or [])],
                **(
                    {"monthly_quota": int(effective["monthly_quota"])}
                    if effective.get("monthly_quota")
                    else {}
                ),
                **({"endpoint": str(effective["endpoint"])} if effective.get("endpoint") else {}),
            }
        )
    ai_cfg["models"] = cleaned
    if payload.budget is not None:
        ai_cfg["budget"] = _sanitize_budget(dict(payload.budget))
    current_config["ai"] = ai_cfg

    yaml_text = yaml.safe_dump(
        current_config,
        default_flow_style=False,
        allow_unicode=True,
        sort_keys=False,
    )
    safe_write_text(params_path, yaml_text)
    _evict_agent_graphs(request)
    return {"status": "success", "count": len(cleaned)}


router.include_router(content_router)
