from pathlib import Path
from typing import Optional

import yaml
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from backend.config.app_config import load_params
from backend.security.ai_credentials import (
    get_ai_catalog_with_status,
    migrate_ai_provider_secrets,
    sanitize_ai_config,
    set_provider_api_key,
)


router = APIRouter(prefix="/ai", tags=["AI Settings"])

PARAMS_PATH = Path(__file__).resolve().parents[2] / "config" / "params.yaml"


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

    current_config = {}
    if PARAMS_PATH.exists():
        with open(PARAMS_PATH, "r", encoding="utf-8") as f:
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

    with open(PARAMS_PATH, "w", encoding="utf-8") as f:
        yaml.safe_dump(
            current_config,
            f,
            default_flow_style=False,
            allow_unicode=True,
            sort_keys=False,
        )

    return {
        "status": "success",
        "provider": provider,
        "credential_ref": credential_ref,
        "has_api_key": True,
    }