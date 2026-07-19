"""Authentication service — JWT cookies + bcrypt password hashing.

This layer replaces the legacy `X-User-ID` header with real JWT-based
authentication. We maintain compatibility with the X-User-ID header
for existing scripts/Docker (`get_user_id_or_legacy()` applies a
non-breaking fallback).

Tokens:
  - HS256 signed with `GNOSI_JWT_SECRET` (env var; hardcoded dev fallback).
  - Default TTL 7 days — `HttpOnly`, `SameSite=Lax` cookies.
  - Minimal payload: `{sub: user_id, exp: int, iat: int}`.

Passwords:
  - bcrypt (called directly), cost 12 (robust default).
  - Never stored in plaintext; never returned to the client.
"""
from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone
from typing import Optional

import bcrypt
from fastapi import Cookie, Depends, Header, HTTPException
from jose import JWTError, jwt


# ---------- Configuration ----------

_SECRET_FALLBACK_DEV = "dev-only-secret-please-set-GNOSI_JWT_SECRET-in-production"
SECRET_KEY: str = os.environ.get("GNOSI_JWT_SECRET", _SECRET_FALLBACK_DEV)
ALGORITHM: str = "HS256"
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


# ---------- Email identity ----------

# The address every auto-provisioned account starts with (see
# `workspace_service._ensure_personal_exists`). It is a placeholder, not a real
# mailbox, and it is identical on every install — so it must never be treated as
# proof of who the caller is.
PLACEHOLDER_EMAIL = "user@example.com"


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
    if not user_id:
        raise ValueError("user_id buit")
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
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return payload.get("sub")
    except JWTError:
        return None


# ---------- FastAPI dependency helpers ----------

def get_current_user_id(
    gnosi_session: Optional[str] = Cookie(default=None),
    authorization: Optional[str] = Header(default=None),
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

    # 2) Header Authorization
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization[7:].strip()
        uid = decode_access_token(token)
        if uid:
            return uid
        raise HTTPException(status_code=401, detail="Bearer token invàlid")

    return None


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
        raise HTTPException(status_code=401, detail="Cal autenticació")
    return uid


def get_user_id_or_legacy(
    auth_uid: Optional[str] = None,
    x_user_id: Optional[str] = None,
) -> str:
    """Fallback compatible with the legacy system.

    Priority:
      1. JWT (cookie or Bearer) → real user.
      2. `X-User-ID` header → explicit user_id (scripts, Docker init).
      3. "ismael-legacy" → historical default for interactive sessions
         without auth in a personal setup.

    This helper is used by `workspace_service.get_workspace_context`
    to migrate gradually without breaking existing installations.
    
    """
    if auth_uid:
        return auth_uid
    if x_user_id:
        return x_user_id
    return "ismael-legacy"
