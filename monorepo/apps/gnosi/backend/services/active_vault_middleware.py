"""Middleware ASGI: fixa el vault ACTIU des de `X-Vault-Id` en un context que PROPAGA.

El problema: `get_workspace_context` (que feia `active_vault_path.set()`) és una dependència
SÍNCRONA → FastAPI l'executa en un threadpool i el contextvar NO propaga a l'endpoint → tot
queia al vault per defecte (el canvi de vault no feia res).

La solució: aquest middleware PUR ASGI fa el `set()` en el MATEIX task que crida l'app interna,
així el contextvar sí propaga a l'endpoint (async) i a les seves crides `anyio.to_thread`.
"""
from __future__ import annotations

import time
from pathlib import Path

from backend.services.context_vars import active_vault_path

_id_path_cache: dict = {}   # vault_id -> (path|None, monotonic_ts)
_TTL = 60.0


def reset_vault_path_cache() -> None:
    """Invalida la cau id→ruta (en crear/esborrar vaults)."""
    _id_path_cache.clear()


def _resolve_vault_path(vault_id: str):
    if not vault_id:
        return None
    now = time.monotonic()
    hit = _id_path_cache.get(vault_id)
    if hit and (now - hit[1]) < _TTL:
        return hit[0]
    path = None
    try:
        from backend.data.management_db import _get_or_init_mgmt_engine
        from backend.models.management import Vault
        _, SessionLocal = _get_or_init_mgmt_engine()
        db = SessionLocal()
        try:
            v = db.query(Vault).filter(Vault.id == vault_id).first()
            path = v.path_override if (v and v.path_override) else None
        finally:
            db.close()
    except Exception:
        path = None
    if path:
        try:
            Path(path).mkdir(parents=True, exist_ok=True)
        except Exception:
            path = None
    _id_path_cache[vault_id] = (path, now)
    return path


class ActiveVaultMiddleware:
    """Wrapper ASGI pur (no BaseHTTPMiddleware: aquell trenca la propagació de contextvars)."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope.get("type") != "http":
            await self.app(scope, receive, send)
            return
        vid = None
        for k, v in scope.get("headers", []):
            if k == b"x-vault-id" and v:
                vid = v.decode("latin-1").strip() or None
                break
        token = None
        if vid:
            p = _resolve_vault_path(vid)
            if p:
                token = active_vault_path.set(Path(p))
        try:
            await self.app(scope, receive, send)
        finally:
            if token is not None:
                active_vault_path.reset(token)
