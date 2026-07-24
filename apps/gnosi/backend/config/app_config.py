# config/app_config.py
import yaml
import os
import logging
from pathlib import Path
from .env_config import get_env, load_env
from .paths_config import get_paths
from .schema_keys import get_schema_keys

log = logging.getLogger(__name__)

DEFAULT_INTERFACE_LANGUAGE = "en"
SUPPORTED_INTERFACE_LANGUAGES = frozenset({"ca", "en", "es", "fr"})


def normalize_interface_language(value) -> str:
    """Return a supported interface language or the English default."""
    language = str(value or "").strip().split("-", 1)[0].lower()
    return language if language in SUPPORTED_INTERFACE_LANGUAGES else DEFAULT_INTERFACE_LANGUAGE


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

        # Load YAML sub-dictionaries.
        self.ai          = params.get("ai", {})
        self.graph       = params.get("graph", {})
        self.colors      = params.get("colors", {})
        self.input_files = params.get("input_files", {})
        self.mapping     = params.get("mapping", {})
        self.settings    = dict(params.get("settings") or {})
        self.settings["language"] = normalize_interface_language(self.settings.get("language"))
        self.params["settings"] = self.settings
        
        # Determine Gnosi mode (personal or organization).
        self.gnosi_mode = os.environ.get("GNOSI_MODE") or self.settings.get("gnosi_mode", "personal")

        # Load paths with optional overrides from params.yaml.
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
    
    # ── 1. Load the local base configuration ──
    params = {}
    if local_path.exists():
        with open(local_path, "r", encoding="utf-8") as f:
            params = yaml.safe_load(f) or {}
    
    params_path = local_path
    
    # ── 2. Determine the user source (active vault > vault environment > home) ──
    user_params_path = None

    # Multi-vault: an active vault's configuration (graph, colors, AI, etc.)
    # takes precedence. Read the context variable directly (not
    # `get_active_vault_path`) to avoid the cycle
    # load_params ↔ get_active_vault_path. Outside a request → None → previous behavior.
    active_params_path = None
    try:
        from backend.services.context_vars import active_vault_path as _avp_var
        _av = _avp_var.get()
        if _av:
            active_params_path = Path(_av) / ".gnosi" / "params.yaml"
    except Exception:
        active_params_path = None

    # Make `Path.exists()` tolerant of OneDrive I/O errors. An online-only
    # params.yaml that is not hydrated (or whose synchronization is stuck)
    # causes `stat()` to fail with EDEADLK/EAGAIN (errno 11/35). Without this,
    # one unavailable .gnosi file brought down every vault endpoint (500 in
    # get_workspace_context). Treat it as unavailable and continue
    # with the inherited config; when OneDrive materializes it, it will merge normally.
    def _exists_tolerant(p):
        if p is None:
            return False
        try:
            return p.exists()
        except OSError as e:
            log.warning("params.yaml is unreadable (OneDrive placeholder?): %s → %s", p, e)
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

    # If the local configuration names a vault with its own params.yaml, use it.
    if not user_params_path and "paths" in params:
        vault_raw = params.get("paths", {}).get("vault")
        if vault_raw:
            vault_params = Path(vault_raw) / ".gnosi" / "params.yaml"
            if _exists_tolerant(vault_params) and vault_params != local_path:
                user_params_path = vault_params

    # ── 3. Merge user configuration when present ──
    if user_params_path:
        # log.info(f"Merging user configuration from: {user_params_path}")
        try:
            with open(user_params_path, "r", encoding="utf-8") as f:
                user_params = yaml.safe_load(f) or {}
                params = deep_merge(params, user_params)
            params_path = user_params_path
        except OSError as e:
            # The file became unreadable between exists() and open()
            # (OneDrive placeholder). Keep the inherited configuration.
            log.warning(
                "params.yaml became unreadable while opening (OneDrive placeholder?): %s → %s",
                user_params_path,
                e,
            )

    # The active vault's params.yaml is always the save target (and is created
    # if needed), even when values were inherited. Editing a new vault's graph,
    # colors, or other settings therefore writes to its own .gnosi directory.
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

    # Persist migrations with an atomic write.
    if migrated:
        try:
            from backend.utils.safe_io import safe_write_text
            yaml_text = yaml.dump(params, default_flow_style=False, allow_unicode=True)
            safe_write_text(params_path, yaml_text)
        except Exception as e:
            log.error("Error saving migrated configuration: %s", e)

    return Config(params, params_path, strict_env=strict_env)
