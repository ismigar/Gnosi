# config/app_config.py
import yaml
import os
import logging
from pathlib import Path
from .env_config import get_env, load_env
from .paths_config import get_paths
from .schema_keys import get_schema_keys

log = logging.getLogger(__name__)

def deep_merge(dict1, dict2):
    """Recursively merges dict2 into dict1."""
    if not isinstance(dict1, dict) or not isinstance(dict2, dict):
        return dict2
    for k, v in dict2.items():
        if k in dict1 and isinstance(dict1[k], dict) and isinstance(v, dict):
            deep_merge(dict1[k], v)
        else:
            dict1[k] = v
    return dict1

class Config:
    def __init__(self, params: dict, params_source: Path, strict_env: bool = True):
        self.hf = {}
        if params is None:
            params = {}

        self.params = params
        self.params_source = params_source

        # Load YAML sub-dictionaries
        self.ai          = params.get("ai", {})
        self.graph       = params.get("graph", {})
        self.colors      = params.get("colors", {})
        self.input_files = params.get("input_files", {})
        self.mapping     = params.get("mapping", {})
        self.settings    = params.get("settings", {})
        
        # Determine Gnosi Mode (personal or org)
        self.gnosi_mode = os.environ.get("GNOSI_MODE") or self.settings.get("gnosi_mode", "personal")

        # Load paths (with optional overrides from params.yaml)
        self.paths       = get_paths(params.get("paths", {}))

    def get(self, key, default=None):
        return self.params.get(key, default)

def load_params(strict_env: bool = True) -> Config:
    """
        Loads params.yaml and returns a Config object.
    Priority:
    1. DIGITAL_BRAIN_VAULT_PATH/.gnosi/params.yaml
    2. ~/.gnosi/params.yaml
    3. monorepo/apps/gnosi/config/params.yaml (Base/Default)
    
    """
    load_env()
    
    local_path = Path(__file__).parents[2] / "config" / "params.yaml"
    home_path = Path.home() / ".gnosi" / "params.yaml"
    
    # ── 1. Load the base (Local) ──
    params = {}
    if local_path.exists():
        with open(local_path, "r", encoding="utf-8") as f:
            params = yaml.safe_load(f) or {}
    
    params_path = local_path
    
    # ── 2. Determine the user source (ACTIVE Vault > Vault env > Home) ──
    user_params_path = None

    # Multi-vault: if there's an ACTIVE vault in the context, its config (graph, colors, ai…)
    # It governs. We read the contextvar DIRECTLY (not `get_active_vault_path`) to avoid the cycle
    # load_params ↔ get_active_vault_path. Outside a request → None → previous behavior.
    active_params_path = None
    try:
        from backend.services.context_vars import active_vault_path as _avp_var
        _av = _avp_var.get()
        if _av:
            active_params_path = Path(_av) / ".gnosi" / "params.yaml"
    except Exception:
        active_params_path = None

    # `Path.exists()` tolerant of OneDrive I/O errors: an online-only params.yaml still
    # not hydrated (or with sync stuck) causes `stat()` to fail with EDEADLK/EAGAIN
    # (Errno 11/35). Without this, ONE unavailable .gnosi file brought down ALL the endpoints
    # of the vault (500 in get_workspace_context). It's treated as "unavailable" and continues
    # with the inherited config; when OneDrive materializes it, it will merge normally.
    def _exists_tolerant(p):
        if p is None:
            return False
        try:
            return p.exists()
        except OSError as e:
            log.warning(f"params.yaml no llegible (placeholder OneDrive?): {p} → {e}")
            return False

    env_vault = os.environ.get("DIGITAL_BRAIN_VAULT_PATH")
    if _exists_tolerant(active_params_path):
        user_params_path = active_params_path
    elif env_vault:
        vault_params = Path(env_vault) / ".gnosi" / "params.yaml"
        if _exists_tolerant(vault_params):
            user_params_path = vault_params
    elif _exists_tolerant(home_path):
        user_params_path = home_path

    # If we loaded the local one but it defines a vault that has its own params.yaml, we jump to the vault's.
    if not user_params_path and "paths" in params:
        vault_raw = params.get("paths", {}).get("vault")
        if vault_raw:
            vault_params = Path(vault_raw) / ".gnosi" / "params.yaml"
            if _exists_tolerant(vault_params) and vault_params != local_path:
                user_params_path = vault_params

    # ── 3. Merge if there is user configuration ──
    if user_params_path:
        # log.info(f"Merging user configuration from: {user_params_path}")
        try:
            with open(user_params_path, "r", encoding="utf-8") as f:
                user_params = yaml.safe_load(f) or {}
                params = deep_merge(params, user_params)
            params_path = user_params_path
        except OSError as e:
            # The file became unreadable between exists() and open() (placeholder
            # OneDrive): same policy as above — inherited config and we continue.
            log.warning(f"params.yaml il·legible en obrir (placeholder OneDrive?): {user_params_path} → {e}")

    # ACTIVE Vault: the source for SAVING is always its params.yaml (it will be created if it doesn't
    # exist yet), even if the values were inherited from the default. So, editing the config
    # of the Graph (or colors, etc…) of a new vault writes to ITS OWN .gnosi/, not the main one.
    if active_params_path:
        params_path = active_params_path

    # --- Maintenance and Migration ---
    migrated = False
    env_migration_map = {
        "OPENAI_API_KEY": ("openai", "__keychain__:openai_api_key"),
        "GROQ_API_KEY": ("groq", "__keychain__:groq_api_key"),
        "ANTHROPIC_API_KEY": ("anthropic", "__keychain__:anthropic_api_key"),
        "OPENROUTER_API_KEY": ("openrouter", "__keychain__:openrouter_api_key"),
        "GOOGLE_API_KEY": ("google", "__keychain__:google_api_key"),
    }

    if "ai" not in params:
        params["ai"] = {}
    if "providers" not in params["ai"]:
        params["ai"]["providers"] = {}

    providers = params["ai"]["providers"]
    
    for env_var, (p_id, credential_ref) in env_migration_map.items():
        env_val = os.environ.get(env_var)
        if env_val:
            if p_id not in providers:
                providers[p_id] = {}
            current_ref = providers[p_id].get("credential_ref")
            if not current_ref:
                providers[p_id]["credential_ref"] = credential_ref
                migrated = True

    # If there have been changes, we save the updated YAML (atomic write)
    if migrated:
        try:
            from backend.utils.safe_io import safe_write_text
            yaml_text = yaml.dump(params, default_flow_style=False, allow_unicode=True)
            safe_write_text(params_path, yaml_text)
        except Exception as e:
            log.error(f"Error guardant configuració migrada: {e}")

    return Config(params, params_path, strict_env=strict_env)

