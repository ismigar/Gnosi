"""Authentication service — JWT cookies + bcrypt password hashing.

Aquesta capa substitueix el legacy `X-User-ID` header per autenticació
real basada en JWT. Mantenim compatibilitat amb el header header X-User-ID
per a scripts/Docker existents (`get_user_id_or_legacy()` aplica un
fallback no-trencador).

Tokens:
  - HS256 signat amb `GNOSI_JWT_SECRET` (env var; fallback dev hardcoded).
  - TTL per defecte 7 dies — cookies `HttpOnly`, `SameSite=Lax`.
  - Payload mínim: `{sub: user_id, exp: int, iat: int}`.

Passwords:
  - bcrypt via `passlib`, cost 12 (defecte robust).
  - Mai emmagatzemats en clar; mai retornats al client.
"""
from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import Cookie, Depends, Header, HTTPException
from jose import JWTError, jwt
from passlib.context import CryptContext


# ---------- Configuració ----------

_SECRET_FALLBACK_DEV = "dev-only-secret-please-set-GNOSI_JWT_SECRET-in-production"
SECRET_KEY: str = os.environ.get("GNOSI_JWT_SECRET", _SECRET_FALLBACK_DEV)
ALGORITHM: str = "HS256"
DEFAULT_TTL_DAYS: int = 7
COOKIE_NAME: str = "gnosi_session"

# Bcrypt context — cost 12 és el valor canònic per a 2024-2026 (uns 250 ms / hash).
_pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto", bcrypt__rounds=12)


# ---------- Password hashing ----------

def hash_password(plain: str) -> str:
    """Bcrypt hash. Lança ValueError si la contrasenya és vacia."""
    if not plain or not isinstance(plain, str):
        raise ValueError("Password buit")
    return _pwd_context.hash(plain)


def verify_password(plain: str, hashed: str) -> bool:
    """True si `plain` coincideix amb el hash. Mai lança per format invàlid:
    qualsevol fallada de comparació es tracta com a "no coincideix"."""
    if not plain or not hashed:
        return False
    try:
        return _pwd_context.verify(plain, hashed)
    except (ValueError, TypeError):
        return False


# ---------- JWT ----------

def create_access_token(user_id: str, ttl_days: Optional[int] = None) -> str:
    """Emet un JWT signat amb el secret. `sub` = user_id."""
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
    """Retorna `user_id` si el token és vàlid; `None` altrament.

    No lança HTTPException directament — el caller decideix què fer
    amb None (tipus 401 per a un endpoint protegit, fallback legacy
    per al middleware compatibility).
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
    """Resol l'usuari actual a partir de:
      1. Cookie `gnosi_session` (preferent — set pel /api/auth/login).
      2. Header `Authorization: Bearer <token>` (per a clients API).

    Retorna `None` si no hi ha cap font vàlida; lança HTTPException
    només si una font és present però el token és malformat o expirat
    (millor 401 explícit que silenciós).
    """
    # 1) Cookie
    if gnosi_session:
        uid = decode_access_token(gnosi_session)
        if uid:
            return uid
        # Cookie present però invàlida → 401 amb missatge clar
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
    """Dependency que **força** autenticació. Helper per a endpoints
    protegits que no accepten fallback legacy.

    Ús:
        @router.get("/whoami")
        def me(uid: str = Depends(require_authenticated)):
            ...
    """
    # `uid` es resol via Depends(get_current_user_id) (cookie/Bearer). SENSE aquest
    # Depends al paràmetre, FastAPI el tractava com un query param `uid`: l'endpoint
    # quedava o bé sempre 401 (sense ?uid) o bé BYPASSABLE (?uid=qualsevol valor).
    # Aquí només validem que hi hagi identitat resolta.
    if not uid:
        raise HTTPException(status_code=401, detail="Cal autenticació")
    return uid


def get_user_id_or_legacy(
    auth_uid: Optional[str] = None,
    x_user_id: Optional[str] = None,
) -> str:
    """Fallback compatible amb el sistema legacy.

    Prioritat:
      1. JWT (cookie o Bearer) → usuari real.
      2. Header `X-User-ID` → user_id explícit (scripts, Docker init).
      3. "ismael-legacy" → default històric per a sessions interactives
         sense auth a setup personal.

    Aquest helper l'utilitza `workspace_service.get_workspace_context`
    per migrar gradualment sense trencar instal·lacions existents.
    """
    if auth_uid:
        return auth_uid
    if x_user_id:
        return x_user_id
    return "ismael-legacy"
