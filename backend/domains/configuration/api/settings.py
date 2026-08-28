import inspect
import logging
import os
from pathlib import Path
from typing import Any, cast

import yaml
from fastapi import APIRouter, Depends, HTTPException, Request

from backend.config.app_config import load_params
from backend.security.ai_credentials import migrate_ai_provider_secrets, sanitize_ai_config
from backend.services.workspace_service import require_role
from backend.utils.errors import safe_error_detail
from backend.utils.safe_io import safe_write_text

# Auth gate: config contains the AI provider, vault paths, and mode (personal/org).
# require_role("admin") is a no-op in personal mode (user is auto-owner) but
# blocks access in organization mode.
router = APIRouter(dependencies=[Depends(require_role("admin"))])
log = logging.getLogger(__name__)

# Note: We now fetch the dynamic path from app_config at runtime


@router.get("/config", response_model=None)
async def get_config() -> Any:
    try:
        # Reload params to get the latest version from disk
        cfg = load_params(strict_env=False)
        # Absolute origin trace of the function for debugging
        source_file = inspect.getfile(load_params)
        log.info(f"DEBUG: load_params loaded from: {source_file}")

        safe_params = dict(cfg.params or {})

        # 1. Resolve and inject paths for UI display
        # We ensure that the frontend sees the actual path being used by the backend.
        if "paths" not in safe_params:
            safe_params["paths"] = {}

        # If vault is not in params but we have it resolved, inject it.
        # This fixes the issue where the vault path appears empty in settings.
        # We prioritize VAULT_HOST_PATH (if set via Docker) so the user sees the real path on their machine.
        vault_ui_path = os.environ.get("VAULT_HOST_PATH") or (
            str(cfg.paths.get("VAULT")) if cfg.paths.get("VAULT") else ""
        )
        if vault_ui_path:
            safe_params["paths"]["vault"] = vault_ui_path

        # 2. Sanitize system password
        settings = safe_params.get("settings", {})
        if "password" in settings or "gnosi_mode" in settings:
            from backend.security.keychain_manager import get_keychain

            # We don't want to send the actual password to the frontend
            # but we want to let it know if one is set.
            has_pwd = bool(settings.get("password")) or get_keychain().has_credential(
                "system_password"
            )
            settings["has_password"] = has_pwd
            settings.pop("password", None)
            safe_params["settings"] = settings

        safe_params["ai"] = sanitize_ai_config(dict(safe_params.get("ai") or {}))
        log.info("DEBUG: Config loaded and AI secrets sanitized for API response")
        return safe_params
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


async def _request_config(request: Request) -> dict[str, Any]:
    """Read one non-empty JSON object while retaining legacy error handling."""
    payload: object = await request.json()
    if not payload:
        raise HTTPException(status_code=400, detail="No data provided")
    if not isinstance(payload, dict):
        raise TypeError("Configuration payload must be a JSON object")
    return {str(key): value for key, value in payload.items()}


def _validate_llm_wiki_agent(current_ai: object, new_config: dict[str, Any]) -> None:
    """Prevent a generic Settings save from removing the managed Wiki agent."""
    ai_payload = new_config.get("ai")
    if not isinstance(ai_payload, dict):
        return
    from backend.services.llm_wiki_agent import LlmWikiAgentError, validate_agent_preserved

    try:
        validate_agent_preserved(current_ai, ai_payload)
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


@router.post("/config", response_model=None)
async def update_config(request: Request) -> Any:
    try:
        new_config = await _request_config(request)

        # Never log the raw payload: it carries the system password and AI API
        # keys in cleartext. Log only which top-level sections were sent.
        log.info(f"POST /config received. Sections: {list(new_config.keys())}")

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

        # 1. Migrate system password if sent
        _migrate_system_password(new_config)

        # Merge data and preserve unsent keys
        merged_config = deep_merge(current_config, new_config)

        _validate_agent_strategies(new_config, merged_config)

        # For AI providers, frontend sends the full desired map.
        # Replace instead of deep-merging to allow deleting removed providers.
        _replace_provider_map(new_config, merged_config)
        _secure_ai_config(merged_config)

        # Do not log the raw AI config: it contains provider api_key values.
        # The sanitized summary below is enough for debugging.
        if "ai" in merged_config:
            log.info(
                f"Final AI Config to save (sanitized): {sanitize_ai_config(merged_config['ai'])}"
            )

        log.info(f"Final configuration to save (summary): {list(merged_config.keys())}")

        # Atomic write: params.yaml is the app's main config. A crash
        # mid safe_dump would leave the YAML truncated and the next restart
        # from the backend would expire on load_params.
        _write_config(params_path, merged_config)

        # We do NOT force any server restart. Previously we did `touch backend/server.py`
        # so uvicorn --reload would reload the process on EVERY config save, but:
        #   - load_params() re-reads params.yaml fresh on every request → changes already
        #     they are applied without restarting;
        #   - the restart brings down the backend for 30-60s (reindexing), kills any work in
        #     course (e.g. a full Notion CLONE, 2026-07-04 incident) and chains
        #     the native watchdog (kickstart -k) when startup takes longer than the grace period;
        #   - with the Settings panel's autosave, this used to happen on every edit.
        log.info("File params.yaml updated successfully.")

        # The agent graph IS cached per agent (app.state.agent_cache) and bakes in the
        # persona, the model and the tools scoped to the attached context sources. Without
        # this eviction an edited agent keeps answering with its previous configuration
        # until the process restarts.
        _evict_agent_cache(request, new_config)

        return {"status": "success", "message": "Configuration updated"}

    except HTTPException:
        raise
    except Exception as e:
        log.error(f"Error updating config: {e}")
        raise HTTPException(status_code=500, detail=safe_error_detail(e, context="POST /config"))
