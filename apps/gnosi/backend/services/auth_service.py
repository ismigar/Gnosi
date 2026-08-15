"""Authentication service — JWT cookies + bcrypt password hashing.

This layer replaces the legacy `X-User-ID` header with real JWT-based
authentication. The header is no longer an identity source in any
configuration: `resolve_effective_user_id()` accepts a credential the caller
cannot mint, or the install's sole local account, and nothing else.

Tokens:
  - HS256 signed with `GNOSI_JWT_SECRET` (env var; hardcoded dev fallback).
  - Default TTL 7 days — `HttpOnly`, `SameSite=Lax` cookies.
  - Minimal payload: `{sub: user_id, exp: int, iat: int}`.

Passwords:
  - bcrypt (called directly), cost 12 (robust default).
  - Never stored in plaintext; never returned to the client.
"""
from __future__ import annotations

import hashlib
import os
import time
from datetime import datetime, timedelta, timezone
from typing import Optional

import bcrypt
from fastapi import Cookie, Depends, Header, HTTPException
from jose import JWTError, jwt
from sqlalchemy.orm import Session

from backend.config.logger_config import get_logger
from backend.data.management_db import get_mgmt_db

log = get_logger(__name__)



# ---------- Configuration ----------

_SECRET_FALLBACK_DEV = "dev-only-secret-please-set-GNOSI_JWT_SECRET-in-production"
SECRET_KEY: str = os.environ.get("GNOSI_JWT_SECRET", _SECRET_FALLBACK_DEV)
ALGORITHM: str = "HS256"


def signing_secret_is_insecure() -> bool:
    """True when the JWT signing secret is the public dev fallback.

    Signing tokens with this well-known value on an exposed deployment is a full
    authentication bypass: anyone can forge a session for any user. It is only
    acceptable on a local single-user install where auth is not enforced.
    """
    return not SECRET_KEY or SECRET_KEY == _SECRET_FALLBACK_DEV


def assert_signing_secret_safe() -> None:
    """Fail closed when an exposed deployment lacks a real `GNOSI_JWT_SECRET`.

    Called both at startup and on every token issue/verify so that an exposed
    install can never fall back to the public dev secret.
    """
    if signing_secret_is_insecure() and deployment_is_exposed():
        raise RuntimeError(
            "GNOSI_JWT_SECRET must be set to a strong, private value on an "
            "exposed deployment (Docker or org mode). Refusing to sign or "
            "verify tokens with the public dev fallback secret."
        )
DEFAULT_TTL_DAYS: int = 7
COOKIE_NAME: str = "gnosi_session"

# Cost 12 is the canonical value for 2024-2026 (about 250 ms / hash).
BCRYPT_ROUNDS = 12

# bcrypt hashes at most 72 BYTES of input and rejects anything longer, so the
# limit is on the UTF-8 encoding, not the character count: an accented or
# non-Latin password reaches it sooner than an ASCII one. Callers should
# validate their payloads against this so the user gets a field error instead of
# a 500.
BCRYPT_MAX_PASSWORD_BYTES = 72


# ---------- Enforcement policy ----------

# Whether a request needs a credential is derived from HOW THE INSTALL IS
# EXPOSED, not from a flag someone has to remember to set.
#
# The reason is that a login screen is not free: on a single-user local install
# it is a promise the system does not keep. The password encrypts nothing (the
# vault is plain Markdown on disk), losing it costs a script run, and the screen
# is indistinguishable from a cloud product's — so it teaches the user that
# their local-first tool is talking to a server somewhere. That is a real cost
# in trust, and it should only be paid where it buys something.
#
# What it buys is protection against callers the OS login does not already
# cover. Those exist when the API is reachable beyond this machine's own user:
#
#   * Docker — binds 0.0.0.0 and is the self-host deployment shape.
#   * Org mode — the product is multi-tenant by definition there.
#   * More than one account — ambient identity becomes ambiguous, so there is
#     no safe answer to "who is this?" without a credential.
#
# A native personal install with one account is none of those: the process runs
# as the user, bound to loopback, reading their own files. `X-User-ID` used to
# be the hole in that reasoning, and it is now closed unconditionally (see
# `resolve_effective_user_id`) rather than only while a flag is on.
#
# The env var stays as an explicit override in BOTH directions, because the
# autodetection cannot see everything: a native backend deliberately bound to
# 0.0.0.0 needs `1`, and a Docker install on a trusted private host may want `0`.
REQUIRE_AUTH_ENV = "GNOSI_REQUIRE_AUTH"

_TRUTHY = {"1", "true", "yes", "on"}
_FALSY = {"0", "false", "no", "off"}


def auth_policy_override() -> Optional[bool]:
    """The explicit `GNOSI_REQUIRE_AUTH` setting, or None when it is on `auto`.

    Read at call time, not import time, so a deployment can flip it with a
    restart and tests can exercise every branch without reimporting the module.
    """
    raw = os.environ.get(REQUIRE_AUTH_ENV, "").strip().lower()
    if raw in _TRUTHY:
        return True
    if raw in _FALSY:
        return False
    return None


def deployment_is_exposed() -> bool:
    """True when the install is reachable beyond this machine's own user.

    Deliberately conservative: anything this cannot positively identify as a
    local personal install counts as exposed, so a new deployment shape fails
    closed rather than silently serving an open API.
    """
    from backend.config.env_config import _is_docker

    if _is_docker():
        return True
    try:
        from backend.config.app_config import load_params

        return load_params(strict_env=False).gnosi_mode == "org"
    except Exception:
        # Config unreadable during early startup: assume exposed.
        log.warning("Could not read gnosi_mode; assuming an exposed deployment",
                    exc_info=True)
        return True


# The autodetected half of the policy is cached: it is consulted by the
# app-wide gate, i.e. on EVERY request, and both halves are expensive relative
# to that — `load_params` reads YAML off disk and the account count needs a DB
# session. Neither answer changes without a restart or a deliberate settings
# change, so a few seconds of staleness costs nothing. Keeping the gate free of
# per-request session checkouts was a deliberate property of the original
# design (see `auth_public_surface.enforce_authentication`) and this preserves it.
_AUTO_POLICY_TTL_SECONDS = 5.0
_auto_policy_cache: Optional[tuple[float, bool]] = None


def reset_auth_policy_cache() -> None:
    """Drop the cached autodetection. For tests and for settings writes that
    change `gnosi_mode`."""
    global _auto_policy_cache
    _auto_policy_cache = None


def _auto_policy_requires_auth(db=None) -> bool:
    """Whether the autodetected policy demands a credential.

    Fails closed: if the deployment shape or the account count cannot be
    determined, the answer is "yes". An install that cannot describe itself is
    not one to serve an open API from.
    """
    if db is not None:
        # The identity resolver holds a session and is about to hand out an
        # identity, so it gets the exact answer rather than the cached one.
        return deployment_is_exposed() or not ambient_identity_available(db)

    global _auto_policy_cache
    now = time.monotonic()
    cached = _auto_policy_cache
    if cached is not None and now - cached[0] < _AUTO_POLICY_TTL_SECONDS:
        return cached[1]

    gen = None
    try:
        if deployment_is_exposed():
            value = True
        else:
            gen = get_mgmt_db()
            value = not ambient_identity_available(next(gen))
    except Exception:
        log.warning("Auth policy autodetection failed; requiring authentication",
                    exc_info=True)
        value = True
    finally:
        if gen is not None:
            gen.close()

    _auto_policy_cache = (now, value)
    return value


def require_auth_enabled(db=None) -> bool:
    """True when a request without a credential must be rejected.

    Args:
        db: optional management-DB session. Callers that already hold one
            (the identity resolver) pass it to bypass the cache and get an
            exact answer; the per-request gate does not, and reads the cache.
    """
    override = auth_policy_override()
    if override is not None:
        return override
    return _auto_policy_requires_auth(db)


# ---------- Personal Access Tokens ----------

# A PAT is the credential non-browser clients use (the LibreOffice macro, the
# Word add-in, pipeline scripts). It is a bearer secret with no ambient
# transmission — a browser will not attach it to a cross-site request the way it
# would a cookie — so it is inherently CSRF-safe.
TOKEN_PREFIX = "gnosi_pat_"


def hash_token(raw: str) -> str:
    """SHA-256 of a raw PAT. Only the hash is ever stored."""
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def looks_like_pat(raw: str) -> bool:
    return bool(raw) and raw.startswith(TOKEN_PREFIX)


def resolve_pat_user_id(db, raw: str) -> Optional[str]:
    """Map a raw PAT to the user it belongs to, refreshing `last_used_at`.

    Returns None when the token is unknown or revoked, so callers can decide
    between 401 and falling through to another credential source.
    """
    # Imported here rather than at module scope: `backend.models.management`
    # pulls in the ORM layer, and auth_service is imported very early by
    # request-scoped dependencies.
    from backend.models.management import ApiToken

    token = (
        db.query(ApiToken)
        .filter(ApiToken.token_hash == hash_token(raw), ApiToken.revoked == 0)
        .first()
    )
    if not token:
        return None
    token.last_used_at = datetime.now(timezone.utc)
    db.commit()
    return token.user_id


# ---------- Email identity ----------

# The address every auto-provisioned account starts with (see
# `workspace_service._ensure_personal_exists`). It is a placeholder, not a real
# mailbox, and it is identical on every install — so it must never be treated as
# proof of who the caller is.
PLACEHOLDER_EMAIL = "user@example.com"

# The account every pre-auth install ends up owning everything through. Named
# here so the fallback and the guards that reference it cannot drift apart.
LEGACY_USER_ID = "ismael-legacy"


def _account_count(db, cap: int = 2) -> int:
    """How many accounts exist, counting no further than `cap`.

    Capped because every caller only asks "none, one, or several?" and this runs
    on the request path against a single-writer SQLite file.
    """
    from backend.models.management import User

    return len(db.query(User.id).limit(cap).all())


def ambient_identity_available(db) -> bool:
    """True when an unauthenticated local request has exactly one possible answer.

    One account is the obvious case. **Zero** counts too: a fresh install
    bootstraps its single local account on first use, and demanding a signup
    before the tool opens is precisely the cloud-shaped ceremony a local-first
    app should not have.

    Two or more is where it stops: there is no honest way to guess which of
    them is calling, and picking one would hand the other's data over.
    """
    return _account_count(db, cap=2) < 2


def sole_account_id(db) -> Optional[str]:
    """The id of the install's only account, or None when there are 0 or 2+."""
    from backend.models.management import User

    rows = db.query(User.id).limit(2).all()
    return rows[0][0] if len(rows) == 1 else None


def is_auto_provisioned_email(value: str) -> bool:
    """True for addresses the system invents for accounts nobody invited.

    Three code paths mint password-less accounts, each with its own shape:

      * `workspace_service._ensure_personal_exists` → `user@example.com`
      * `workspace_routes.create_workspace`         → `{x_user_id}@example.com`
      * `backend/sh/init_management.py`             → `ismael-legacy@gnosi.app`

    All three are hardcoded or derived from a request header, and this repo is
    public — so none of them is a secret, and knowing one proves nothing. The
    `/register` claim flow must refuse them: claiming by email is meant for
    people an admin deliberately invited at their real address.

    Matching on the *domains the system controls* rather than on one literal
    string is what keeps a fourth minting path from silently slipping through —
    the previous version compared against `PLACEHOLDER_EMAIL` alone and missed
    two of the three above.
    """
    email = normalize_email(value)
    if not email or "@" not in email:
        return False
    if email in _AUTO_PROVISIONED_LITERALS:
        return True
    return email.rsplit("@", 1)[1] in _AUTO_PROVISIONED_DOMAINS


# `example.com` is reserved by RFC 2606 so it can never be anyone's real
# mailbox: the whole domain is safe to refuse, which covers both
# `user@example.com` and the `{x_user_id}@example.com` pattern whatever id is
# used.
_AUTO_PROVISIONED_DOMAINS = frozenset({"example.com"})

# `gnosi.app` is NOT treated as a whole domain: a deployment could legitimately
# host its people there, and blocking it would stop them claiming the accounts
# an admin invited. Only the literal default the init script writes is refused.
_AUTO_PROVISIONED_LITERALS = frozenset({"ismael-legacy@gnosi.app"})


def is_auto_provisioned_account(user) -> bool:
    """True when nobody deliberately invited this account.

    `users.auto_provisioned` is the real answer: every minting path records it,
    so a future path is covered the moment it sets the column, whatever address
    it invents. The address heuristic is kept as a SECOND line rather than
    replaced, because the column can be absent in ways the code cannot see —
    a DB restored from a pre-column backup, a row inserted by hand, a backfill
    that ran against an unexpected address shape. The two disagree only in the
    direction that refuses a claim, which is the safe direction: the account is
    still reachable through `pipeline/scripts/set_user_password.py`.
    """
    if getattr(user, "auto_provisioned", False):
        return True
    return is_auto_provisioned_email(getattr(user, "email", "") or "")


def normalize_email(value: str) -> str:
    """Canonical form used for storing and comparing addresses.

    Every write path must store this and every lookup must compare against it.
    The DB's unique index is case-sensitive, so without a single shared rule
    `Someone@x.com` and `someone@x.com` become two accounts, and whichever one a
    login reaches comes down to row order.
    """
    return (value or "").strip().lower()


# ---------- Password hashing ----------

# We call `bcrypt` directly rather than going through passlib. passlib 1.7.4
# (its last release, 2020) reads `bcrypt.__about__.__version__` to detect the
# backend; that attribute was removed in bcrypt 4.1, so with a modern bcrypt the
# detection blows up and passlib then reports EVERY password as "longer than 72
# bytes" — a 10-character one included. The practical effect was that
# `/register` and `/login` could not work at all: hashing raised, and
# `verify_password` swallowed the same error as "wrong password", so it looked
# like bad credentials rather than a broken dependency.

def hash_password(plain: str) -> str:
    """Hash a password with bcrypt.

    Args:
        plain: the plaintext password.

    Returns:
        The bcrypt hash (``$2b$…``) as a str.

    Raises:
        ValueError: if the password is empty or its UTF-8 encoding exceeds
            `BCRYPT_MAX_PASSWORD_BYTES`. We reject rather than truncate:
            silently cutting a password would weaken it without telling anyone,
            and would make two different passwords open the same account.
    """
    if not plain or not isinstance(plain, str):
        raise ValueError("Password buit")
    encoded = plain.encode("utf-8")
    if len(encoded) > BCRYPT_MAX_PASSWORD_BYTES:
        raise ValueError(
            f"La contrasenya supera el límit de {BCRYPT_MAX_PASSWORD_BYTES} bytes de bcrypt"
        )
    return bcrypt.hashpw(encoded, bcrypt.gensalt(rounds=BCRYPT_ROUNDS)).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    """True if `plain` matches the hash.

    Never raises on malformed input: an unparseable hash or a wrong type is
    treated as "does not match".

    Over-long passwords fall back to comparing the first
    `BCRYPT_MAX_PASSWORD_BYTES` bytes. This is NOT a shortcut — it is required to
    keep existing users able to log in. passlib's bcrypt handler ships with
    `truncate_error=False`, so every install that hashed through passlib stored
    `hash(password[:72])` for anything longer, and `/register` accepted up to 128
    characters. Rejecting outright here would tell those users "wrong
    credentials" forever, with nothing in the logs to explain it. Byte-slicing
    (not character-slicing) is what passlib did, so the comparison matches.

    The cost is that for such a legacy hash, the full password and its 72-byte
    prefix both authenticate — inherent to what was stored, not something this
    function can undo. New passwords cannot reach this state: `hash_password`
    refuses over-long input, so the fallback only ever applies to old hashes.
    """
    if not plain or not hashed:
        return False
    try:
        encoded = plain.encode("utf-8")
        if len(encoded) > BCRYPT_MAX_PASSWORD_BYTES:
            encoded = encoded[:BCRYPT_MAX_PASSWORD_BYTES]
        return bcrypt.checkpw(encoded, hashed.encode("utf-8"))
    except (ValueError, TypeError):
        return False


# ---------- JWT ----------

def create_access_token(user_id: str, ttl_days: Optional[int] = None) -> str:
    """Issues a JWT signed with the secret. `sub` = user_id."""
    assert_signing_secret_safe()
    if not user_id:
        raise ValueError("user_id is empty")
    now = datetime.now(timezone.utc)
    ttl = timedelta(days=ttl_days or DEFAULT_TTL_DAYS)
    payload = {
        "sub": str(user_id),
        "iat": int(now.timestamp()),
        "exp": int((now + ttl).timestamp()),
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def decode_access_token(token: str) -> Optional[str]:
    """Returns `user_id` if the token is valid; `None` otherwise.

    Does not raise HTTPException directly — the caller decides what to do
    with None (e.g. 401 for a protected endpoint, legacy fallback
    for middleware compatibility).
    
    """
    if not token:
        return None
    # Never accept a token verified with the public dev fallback on an exposed
    # deployment — that would let anyone forge a session.
    assert_signing_secret_safe()
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return payload.get("sub")
    except JWTError:
        return None


# ---------- FastAPI dependency helpers ----------

def get_current_user_id(
    gnosi_session: Optional[str] = Cookie(default=None),
    authorization: Optional[str] = Header(default=None),
    db: Session = Depends(get_mgmt_db),
) -> Optional[str]:
    """Resolves the current user from:
      1. `gnosi_session` cookie (preferred — set by /api/auth/login).
      2. `Authorization: Bearer <token>` header (for API clients).

    Returns `None` if no valid source is present; raises HTTPException
    only if a source is present but the token is malformed or expired
    (an explicit 401 is better than a silent one).
    
    """
    # 1) Cookie
    if gnosi_session:
        uid = decode_access_token(gnosi_session)
        if uid:
            return uid
        # Cookie present but invalid → 401 with a clear message
        raise HTTPException(status_code=401, detail="Sessió expirada o invàlida")

    # 2) Header Authorization — either a session JWT or a Personal Access Token.
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization[7:].strip()
        # A PAT is not a JWT, so it has to be recognised before decoding:
        # otherwise every non-browser client authenticating with one would be
        # rejected as a malformed token.
        if looks_like_pat(token):
            uid = resolve_pat_user_id(db, token)
            if uid:
                return uid
            raise HTTPException(status_code=401, detail="Token invàlid o revocat")
        uid = decode_access_token(token)
        if uid:
            return uid
        raise HTTPException(status_code=401, detail="Bearer token invàlid")

    return None


def resolve_identity(conn, db_factory=None) -> Optional[str]:
    """Identity from a connection, or None. NEVER raises.

    `get_current_user_id` is a FastAPI dependency that raises 401 when a cookie
    is present but undecodable — right for an endpoint that needs a user, wrong
    for a gate that runs on every request: an expired cookie would then 401
    `POST /api/auth/login` and `POST /api/auth/logout`, i.e. both ways out of
    the bad cookie, leaving the browser stuck until someone clears it by hand.

    Takes an `HTTPConnection` rather than a `Request` so it also works for
    WebSocket connections, which have cookies and headers but no `Request`.

    `db_factory` is a generator callable (defaults to `get_mgmt_db`) opened ONLY
    on the branch that needs it. A cookie or bearer-JWT identity is verified with
    the signing key alone and an anonymous request needs nothing, so a session is
    checked out solely for a PAT — the one credential stored in a table.
    """
    token = None
    try:
        token = conn.cookies.get(COOKIE_NAME)
    except Exception:
        token = None
    if token:
        uid = decode_access_token(token)
        if uid:
            return uid
        # Fall through: an unusable cookie means "not signed in", not "error".

    authorization = conn.headers.get("authorization") if conn.headers else None
    if authorization and authorization.lower().startswith("bearer "):
        raw = authorization[7:].strip()
        if looks_like_pat(raw):
            # The DB is the one part of this that can fail. `resolve_pat_user_id`
            # issues a query AND a commit, so a locked or unavailable SQLite file
            # would raise here — and because this runs on the gate, i.e. on every
            # request, that would turn a transient DB blip into a 500 across the
            # whole API instead of an unauthenticated request. Failing closed
            # (None) degrades to 401, which is recoverable and honest.
            gen = None
            try:
                gen = (db_factory or get_mgmt_db)()
                return resolve_pat_user_id(next(gen), raw)
            except Exception:
                log.warning("PAT lookup failed; treating the request as unauthenticated",
                            exc_info=True)
                return None
            finally:
                if gen is not None:
                    gen.close()
        return decode_access_token(raw)

    return None


def get_effective_user_id(
    auth_uid: Optional[str] = Depends(get_current_user_id),
    db: Session = Depends(get_mgmt_db),
) -> str:
    """`resolve_effective_user_id` as a FastAPI dependency.

    For endpoints that need to know who is calling but not which workspace, so
    they do not have to reach for `X-User-ID` to find out — which is how three
    routes in `workspace_routes` ended up trusting a caller-supplied id.
    """
    return resolve_effective_user_id(auth_uid, db)


def require_authenticated(uid: Optional[str] = Depends(get_current_user_id)) -> str:
    """Dependency that **forces** authentication. Helper for protected
    endpoints that don't accept a legacy fallback.

    Usage:
        @router.get("/whoami")
        def me(uid: str = Depends(require_authenticated)):
            ...
    
    """
    # `uid` is resolved via Depends(get_current_user_id) (cookie/Bearer). WITHOUT this
    # Depends on the parameter, FastAPI treated it as a query param `uid`: the endpoint
    # would end up either always 401 (without ?uid) or BYPASSABLE (?uid=any value).
    # Here we only validate that a resolved identity exists.
    if not uid:
        raise HTTPException(status_code=401, detail="Authentication required")
    return uid


def resolve_effective_user_id(auth_uid: Optional[str], db) -> str:
    """Who this request is, from the only two sources that can be trusted.

    1. A credential the caller cannot mint — session cookie or PAT — already
       resolved into `auth_uid`.
    2. Being the install's sole local account, read from the DB.

    `X-User-ID` is deliberately absent, and that is the point of this function.
    It is a plain request header, so honouring it let any caller name
    themselves: as the legacy account (a default published in this public
    repo), or as an id that did not exist yet — which `_ensure_personal_exists`
    would then MINT, with `owner` on the shared personal workspace. It used to
    be ignored only while `GNOSI_REQUIRE_AUTH` was on, which made an open API
    the price of not having a login screen. Those two things are now
    independent: the header grants nothing either way, so a local install can
    skip the login screen without also trusting whoever reaches the port.

    Raises:
        HTTPException: 401 when there is no credential and no unambiguous
            local identity to fall back on.
    """
    if auth_uid:
        return auth_uid

    if require_auth_enabled(db):
        raise HTTPException(status_code=401, detail="Authentication required")

    # Ambient local identity. `sole_account_id` returns None only on a fresh
    # install (zero accounts), where the bootstrap below mints the single local
    # account under a fixed id — fixed, and therefore not caller-chosen.
    return sole_account_id(db) or LEGACY_USER_ID
