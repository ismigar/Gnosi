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


def get_primary_vault_path() -> Optional[Path]:
    """Ruta del vault PRINCIPAL/base, IGNORANT l'override de vault actiu.

    Per a integracions GLOBALS (correu, referències Zotero, shares v1) que viuen
    SEMPRE al vault Principal, independentment del vault que l'usuari tingui
    actiu. Sense això, la lectura seguia el vault actiu mentre l'escriptura (sync
    en background, sense context) anava al Principal → en un vault no-default les
    dades apareixien buides. Neutralitza el contextvar temporalment perquè
    `load_params` retorni la config base."""
    token = active_vault_path.set(None)
    try:
        from backend.config.app_config import load_params
        return load_params(strict_env=False).paths.get("VAULT")
    finally:
        active_vault_path.reset(token)
