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
from backend.services.workspace_service import WorkspaceContext, get_workspace_context


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


class BootstrapCredentialsPayload(BaseModel):
    """First-time credentials for a user that has none (see bootstrap_credentials)."""

    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    name: Optional[str] = None

    _check_password = field_validator("password")(_validate_password_bytes)


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
    existing = db.query(User).filter(User.email == payload.email).first()
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
        email=payload.email,
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


@router.post("/bootstrap-credentials")
def bootstrap_credentials(
    payload: BootstrapCredentialsPayload,
    response: Response,
    context: WorkspaceContext = Depends(get_workspace_context),
    db: Session = Depends(get_mgmt_db),
):
    """Give the current password-less user real credentials, once.

    This is the `set-password` flow the `User.password_hash` docstring refers
    to, and it exists for one specific situation: an install whose only user is
    the pre-auth legacy account (`ismael-legacy`), which owns the workspace, the
    vaults and the API tokens but has no way to log in. `/register` can only
    claim such a user by matching its email, which for that account is the
    placeholder `user@example.com` — so claiming through it would freeze a fake
    address in place forever. Here the user is resolved from the request context
    instead, so a real email can be set at the same time.

    The account keeps its `id`, which is what memberships, vaults and PATs are
    keyed by: nothing has to be migrated.

    Refuses once a password exists (409), so it cannot be used to take over an
    account or to reset a forgotten password — that is the reset-password flow's
    job. While the legacy fallback is still enabled, any caller that can reach
    the API already has owner access, so this endpoint grants no privilege it
    did not already have; it is the step that makes removing that fallback
    possible.
    """
    user = db.query(User).filter(User.id == context.user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Usuari no trobat")
    if user.password_hash:
        raise HTTPException(
            status_code=409,
            detail="Aquest usuari ja té contrasenya. Usa el login o el reset de contrasenya.",
        )

    # A different account already using this email would make login ambiguous.
    clash = db.query(User).filter(User.email == payload.email, User.id != user.id).first()
    if clash:
        raise HTTPException(status_code=409, detail="Aquest email ja està registrat")

    user.email = payload.email
    user.password_hash = hash_password(payload.password)
    if payload.name:
        user.name = payload.name
    try:
        db.commit()
    except Exception:
        db.rollback()
        raise HTTPException(status_code=500, detail="Error desant les credencials")

    _set_session_cookie(response, user.id)
    return _user_to_info(user, db)


@router.post("/login")
def login(
    payload: LoginPayload,
    response: Response,
    db: Session = Depends(get_mgmt_db),
):
    """Login via email + password. 401 if credentials are incorrect."""
    user = db.query(User).filter(User.email == payload.email).first()
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
