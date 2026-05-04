from fastapi import APIRouter, HTTPException, Request
from backend.config.app_config import load_params
from backend.security.ai_credentials import migrate_ai_provider_secrets, sanitize_ai_config
from pathlib import Path
import yaml
import logging

router = APIRouter()
log = logging.getLogger(__name__)

# Absolute path to the configuration file
PARAMS_PATH = Path(__file__).resolve().parents[2] / "config" / "params.yaml"

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
        safe_params["ai"] = sanitize_ai_config(dict(safe_params.get("ai") or {}))
        log.info("DEBUG: Config loaded and AI secrets sanitized for API response")
        return safe_params
    except Exception as e:
        log.error(f"Error reading config: {e}")
        raise HTTPException(status_code=500, detail=str(e))

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

        log.info(f"POST /config received. Data: {new_config}")

        # Retrieve the current configuration
        current_config = {}
        if PARAMS_PATH.exists():
            with open(PARAMS_PATH, 'r', encoding='utf-8') as f:
                current_config = yaml.safe_load(f) or {}

        # Merge data and preserve unsent keys
        merged_config = deep_merge(current_config, new_config)

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
        
        # DEBUG: Log AI specific config to see if keys are present
        if 'ai' in new_config:
            log.info(f"AI Config received in payload: {new_config['ai']}")
        if 'ai' in merged_config:
            log.info(f"Final AI Config to save (sanitized): {sanitize_ai_config(merged_config['ai'])}")

        log.info(f"Final configuration to save (summary): {list(merged_config.keys())}")

        # Write to disk
        with open(PARAMS_PATH, 'w', encoding='utf-8') as f:
            yaml.safe_dump(merged_config, f, default_flow_style=False, allow_unicode=True, sort_keys=False)
            
        # Force environment restart (uvicorn --reload) to apply critical route changes
        server_file = Path(__file__).resolve().parents[1] / "server.py"
        if server_file.exists():
            server_file.touch()
            log.info("Server restart forced to apply new parameters.")

        log.info("File params.yaml updated successfully.")
        return {"status": "success", "message": "Configuration updated"}

    except Exception as e:
        log.error(f"Error updating config: {e}")
        raise HTTPException(status_code=500, detail=str(e))
