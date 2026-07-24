"""ASGI Middleware: sets the ACTIVE vault from `X-Vault-Id` in a context that PROPAGATES.

The problem: `get_workspace_context` (which used to do `active_vault_path.set()`) is a
SYNCHRONOUS dependency → FastAPI runs it in a threadpool and the contextvar does NOT propagate to the endpoint → everything
fell back to the default vault (switching vaults did nothing).

The solution: this PURE ASGI middleware does the `set()` in the SAME task that calls the inner app,
so the contextvar DOES propagate to the endpoint (async) and to its `anyio.to_thread` calls.
"""
from __future__ import annotations

import time
from pathlib import Path

from backend.services.context_vars import active_vault_path

_id_path_cache: dict = {}   # vault_id -> (path|None, monotonic_ts)
_TTL = 60.0


def reset_vault_path_cache() -> None:
    """Invalidates the id→path cache (when creating/deleting vaults)."""
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
    """Pure ASGI wrapper (not BaseHTTPMiddleware: that one breaks contextvar propagation)."""

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
        # Fallback: `vault` query-param. Native `<img>` requests (icons,
        # covers, inline images) do NOT go through axios and therefore do NOT carry the
        # X-Vault-Id header → without it they fall back to the default vault and
        # assets from a non-default vault return 404. The frontend adds
        # `?vault=<id>` to them (withActiveVault). The header, if present, WINS.
        if not vid:
            qs = scope.get("query_string") or b""
            if b"vault=" in qs:
                from urllib.parse import parse_qs
                vals = parse_qs(qs.decode("latin-1")).get("vault")
                if vals:
                    vid = (vals[0] or "").strip() or None
        # Final fallback: `gnosi_active_vault` cookie. Many requests do not include
        # neither header nor `?vault=` because they don't go through axios nor through a
        # URL generator that would add the param: raw `fetch()` (cell editing, agent,
        # uploads, annotations), native media (`<video>/<audio>/<iframe>`),
        # `background-image`, `EventSource`/SSE, and `/api/chat`. All of them DO send
        # same-origin cookies, which the frontend keeps synced with the
        # active vault (setActiveVaultCookie). Priority: header > `?vault=` > cookie.
        if not vid:
            for k, v in scope.get("headers", []):
                if k == b"cookie" and v:
                    for part in v.decode("latin-1").split(";"):
                        name, _, val = part.strip().partition("=")
                        if name == "gnosi_active_vault":
                            from urllib.parse import unquote
                            vid = unquote(val).strip() or None
                            break
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
