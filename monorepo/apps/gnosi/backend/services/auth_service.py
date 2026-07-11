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
  - bcrypt via `passlib`, cost 12 (robust default).
  - Never stored in plaintext; never returned to the client.
"""
from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import Cookie, Depends, Header, HTTPException
from jose import JWTError, jwt
from passlib.context import CryptContext


# ---------- Configuration ----------

_SECRET_FALLBACK_DEV = "dev-only-secret-please-set-GNOSI_JWT_SECRET-in-production"
SECRET_KEY: str = os.environ.get("GNOSI_JWT_SECRET", _SECRET_FALLBACK_DEV)
ALGORITHM: str = "HS256"
DEFAULT_TTL_DAYS: int = 7
COOKIE_NAME: str = "gnosi_session"

# Bcrypt context — cost 12 is the canonical value for 2024-2026 (about 250 ms / hash).
_pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto", bcrypt__rounds=12)


# ---------- Password hashing ----------

def hash_password(plain: str) -> str:
    """Bcrypt hash. Raises ValueError if the password is empty."""
    if not plain or not isinstance(plain, str):
        raise ValueError("Password buit")
    return _pwd_context.hash(plain)


def verify_password(plain: str, hashed: str) -> bool:
    """True if `plain` matches the hash. Never raises due to invalid format:
    any comparison failure is treated as "does not match"."""
    if not plain or not hashed:
        return False
    try:
        return _pwd_context.verify(plain, hashed)
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
