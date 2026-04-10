from contextvars import ContextVar
from pathlib import Path
from typing import Optional

# Proporciona una forma segura d'accedir al path del vault 
# sense haver de passar-lo per cada funció.
active_vault_path: ContextVar[Optional[Path]] = ContextVar("active_vault_path", default=None)

def get_active_vault_path() -> Path:
    path = active_vault_path.get()
    if not path:
        # Fallback de seguretat (no hauria de passar si el middleware funciona)
        from backend.config.app_config import load_params
        cfg = load_params(strict_env=False)
        return cfg.paths.get("VAULT")
    return path
