"""The set of endpoints that must stay reachable without a session.

This is phase 2 of removing the `ismael-legacy` fallback (see
`docs/dev_memory/directives/auth_remove_legacy_fallback.md`). `enforce_authentication`
below is wired in as an app-wide dependency, so this list IS the enforcement:
everything not named here needs an identity wherever the policy demands one
(`auth_service.require_auth_enabled` — exposed deployments and multi-account
installs). Exemptions live together and carry a reason, instead of being
scattered across routers as forgotten defaults.

Three reasons an endpoint belongs here, and no others:

1. **Liveness probes.** The native and Docker watchdogs and the compose
   healthcheck poll the API with plain `curl`/`urllib`, no credentials. If these
   start getting 401s the watchdogs conclude the backend is down and restart it
   in a loop. Only `/api/health` qualifies: `native_watchdog.sh` used to probe
   `/api/config`, but that router carries `require_role("admin")`, so listing it
   here would have been a lie — the gate would let it through and the router
   would still 401. The watchdog now probes `/api/health`.
2. **Authentication itself.** You cannot present a session to the endpoint that
   issues it.
3. **Endpoints that already carry their own auth.** Share links are anonymous by
   design (the token in the URL *is* the credential) and the public API
   authenticates with a PAT. Both would be double-gated otherwise.

The rules are method-aware on purpose: an endpoint can be a harmless read and a
dangerous write under the same path, and exempting the path wholesale would open
both.

An entry here is necessary but not sufficient. This list only bypasses the
app-wide gate; a router or endpoint with its own dependency (`require_role`,
`require_pat`) still applies it. Do not add something here expecting it to
become reachable — check what the route itself requires.
"""
from __future__ import annotations

import re

from typing import NamedTuple

from fastapi import Depends, HTTPException
from sqlalchemy.orm import Session
from starlette.requests import HTTPConnection

from backend.data.management_db import get_mgmt_db
from backend.services.auth_service import require_auth_enabled, resolve_identity


class PublicRule(NamedTuple):
    """One allowlist entry.

    Attributes:
        methods: HTTP methods this rule covers.
        pattern: full-path regex, anchored on both ends.
        reason: why it is exempt — kept in the data so a reviewer never has to
            guess, and so an entry without a justification looks wrong.
    """

    methods: frozenset[str]
    pattern: re.Pattern[str]
    reason: str


async def enforce_authentication(conn: HTTPConnection) -> None:
    """App-wide gate: with enforcement on, everything outside the public surface
    needs a real identity.

    This is deliberately central rather than per-route. Gating through
    `get_workspace_context` only protects endpoints that happen to need a
    workspace — a survey of the route table found **50** that do not touch it,
    across schedulers, tools, AI settings, integrations and system routes. Any
    of them would have stayed open, and every future endpoint would be open by
    default until someone remembered. Here the default is closed and being
    public is the thing you have to write down.

    A no-op where the policy does not demand a credential — a local
    single-user install. "No-op" has to mean it: the DB session is opened
    INSIDE, on the one path that needs it, rather than declared as
    `Depends(get_mgmt_db)`. FastAPI resolves dependencies before the body runs,
    so as a parameter it was checked out and returned on EVERY request — the
    watchdog probe included — against a single-writer SQLite file, on installs
    that require no authentication at all. `require_auth_enabled()` is called
    without a session here for the same reason; it reads a short-lived cache.
    """
    if not require_auth_enabled():
        return

    # WebSockets are handled by the route itself: refusing one means closing the
    # socket with a code, which an HTTPException cannot express — see
    # `collab_routes.collab_ws`. This is also why the parameter is an
    # `HTTPConnection` and not a `Request`: app-level dependencies are merged
    # into websocket routes too, and declaring `Request` left FastAPI with
    # nothing to inject, so EVERY collab connection died with a TypeError —
    # including with enforcement off.
    if conn.scope.get("type") != "http":
        return

    # Allowlist first, identity only if it is still needed. Resolving identity
    # up front made an unusable cookie 401 `/api/auth/login` and
    # `/api/auth/logout` — both exits from a bad cookie — and made every
    # PAT-carrying request write `last_used_at` even for exempt endpoints.
    if is_public_endpoint(conn.scope.get("method", ""), conn.url.path):
        return

    if resolve_identity(conn):
        return
    raise HTTPException(status_code=401, detail="Cal autenticació")


def _rule(methods: str, pattern: str, reason: str) -> PublicRule:
    # `\Z`, not `$`: in Python `$` also matches just before a trailing newline,
    # so `^/api/health$` would accept "/api/health\n" and exempt it from
    # authentication. For an allowlist the end anchor has to be absolute.
    return PublicRule(
        methods=frozenset(m.strip().upper() for m in methods.split(",")),
        pattern=re.compile(rf"^{pattern}\Z"),
        reason=reason,
    )


PUBLIC_RULES: tuple[PublicRule, ...] = (
    # 1. Liveness probes.
    _rule("GET", r"/api/health", "docker_watchdog.sh and the compose healthcheck poll this"),
    # 2. Authentication itself.
    _rule("POST", r"/api/auth/login", "issues the session"),
    _rule("POST", r"/api/auth/register", "creates the account that will hold the session"),
    # NOTE: no rule for first-time credentials. That flow is deliberately not an
    # HTTP endpoint at all — see the note in `auth_routes.py` and
    # `pipeline/scripts/set_user_password.py`.
    _rule("POST", r"/api/auth/logout", "clearing a cookie must work even with a stale session"),
    _rule("GET", r"/api/auth/me", "returns 401 by design — the frontend uses it to decide login vs app"),
    # 3. Endpoints carrying their own credential.
    _rule("GET", r"/api/share/[^/]+", "the token in the URL is the credential"),
    # Enumerated rather than a `/api/public/*` wildcard: token MANAGEMENT
    # (`/api/tokens`) is session-only, and a wildcard here would quietly exempt
    # any future endpoint someone drops under the same prefix.
    _rule("GET", r"/api/public/ping", "authenticated by PAT via require_pat"),
    _rule("POST", r"/api/public/pages", "authenticated by PAT via require_pat"),
    _rule("POST", r"/api/public/clip", "authenticated by PAT via require_pat"),
)


def is_public_endpoint(method: str, path: str) -> bool:
    """True if `method path` may be served without a session.

    Args:
        method: HTTP method, case-insensitive.
        path: request path WITHOUT the query string.

    Returns:
        Whether the request is exempt from session authentication.
    """
    m = (method or "").upper()
    p = path or ""
    return any(m in rule.methods and rule.pattern.match(p) for rule in PUBLIC_RULES)


def public_surface_report() -> list[tuple[str, str, str]]:
    """The allowlist as (methods, pattern, reason) rows, for docs and review."""
    return [
        (",".join(sorted(r.methods)), r.pattern.pattern.strip("^$"), r.reason)
        for r in PUBLIC_RULES
    ]
