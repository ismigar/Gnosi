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
    Carrega params.yaml i retorna un objecte Config.
    Prioritat:
    1. DIGITAL_BRAIN_VAULT_PATH/.gnosi/params.yaml
    2. ~/.gnosi/params.yaml
    3. monorepo/apps/gnosi/config/params.yaml (Base/Default)
    """
    load_env()
    
    local_path = Path(__file__).parents[2] / "config" / "params.yaml"
    home_path = Path.home() / ".gnosi" / "params.yaml"
    
    # ── 1. Carregar la base (Local) ──
    params = {}
    if local_path.exists():
        with open(local_path, "r", encoding="utf-8") as f:
            params = yaml.safe_load(f) or {}
    
    params_path = local_path
    
    # ── 2. Determinar la font d'usuari (Vault o Home) ──
    user_params_path = None
    env_vault = os.environ.get("DIGITAL_BRAIN_VAULT_PATH")
    
    if env_vault:
        vault_params = Path(env_vault) / ".gnosi" / "params.yaml"
        if vault_params.exists():
            user_params_path = vault_params
    elif home_path.exists():
        user_params_path = home_path
        
    # Si hem carregat el local però aquest defineix un vault que té el seu propi params.yaml, saltem al del vault.
    if not user_params_path and "paths" in params:
        vault_raw = params.get("paths", {}).get("vault")
        if vault_raw:
            vault_params = Path(vault_raw) / ".gnosi" / "params.yaml"
            if vault_params.exists() and vault_params != local_path:
                user_params_path = vault_params

    # ── 3. Fusionar si hi ha configuració d'usuari ──
    if user_params_path:
        # log.info(f"Fusionant configuració d'usuari des de: {user_params_path}")
        with open(user_params_path, "r", encoding="utf-8") as f:
            user_params = yaml.safe_load(f) or {}
            params = deep_merge(params, user_params)
        params_path = user_params_path

    # --- Manteniment i Migració ---
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

    # Si hi ha hagut canvis, guardem el YAML actualitzat
    if migrated:
        try:
            with open(params_path, "w", encoding="utf-8") as f:
                yaml.dump(params, f, default_flow_style=False, allow_unicode=True)
        except Exception as e:
            log.error(f"Error guardant configuració migrada: {e}")

    return Config(params, params_path, strict_env=strict_env)

