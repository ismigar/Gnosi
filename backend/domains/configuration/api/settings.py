import asyncio
import copy
import logging
import os
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any, cast

import yaml
from fastapi import APIRouter, Depends, HTTPException, Request

from backend.config.app_config import load_params
from backend.domains.configuration.config_response_cache import ConfigResponseCache
from backend.domains.configuration.settings_schemas import (
    ConfigurationDocument,
    ConfigurationUpdateRequest,
    ConfigurationUpdateResponse,
)
from backend.security.ai_credentials import (
    migrate_ai_provider_secrets,
    sanitize_ai_config,
    sanitize_ai_config_concurrently,
)
from backend.services.context_vars import active_vault_path
from backend.services.workspace_service import require_role
from backend.utils.errors import safe_error_detail
from backend.utils.safe_io import safe_write_text

# Auth gate: config contains the AI provider, vault paths, and mode (personal/org).
# require_role("admin") is a no-op in personal mode (user is auto-owner) but
# blocks access in organization mode.
router = APIRouter(dependencies=[Depends(require_role("admin"))])
log = logging.getLogger(__name__)
_CONFIG_RESPONSE_CACHE = ConfigResponseCache()

# Note: We now fetch the dynamic path from app_config at runtime


def _config_context_key() -> str:
    """Identify a vault without reading configuration or including secrets."""
    active = active_vault_path.get()
    configured = os.environ.get("DIGITAL_BRAIN_VAULT_PATH")
    host_path = os.environ.get("VAULT_HOST_PATH")
    return "\x1f".join((str(active or ""), configured or "", host_path or ""))


def _read_config_document() -> dict[str, object]:
    """Read and sanitize Settings data in one blocking worker unit."""
    cfg = load_params(strict_env=False)

    safe_params: dict[str, Any] = copy.deepcopy(cfg.params or {})
    if "paths" not in safe_params:
        safe_params["paths"] = {}

    vault_ui_path = os.environ.get("VAULT_HOST_PATH") or (
        str(cfg.paths.get("VAULT")) if cfg.paths.get("VAULT") else ""
    )
    if vault_ui_path:
        safe_params["paths"]["vault"] = vault_ui_path

    settings = safe_params.get("settings", {})
    check_system_password = isinstance(settings, dict) and (
        "password" in settings or "gnosi_mode" in settings
    )

    def has_system_password() -> bool:
        from backend.security.keychain_manager import get_keychain

        assert isinstance(settings, dict)
        return bool(settings.get("password")) or get_keychain().has_credential("system_password")

    ai_config = dict(safe_params.get("ai") or {})
    with ThreadPoolExecutor(max_workers=2, thread_name_prefix="config-secrets") as pool:
        ai_future = pool.submit(sanitize_ai_config_concurrently, ai_config)
        password_future = pool.submit(has_system_password) if check_system_password else None
        sanitized_ai = ai_future.result()
        has_pwd = password_future.result() if password_future is not None else None

    if isinstance(settings, dict) and check_system_password:
        settings["has_password"] = has_pwd
        settings.pop("password", None)
        safe_params["settings"] = settings

    safe_params["ai"] = sanitized_ai
    return safe_params


@router.get("/config", response_model=ConfigurationDocument)
async def get_config() -> Any:
    try:
        key = _config_context_key()
        return await asyncio.to_thread(
            _CONFIG_RESPONSE_CACHE.get_or_load,
            key,
            _read_config_document,
        )
    except Exception as e:
        log.error(f"Error reading config: {e}")
        raise HTTPException(status_code=500, detail=safe_error_detail(e, context="GET /config"))


def deep_merge(
    dict1: dict[str, Any],
    dict2: dict[str, Any],
) -> dict[str, Any]:
    """Recursively merges dict2 into dict1."""
    for k, v in dict2.items():
        if isinstance(v, dict) and k in dict1 and isinstance(dict1[k], dict):
            deep_merge(cast(dict[str, Any], dict1[k]), cast(dict[str, Any], v))
        else:
            dict1[k] = v
    return dict1


def _request_config(payload: ConfigurationUpdateRequest) -> dict[str, Any]:
    """Read one non-empty JSON object while retaining legacy error handling."""
    value = payload.root
    if not value:
        raise HTTPException(status_code=400, detail="No data provided")
    if not isinstance(value, dict):
        raise TypeError("Configuration payload must be a JSON object")
    return {str(key): item for key, item in value.items()}


def _validate_llm_wiki_agent(current_ai: object, new_config: dict[str, Any]) -> None:
    """Prevent a generic Settings save from removing the managed Wiki agent."""
    ai_payload = new_config.get("ai")
    if not isinstance(ai_payload, dict):
        return
    from backend.services.llm_wiki_agent import LlmWikiAgentError, validate_agent_preserved

    try:
        current_ai_payload = (
            cast(dict[str, Any], current_ai) if isinstance(current_ai, dict) else {}
        )
        validate_agent_preserved(current_ai_payload, ai_payload)
    except LlmWikiAgentError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


def _load_current_config(params_path: Path) -> dict[str, Any]:
    """Load persisted YAML as an object before applying a partial update."""
    if not params_path.exists():
        return {}
    loaded: object = yaml.safe_load(params_path.read_text(encoding="utf-8")) or {}
    if not isinstance(loaded, dict):
        raise TypeError("Persisted configuration must be a YAML object")
    return {str(key): value for key, value in loaded.items()}


def _migrate_system_password(new_config: dict[str, Any]) -> None:
    """Move a posted system password into secure storage and out of YAML."""
    settings = new_config.get("settings")
    if not isinstance(settings, dict) or "password" not in settings:
        return
    password = settings["password"]
    if password and password != "********":
        from backend.security.keychain_manager import get_keychain

        get_keychain().save_credential("system_password", password)
        log.info("System password migrated to secure storage")
    settings.pop("password", None)


def _validate_agent_strategies(
    new_config: dict[str, Any],
    merged_config: dict[str, Any],
) -> None:
    """Validate explicit agent rows against the current model registry."""
    ai_payload = new_config.get("ai")
    if not isinstance(ai_payload, dict) or "agents" not in ai_payload:
        return
    from backend.agent.model_router import load_registry
    from backend.services.agent_model_strategy import validate_model_strategies

    try:
        ai_config = merged_config.setdefault("ai", {})
        if not isinstance(ai_config, dict):
            ai_config = {}
            merged_config["ai"] = ai_config
        ai_config["agents"] = validate_model_strategies(
            ai_payload.get("agents") or [],
            load_registry(),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


def _replace_provider_map(
    new_config: dict[str, Any],
    merged_config: dict[str, Any],
) -> None:
    """Treat providers as desired state so deletion survives deep merge."""
    ai_payload = new_config.get("ai")
    if not isinstance(ai_payload, dict) or "providers" not in ai_payload:
        return
    merged_ai = merged_config.get("ai")
    if not isinstance(merged_ai, dict):
        merged_ai = {}
        merged_config["ai"] = merged_ai
    providers = ai_payload.get("providers") or {}
    if not isinstance(providers, dict):
        raise TypeError("AI providers must be a JSON object")
    merged_ai["providers"] = dict(providers)


def _secure_ai_config(merged_config: dict[str, Any]) -> None:
    """Move provider credentials out of the configuration document."""
    ai_value = merged_config.get("ai") or {}
    if not isinstance(ai_value, dict):
        raise TypeError("AI configuration must be a JSON object")
    migrated_ai, migrated = migrate_ai_provider_secrets(dict(ai_value))
    merged_config["ai"] = migrated_ai
    if migrated:
        log.info("AI provider secrets migrated to secure storage")


def _write_config(params_path: Path, merged_config: dict[str, Any]) -> None:
    """Persist complete YAML through the application's atomic writer."""
    yaml_text = yaml.safe_dump(
        merged_config,
        default_flow_style=False,
        allow_unicode=True,
        sort_keys=False,
    )
    safe_write_text(params_path, yaml_text)


def _evict_agent_cache(request: Request, new_config: dict[str, Any]) -> None:
    """Invalidate compiled agents after any AI configuration change."""
    if "ai" not in new_config:
        return
    cache = getattr(request.app.state, "agent_cache", None)
    if cache:
        cache.clear()
        log.info("Agent graph cache evicted after an AI configuration change.")


def _update_config_document(new_config: dict[str, Any]) -> None:
    """Apply one complete configuration transaction in a blocking worker."""
    # Retrieve the current configuration
    cfg = load_params(strict_env=False)
    params_path = cfg.params_source

    # The LLM Wiki profile is created by the plugin lifecycle and may be
    # edited here like any other agent. It must not be silently removed by
    # a generic Settings save: disabling the plugin is the deliberate,
    # confirmed removal path.
    if isinstance(new_config.get("ai"), dict):
        _validate_llm_wiki_agent(cfg.ai, new_config)
    current_config = _load_current_config(params_path)

    _migrate_system_password(new_config)
    merged_config = deep_merge(current_config, new_config)
    _validate_agent_strategies(new_config, merged_config)
    _replace_provider_map(new_config, merged_config)
    _secure_ai_config(merged_config)

    if "ai" in merged_config:
        log.info(
            "Final AI Config to save (sanitized): %s",
            sanitize_ai_config(merged_config["ai"]),
        )
    log.info("Final configuration to save (summary): %s", list(merged_config.keys()))
    _write_config(params_path, merged_config)
    log.info("File params.yaml updated successfully.")


@router.post("/config", response_model=ConfigurationUpdateResponse)
async def update_config(payload: ConfigurationUpdateRequest, request: Request) -> Any:
    try:
        new_config = _request_config(payload)
        log.info("POST /config received. Sections: %s", list(new_config.keys()))
        key = _config_context_key()
        await asyncio.to_thread(
            _CONFIG_RESPONSE_CACHE.update,
            key,
            lambda: _update_config_document(new_config),
        )
        _evict_agent_cache(request, new_config)

        return {"status": "success", "message": "Configuration updated"}

    except HTTPException:
        raise
    except Exception as e:
        log.error(f"Error updating config: {e}")
        raise HTTPException(status_code=500, detail=safe_error_detail(e, context="POST /config"))
