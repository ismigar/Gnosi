# config/app_config.py
import yaml
from pathlib import Path
from .env_config import get_env
from .paths_config import get_paths
from .schema_keys import get_schema_keys

class Config:
    def __init__(self, params: dict, strict_env: bool = True):
        self.hf = {}

        if params is None:
            # If needed, internal load_params could be reused here, but it's not currently necessary.
            params = {}

        self.params = params

        # --- Load YAML sub-dictionaries ---
        self.notion      = params.get("notion", {})
        self.ai          = params.get("ai", {})
        self.graph       = params.get("graph", {})
        self.colors      = params.get("colors", {})
        self.input_files = params.get("input_files", {})
        self.mapping     = params.get("mapping", {})
        self.settings    = params.get("settings", {})

        
        # Load paths (with optional overrides from params.yaml)
        self.paths       = get_paths(params.get("paths", {}))
        
        # Environment overrides (opcional)
        # if strict_env:
        #     self._apply_env_overrides()

    def get(self, key, default=None):
        return self.params.get(key, default)

def load_params(strict_env: bool = True) -> Config:
    """Carrega params.yaml i retorna un objecte Config."""
    params_path = Path(__file__).parents[2] / "config" / "params.yaml"
    
    if not params_path.exists():
        return Config({}, strict_env=strict_env)
        
    with open(params_path, "r", encoding="utf-8") as f:
        params = yaml.safe_load(f)
    return Config(params, strict_env=strict_env)
