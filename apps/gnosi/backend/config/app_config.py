# config/app_config.py
import yaml
import os
from pathlib import Path
from .env_config import get_env, load_env
from .paths_config import get_paths
from .schema_keys import get_schema_keys

class Config:
    def __init__(self, params: dict, strict_env: bool = True):
        self.hf = {}

        if params is None:
            params = {}

        self.params = params

        # Load YAML sub-dictionaries
        self.notion      = params.get("notion", {})
        self.ai          = params.get("ai", {})
        self.graph       = params.get("graph", {})
        self.colors      = params.get("colors", {})
        self.input_files = params.get("input_files", {})
        self.mapping     = params.get("mapping", {})
        self.settings    = params.get("settings", {})

        # Load paths (with optional overrides from params.yaml)
        self.paths       = get_paths(params.get("paths", {}))

    def get(self, key, default=None):
        return self.params.get(key, default)

def load_params(strict_env: bool = True) -> Config:
    """Carrega params.yaml i retorna un objecte Config."""
    params_path = Path(__file__).parents[2] / "config" / "params.yaml"
    
    if not params_path.exists():
        return Config({}, strict_env=strict_env)
        
    with open(params_path, "r", encoding="utf-8") as f:
        params = yaml.safe_load(f) or {}

    # --- Una vegada carregat, fem la migració si cal ---
    load_env()
    migrated = False
    
    # Mapeig de claus d'entorn a referències segures en YAML (mai el valor secret).
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
            # Si el proveïdor no existeix o no té referència segura, migrem només la referència.
            if p_id not in providers:
                providers[p_id] = {}

            current_ref = providers[p_id].get("credential_ref")
            if not current_ref:
                providers[p_id]["credential_ref"] = credential_ref
                migrated = True

    # Si hi ha hagut canvis, guardem el YAML actualitzat
    if migrated:
        print(f"DEBUG_LOAD: Migrant claus d'IA des de l'entorn al fitxer {params_path}")
        with open(params_path, "w", encoding="utf-8") as f:
            yaml.dump(params, f, default_flow_style=False, allow_unicode=True)

    return Config(params, strict_env=strict_env)
