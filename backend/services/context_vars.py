from contextvars import ContextVar
from pathlib import Path
from typing import Optional

# Provides a safe way to access the vault path
# without having to pass it through every function.
active_vault_path: ContextVar[Optional[Path]] = ContextVar("active_vault_path", default=None)


def get_active_vault_path() -> Path | None:
    path = active_vault_path.get()
    if not path:
        # Safety fallback (shouldn't happen if the middleware is working)
        from backend.config.app_config import load_params

        cfg = load_params(strict_env=False)
        return cfg.paths.get("VAULT")
    return path


def get_primary_vault_path() -> Optional[Path]:
    """Path of the PRINCIPAL/base vault, IGNORING the active-vault override.

    For GLOBAL integrations (mail, Zotero references, shares v1) that always
    live in the Principal vault, regardless of which vault the user has
    active. Without this, reads would follow the active vault while writes (background
    sync, without context) went to Principal → in a non-default vault the
    data appeared empty. Temporarily neutralizes the contextvar so that
    `load_params` returns the base config."""
    token = active_vault_path.set(None)
    try:
        from backend.config.app_config import load_params

        return load_params(strict_env=False).paths.get("VAULT")
    finally:
        active_vault_path.reset(token)
