"""Resolve canonical vault API routes and propagate the active vault context.

The problem: `get_workspace_context` (which used to do `active_vault_path.set()`) is a
SYNCHRONOUS dependency → FastAPI runs it in a threadpool and the contextvar does NOT propagate to the endpoint → everything
fell back to the default vault (switching vaults did nothing).

The solution: this PURE ASGI middleware does the `set()` in the SAME task that calls the inner app,
so the contextvar DOES propagate to the endpoint (async) and to its `anyio.to_thread` calls.
"""

from __future__ import annotations

import time
from contextvars import Token
from pathlib import Path
from urllib.parse import parse_qs, unquote

from starlette.types import ASGIApp, Receive, Scope, Send

from backend.services.context_vars import active_vault_path

VaultIdentity = tuple[str, str]
_id_path_cache: dict[str, tuple[VaultIdentity | None, float]] = {}
_TTL = 60.0

_CANONICAL_API_PREFIX = "/api/v1/vaults/"
_APP_LEGACY_PREFIXES = {
    "knowledge": "/api/vault",
    "graph": "/api/graph",
    "calendar": "/api/calendar",
    "mail": "/api/mail",
    "reader": "/api/reader",
    "automations": "/api/schedulers",
    "social": "/api/social",
    "media": "/api/vault/media",
    "contacts": "/api/contacts",
    "planning": "/api/planning",
    "resources": "/api/vault/literature",
    "notebooks": "/api/notebooks",
    "ai": "/api",
}


def reset_vault_path_cache() -> None:
    """Invalidates the id→path cache (when creating/deleting vaults)."""
    _id_path_cache.clear()


def _resolve_vault_identity(identifier: str) -> VaultIdentity | None:
    """Resolve either an immutable vault id or a canonical vault slug."""
    if not identifier:
        return None
    now = time.monotonic()
    hit = _id_path_cache.get(identifier)
    if hit and (now - hit[1]) < _TTL:
        return hit[0]
    identity = None
    try:
        from backend.data.management_db import _get_or_init_mgmt_engine
        from backend.models.management import Vault
        from backend.services.vault_routing import ensure_vault_slugs

        _, SessionLocal = _get_or_init_mgmt_engine()
        db = SessionLocal()
        try:
            v = db.query(Vault).filter(Vault.id == identifier).first()
            if not v:
                ensure_vault_slugs(db)
                v = db.query(Vault).filter(Vault.slug == identifier).first()
            if v and v.path_override:
                identity = (v.id, v.path_override)
        finally:
            db.close()
    except Exception:
        identity = None
    if identity:
        try:
            Path(identity[1]).mkdir(parents=True, exist_ok=True)
        except Exception:
            identity = None
    _id_path_cache[identifier] = (identity, now)
    return identity


def _resolve_vault_path(vault_id: str) -> str | None:
    """Backward-compatible id-to-path helper used by share routes and tests."""
    identity = _resolve_vault_identity(vault_id)
    return identity[1] if identity else None


def _canonical_api_target(path: str) -> tuple[str, str] | None:
    """Return ``(slug, legacy_path)`` for a canonical vault API path."""
    if not path.startswith(_CANONICAL_API_PREFIX):
        return None
    tail = path[len(_CANONICAL_API_PREFIX) :]
    parts = tail.split("/", 2)
    if len(parts) < 2:
        return None
    slug = unquote(parts[0]).strip().lower()
    app = parts[1].strip().lower()
    remainder = f"/{parts[2]}" if len(parts) == 3 and parts[2] else ""
    prefix = _APP_LEGACY_PREFIXES.get(app)
    if not slug or not prefix:
        return None
    # Meetings belong to the Calendar application but retain their established
    # backend router while the canonical public hierarchy stays app-centric.
    if app == "calendar" and (remainder == "/meetings" or remainder.startswith("/meetings/")):
        return slug, f"/api{remainder}"
    if app == "knowledge" and remainder.startswith("/pages/") and "/views" in remainder:
        # Embedded page views historically live under /api/pages while normal
        # page CRUD lives under /api/vault/pages. The canonical hierarchy can
        # represent both without exposing that backend split.
        return slug, f"/api{remainder}"
    return slug, f"{prefix}{remainder}"


async def _send_unknown_vault(scope: Scope, send: Send) -> None:
    if scope.get("type") == "websocket":
        await send({"type": "websocket.close", "code": 4404, "reason": "Vault not found"})
        return
    body = b'{"detail":"Vault not found"}'
    await send(
        {
            "type": "http.response.start",
            "status": 404,
            "headers": [
                (b"content-type", b"application/json"),
                (b"content-length", str(len(body)).encode("ascii")),
            ],
        }
    )
    await send({"type": "http.response.body", "body": body})


async def _rewrite_canonical_scope(
    scope: Scope,
    send: Send,
) -> tuple[Scope, VaultIdentity | None, bool]:
    """Map one canonical route to the legacy router and inject its vault header."""
    canonical = _canonical_api_target(str(scope.get("path") or ""))
    if canonical is None:
        return scope, None, True
    slug, legacy_path = canonical
    identity = _resolve_vault_identity(slug)
    if identity is None:
        await _send_unknown_vault(scope, send)
        return scope, None, False

    rewritten = dict(scope)
    rewritten["path"] = legacy_path
    rewritten["raw_path"] = legacy_path.encode("utf-8")
    state = dict(rewritten.get("state") or {})
    state.update({"canonical_vault_id": identity[0], "canonical_vault_slug": slug})
    rewritten["state"] = state
    headers = [
        (key, value) for key, value in rewritten.get("headers", []) if key.lower() != b"x-vault-id"
    ]
    headers.append((b"x-vault-id", identity[0].encode("latin-1")))
    rewritten["headers"] = headers
    return rewritten, identity, True


def _header_vault_id(scope: Scope) -> str | None:
    for key, value in scope.get("headers", []):
        if key == b"x-vault-id" and value:
            return value.decode("latin-1").strip() or None
    return None


def _query_vault_id(scope: Scope) -> str | None:
    if scope.get("type") != "http":
        return None
    query_string = scope.get("query_string") or b""
    if b"vault=" not in query_string:
        return None
    values = parse_qs(query_string.decode("latin-1")).get("vault")
    return (values[0] or "").strip() or None if values else None


def _cookie_vault_id(scope: Scope) -> str | None:
    for key, value in scope.get("headers", []):
        if key != b"cookie" or not value:
            continue
        for part in value.decode("latin-1").split(";"):
            name, _, cookie_value = part.strip().partition("=")
            if name == "gnosi_active_vault":
                return unquote(cookie_value).strip() or None
        return None
    return None


def _requested_vault_id(scope: Scope) -> str | None:
    """Resolve request vault priority: header, query parameter, then cookie."""
    return _header_vault_id(scope) or _query_vault_id(scope) or _cookie_vault_id(scope)


class ActiveVaultMiddleware:
    """Pure ASGI wrapper (not BaseHTTPMiddleware: that one breaks contextvar propagation)."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope.get("type") not in {"http", "websocket"}:
            await self.app(scope, receive, send)
            return
        scope, canonical_identity, should_continue = await _rewrite_canonical_scope(
            dict(scope),
            send,
        )
        if not should_continue:
            return
        vault_id = _requested_vault_id(scope)
        # Fallback: `vault` query-param. Native `<img>` requests (icons,
        # covers, inline images) do NOT go through axios and therefore do NOT carry the
        # X-Vault-Id header → without it they fall back to the default vault and
        # assets from a non-default vault return 404. The frontend adds
        # `?vault=<id>` to them (withActiveVault). The header, if present, WINS.
        # Final fallback: `gnosi_active_vault` cookie. Many requests do not include
        # neither header nor `?vault=` because they don't go through axios nor through a
        # URL generator that would add the param: raw `fetch()` (cell editing, agent,
        # uploads, annotations), native media (`<video>/<audio>/<iframe>`),
        # `background-image`, `EventSource`/SSE, and `/api/chat`. All of them DO send
        # same-origin cookies, which the frontend keeps synced with the
        # active vault (setActiveVaultCookie). Priority: header > `?vault=` > cookie.
        token: Token[Path | None] | None = None
        if vault_id:
            identity = canonical_identity or _resolve_vault_identity(vault_id)
            if identity:
                token = active_vault_path.set(Path(identity[1]))
        try:
            await self.app(scope, receive, send)
        finally:
            if token is not None:
                active_vault_path.reset(token)
