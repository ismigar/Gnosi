from fastapi import APIRouter, Depends, HTTPException, Request
from backend.config.app_config import load_params
from backend.security.ai_credentials import migrate_ai_provider_secrets, sanitize_ai_config
from backend.services.workspace_service import require_role
from backend.utils.errors import safe_error_detail
from backend.utils.safe_io import safe_write_text
import yaml
import logging
import os

# Auth gate: config contains the AI provider, vault paths, and mode (personal/org).
# require_role("admin") is a no-op in personal mode (user is auto-owner) but
# blocks access in organization mode.
router = APIRouter(dependencies=[Depends(require_role("admin"))])
log = logging.getLogger(__name__)

# Note: We now fetch the dynamic path from app_config at runtime

@router.get("/config")
async def get_config():
    try:
        # Reload params to get the latest version from disk
        cfg = load_params(strict_env=False)
        # Absolute origin trace of the function for debugging
        import inspect
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
        vault_ui_path = os.environ.get("VAULT_HOST_PATH") or (str(cfg.paths.get("VAULT")) if cfg.paths.get("VAULT") else "")
        if vault_ui_path:
            safe_params["paths"]["vault"] = vault_ui_path

        # 2. Sanitize system password
        settings = safe_params.get("settings", {})
        if "password" in settings or "gnosi_mode" in settings:
            from backend.security.keychain_manager import get_keychain
            # We don't want to send the actual password to the frontend
            # but we want to let it know if one is set.
            has_pwd = bool(settings.get("password")) or get_keychain().has_credential("system_password")
            settings["has_password"] = has_pwd
            settings.pop("password", None)
            safe_params["settings"] = settings

        safe_params["ai"] = sanitize_ai_config(dict(safe_params.get("ai") or {}))
        log.info("DEBUG: Config loaded and AI secrets sanitized for API response")
        return safe_params
    except Exception as e:
        log.error(f"Error reading config: {e}")
        raise HTTPException(status_code=500, detail=safe_error_detail(e, context="GET /config"))

def deep_merge(dict1, dict2):
    """Recursively merges dict2 into dict1."""
    for k, v in dict2.items():
        if isinstance(v, dict) and k in dict1 and isinstance(dict1[k], dict):
            deep_merge(dict1[k], v)
        else:
            dict1[k] = v
    return dict1

@router.post("/config")
async def update_config(request: Request):
    try:
        new_config = await request.json()
        if not new_config:
            raise HTTPException(status_code=400, detail="No data provided")

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
            from backend.services.llm_wiki_agent import (
                LlmWikiAgentError,
                validate_agent_preserved,
            )

            try:
                validate_agent_preserved(cfg.ai, new_config["ai"])
            except LlmWikiAgentError as exc:
                raise HTTPException(status_code=400, detail=str(exc)) from exc
        
        current_config = {}
        if params_path.exists():
            with open(params_path, 'r', encoding='utf-8') as f:
                current_config = yaml.safe_load(f) or {}

        # 1. Migrate system password if sent
        settings = new_config.get("settings", {})
        if "password" in settings:
            pwd = settings["password"]
            if pwd and pwd != "********":
                from backend.security.keychain_manager import get_keychain
                get_keychain().save_credential("system_password", pwd)
                log.info("System password migrated to secure storage")
            # Always remove from the dict that will be merged into yaml
            settings.pop("password", None)

        # Merge data and preserve unsent keys
        merged_config = deep_merge(current_config, new_config)

        if isinstance(new_config.get("ai"), dict) and "agents" in new_config["ai"]:
            from backend.agent.model_router import load_registry
            from backend.services.agent_model_strategy import validate_model_strategies

            try:
                merged_config.setdefault("ai", {})["agents"] = validate_model_strategies(
                    new_config["ai"].get("agents") or [],
                    load_registry(),
                )
            except ValueError as exc:
                raise HTTPException(status_code=400, detail=str(exc)) from exc

        # For AI providers, frontend sends the full desired map.
        # Replace instead of deep-merging to allow deleting removed providers.
        if isinstance(new_config.get("ai"), dict) and "providers" in new_config.get("ai", {}):
            if "ai" not in merged_config or not isinstance(merged_config.get("ai"), dict):
                merged_config["ai"] = {}
            merged_config["ai"]["providers"] = dict(new_config["ai"].get("providers") or {})

        ai_cfg = dict(merged_config.get("ai") or {})
        migrated_ai_cfg, migrated = migrate_ai_provider_secrets(ai_cfg)
        merged_config["ai"] = migrated_ai_cfg
        if migrated:
            log.info("AI provider secrets migrated to secure storage")
        
        # Do not log the raw AI config: it contains provider api_key values.
        # The sanitized summary below is enough for debugging.
        if 'ai' in merged_config:
            log.info(f"Final AI Config to save (sanitized): {sanitize_ai_config(merged_config['ai'])}")

        log.info(f"Final configuration to save (summary): {list(merged_config.keys())}")

        # Atomic write: params.yaml is the app's main config. A crash
        # mid safe_dump would leave the YAML truncated and the next restart
        # from the backend would expire on load_params.
        yaml_text = yaml.safe_dump(
            merged_config,
            default_flow_style=False,
            allow_unicode=True,
            sort_keys=False,
        )
        safe_write_text(params_path, yaml_text)

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
        if "ai" in new_config:
            cache = getattr(request.app.state, "agent_cache", None)
            if cache:
                cache.clear()
                log.info("Agent graph cache evicted after an AI configuration change.")

        return {"status": "success", "message": "Configuration updated"}

    except HTTPException:
        raise
    except Exception as e:
        log.error(f"Error updating config: {e}")
        raise HTTPException(status_code=500, detail=safe_error_detail(e, context="POST /config"))
