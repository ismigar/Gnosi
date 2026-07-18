"""Auth endpoints — register / login / logout / me.

Minimal but functional JWT system:
  - HttpOnly `gnosi_session` cookie set on login.
  - `GET /api/auth/me` returns the current user (404 if not authenticated).
  - `POST /api/auth/logout` clears the cookie.

For production we'll need to add:
  - Rate limiting on login (avoid brute force).
  - Optional Captcha / 2FA.
  - Verify-email flow (sends confirmation, marks user.email_verified).
  - Reset-password flow (email + temporary token).

For the cooperative demo, the minimum viable flow is enough: each
cooperative creates its workspace, invites members by email, the
members register with the same email and can log in.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, EmailStr, Field, field_validator
from sqlalchemy import func
from sqlalchemy.orm import Session

from backend.data.management_db import get_mgmt_db
from backend.models.management import User, Membership, Workspace
from backend.services.auth_service import (
    BCRYPT_MAX_PASSWORD_BYTES,
    COOKIE_NAME,
    DEFAULT_TTL_DAYS,
    create_access_token,
    get_current_user_id,
    hash_password,
    verify_password,
)


router = APIRouter(prefix="/api/auth", tags=["auth"])


# ---------- Payloads ----------

def _validate_password_bytes(value: str) -> str:
    """Reject passwords bcrypt cannot hash, as a field error instead of a 500.

    The limit is on the UTF-8 encoding, not the character count, so a password
    of accented or non-Latin characters hits it well before 72 characters.
    """
    if len(value.encode("utf-8")) > BCRYPT_MAX_PASSWORD_BYTES:
        raise ValueError(
            f"La contrasenya supera el límit de {BCRYPT_MAX_PASSWORD_BYTES} bytes "
            "(els caràcters accentuats compten doble)"
        )
    return value


class RegisterPayload(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    name: Optional[str] = None

    _check_password = field_validator("password")(_validate_password_bytes)


class LoginPayload(BaseModel):
    email: EmailStr
    password: str


class UserInfo(BaseModel):
    id: str
    email: str
    name: Optional[str] = None
    avatar_url: Optional[str] = None
    workspaces: list[dict] = []


# ---------- Helpers ----------

def _set_session_cookie(response: Response, user_id: str) -> None:
    """Issues a token and stores it in an HttpOnly + SameSite=Lax cookie.

    In personal mode (local HTTP), we don't set `secure=True` by default
    because it would break with localhost. In production the reverse proxy must
    set `secure=True` explicitly, or we derive it from an env var.
    
    """
    token = create_access_token(user_id)
    response.set_cookie(
        key=COOKIE_NAME,
        value=token,
        max_age=DEFAULT_TTL_DAYS * 24 * 3600,
        httponly=True,
        samesite="lax",
        secure=False,  # needs to be True in production with HTTPS
        path="/",
    )


def _find_user_by_email(db: Session, email: str) -> Optional[User]:
    """Look a user up by email, case-insensitively.

    Email local-parts are technically case-sensitive but no real provider treats
    them that way, and users do not type their address consistently. Matching
    exactly let `Victim@corp.com` slip past the duplicate check for
    `victim@corp.com`: the DB unique index does not collapse case either, so both
    rows survived and which one a login reached came down to row order.
    """
    return db.query(User).filter(func.lower(User.email) == email.strip().lower()).first()


def _user_to_info(user: User, db: Session) -> UserInfo:
    """Loads the workspaces the user belongs to."""
    memberships = db.query(Membership).filter(Membership.user_id == user.id).all()
    ws_info = []
    for m in memberships:
        ws = db.query(Workspace).filter(Workspace.id == m.workspace_id).first()
        if ws:
            ws_info.append({
                "id": ws.id,
                "name": ws.name,
                "role": m.role,
            })
    return UserInfo(
        id=user.id,
        email=user.email,
        name=user.name,
        avatar_url=user.avatar_url,
        workspaces=ws_info,
    )


# ---------- Endpoints ----------

@router.post("/register", status_code=201)
def register(
    payload: RegisterPayload,
    response: Response,
    db: Session = Depends(get_mgmt_db),
):
    """Creates a new user with email + password.

    If a user with this email already exists **without a password** (legacy
    or pending membership), sets their password (claim flow). This way a
    cooperative can create memberships by email before users
    have registered — when they register with the same email, they automatically
    inherit the workspaces.
    
    """
    existing = _find_user_by_email(db, payload.email)
    if existing:
        if existing.password_hash:
            raise HTTPException(status_code=409, detail="Aquest email ja està registrat")
        # Claim: assign a password to the pre-existing user (their memberships).
        existing.password_hash = hash_password(payload.password)
        if payload.name and not existing.name:
            existing.name = payload.name
        try:
            db.commit()
        except Exception:
            db.rollback()
            raise HTTPException(status_code=500, detail="Error desant la contrasenya")
        _set_session_cookie(response, existing.id)
        return _user_to_info(existing, db)

    # New case: create user
    user = User(
        email=payload.email.strip().lower(),
        name=payload.name or payload.email.split("@", 1)[0],
        password_hash=hash_password(payload.password),
    )
    db.add(user)
    try:
        db.commit()
        db.refresh(user)
    except Exception:
        db.rollback()
        raise HTTPException(status_code=500, detail="Error creant usuari")

    _set_session_cookie(response, user.id)
    return _user_to_info(user, db)


# NOTE: there is deliberately no HTTP endpoint for giving a password-less
# account its first credentials. The obvious design — resolve the account from
# the request context and set a password on it — is an account-takeover hole,
# because `get_workspace_context` derives the user from the `X-User-ID` header,
# which the caller controls: anyone able to reach the API could install their own
# password on `ismael-legacy` (a default published in this repo) or on any
# invited/OAuth user that has not registered yet, and walk away with durable
# credentials. Claiming an account by *email* is already handled safely by
# `/register` above; the remaining case — the legacy account, whose email is the
# placeholder `user@example.com` — is a one-time local migration, so it lives in
# `pipeline/scripts/set_user_password.py`, which needs filesystem access to the
# management DB and therefore has no remote attack surface at all.


@router.post("/login")
def login(
    payload: LoginPayload,
    response: Response,
    db: Session = Depends(get_mgmt_db),
):
    """Login via email + password. 401 if credentials are incorrect."""
    user = _find_user_by_email(db, payload.email)
    if not user or not user.password_hash:
        # Same message for "doesn't exist" and "has no password" to avoid
        # enumeration attacks (attack: trying emails to find out if they exist).
        raise HTTPException(status_code=401, detail="Email o contrasenya incorrectes")
    if not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Email o contrasenya incorrectes")

    _set_session_cookie(response, user.id)
    return _user_to_info(user, db)


@router.post("/logout")
def logout(response: Response):
    """Deletes the session cookie. Idempotent."""
    response.delete_cookie(COOKIE_NAME, path="/")
    return {"ok": True}


@router.get("/me")
def me(
    uid: Optional[str] = Depends(get_current_user_id),
    db: Session = Depends(get_mgmt_db),
):
    """Current authenticated user. 401 if there's no session.

    The frontend uses this at bootstrap to decide whether to render the
    login screen or the main app.
    
    """
    if not uid:
        raise HTTPException(status_code=401, detail="No autenticat")
    user = db.query(User).filter(User.id == uid).first()
    if not user:
        # Valid token but user deleted from the DB — clear cookie.
        raise HTTPException(status_code=401, detail="Usuari no trobat")
    return _user_to_info(user, db)
