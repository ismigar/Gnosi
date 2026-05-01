import asyncio
from pathlib import Path
from typing import Optional

import yaml
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from backend.config.app_config import load_params
from backend.security.ai_credentials import (
    get_ai_catalog_with_status,
    migrate_ai_provider_secrets,
    resolve_provider_api_key,
    sanitize_ai_config,
    set_provider_api_key,
)
from backend.utils.errors import safe_error_detail
from backend.utils.safe_io import safe_write_text


router = APIRouter(prefix="/ai", tags=["AI Settings"])

from backend.agent.factory import get_llm

class ValidatePayload(BaseModel):
    api_key: Optional[str] = None
    base_url: Optional[str] = None
    model: Optional[str] = None

@router.post("/providers/{provider_id}/validate")
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

    # Default models for validation
    default_models = {
        "openai": "gpt-4o-mini",
        "anthropic": "claude-3-5-sonnet-latest",
        "groq": "llama-3.3-70b-versatile",
        "google": "gemini-1.5-flash",
        "openrouter": "openai/gpt-4o-mini"
    }
    target_model = payload.model or default_models.get(provider)

    try:
        llm = get_llm(
            provider=provider,
            model=target_model,
            api_key=api_key,
            base_url=payload.base_url
        )
        
        if not llm:
            return {"success": False, "error": f"No s'ha pogut instanciar el proveïdor {provider}. Revisa que la dependència o la clau API siguin correctos. Model: {target_model}"}
            
        # Intent d'invocació mínima — to_thread evita bloquejar l'event loop
        # (alguns LLMs no exposen `ainvoke` o el seu sync n'és el primary path).
        from langchain_core.messages import HumanMessage
        response = await asyncio.to_thread(
            llm.invoke,
            [HumanMessage(content="Digues 'ok'")],
            config={"timeout": 10},
        )

        return {"success": True, "response": response.content}
    except Exception as e:
        error_msg = str(e)
        if "API key" in error_msg:
            return {"success": False, "error": f"Clau API invàlida per a {provider.capitalize()}."}
        return {"success": False, "error": safe_error_detail(e, context=f"POST /ai/providers/{provider}/validate")}



# Note: We now fetch the dynamic path from app_config at runtime


class ProviderCredentialPayload(BaseModel):
    api_key: str
    base_url: Optional[str] = ""


@router.get("/catalog")
async def get_ai_catalog():
    cfg = load_params(strict_env=False)
    ai_cfg = dict(cfg.get("ai", {}) or {})
    return {
        "catalog": get_ai_catalog_with_status(ai_cfg),
        "config": sanitize_ai_config(ai_cfg),
    }


@router.post("/providers/{provider_id}/credentials")
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

    # Atomic write: params.yaml conté tota la config principal de l'app
    # (incluint provider AI). Un crash a meitat el deixaria corrupte.
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


@router.delete("/providers/{provider_id}")
async def delete_provider(provider_id: str):
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
    
    if provider in providers:
        providers.pop(provider)
        ai_cfg["providers"] = providers
        current_config["ai"] = ai_cfg

        yaml_text = yaml.safe_dump(
            current_config, default_flow_style=False,
            allow_unicode=True, sort_keys=False,
        )
        safe_write_text(params_path, yaml_text)
        return {"status": "success", "message": f"Provider {provider} deleted"}
    
    return {"status": "skipped", "message": f"Provider {provider} not found in config"}


@router.patch("/providers/{provider_id}/status")
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