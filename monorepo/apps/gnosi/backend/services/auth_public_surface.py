"""The set of endpoints that must stay reachable without a session.

This is phase 2 of removing the `ismael-legacy` fallback (see
`docs/dev_memory/directives/auth_remove_legacy_fallback.md`). Nothing here
enforces anything yet: it defines *what* may stay open, so the enforcement added
later has a single, reviewable list to consult instead of scattering exemptions
across routers.

Three reasons an endpoint belongs here, and no others:

1. **Liveness probes.** The native and Docker watchdogs and the compose
   healthcheck poll the API with plain `curl`/`urllib`, no credentials. If these
   start getting 401s the watchdogs conclude the backend is down and restart it
   in a loop.
2. **Authentication itself.** You cannot present a session to the endpoint that
   issues it.
3. **Endpoints that already carry their own auth.** Share links are anonymous by
   design (the token in the URL *is* the credential) and the public API
   authenticates with a PAT. Both would be double-gated otherwise.

The rules are method-aware on purpose. `GET /api/config` is a liveness probe for
`native_watchdog.sh`, but `POST /api/config` writes settings — exempting the
path wholesale would leave a configuration write endpoint open.
"""
from __future__ import annotations

import re
from typing import NamedTuple


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
    _rule("GET", r"/api/config", "native_watchdog.sh polls this; POST stays protected"),
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
