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
from typing import Any, cast

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, EmailStr, Field, field_validator
from sqlalchemy import func
from sqlalchemy.orm import Session

from backend.data.management_db import get_mgmt_db
from backend.models.management import User, Membership, Workspace
from backend.services.auth_service import (
    BCRYPT_MAX_PASSWORD_BYTES,
    is_auto_provisioned_account,
    COOKIE_NAME,
    DEFAULT_TTL_DAYS,
    create_access_token,
    get_current_user_id,
    hash_password,
    normalize_email,
    verify_password,
)


router = APIRouter(prefix="/api/auth", tags=["auth"])
_LEGACY_JSON_200: dict[int | str, dict[str, Any]] = {
    200: {"content": {"application/json": {"schema": {}}}}
}
_LEGACY_JSON_201: dict[int | str, dict[str, Any]] = {
    201: {"content": {"application/json": {"schema": {}}}}
}


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
    name: str | None = None

    _check_password = field_validator("password")(_validate_password_bytes)


class LoginPayload(BaseModel):
    email: EmailStr
    password: str


class ChangePasswordPayload(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8, max_length=128)

    _check_password = field_validator("new_password")(_validate_password_bytes)


class UpdateProfilePayload(BaseModel):
    name: str | None = Field(default=None, max_length=120)
    email: EmailStr | None = None
    # Required when `email` changes; ignored otherwise.
    current_password: str | None = None


class UserInfo(BaseModel):
    id: str
    email: str
    name: str | None = None
    avatar_url: str | None = None
    workspaces: list[dict[str, Any]] = Field(default_factory=list)


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


def _find_user_by_email(db: Session, email: str) -> User | None:
    """Look a user up by email, case-insensitively.

    Email local-parts are technically case-sensitive but no real provider treats
    them that way, and users do not type their address consistently. Matching
    exactly let `Victim@corp.com` slip past the duplicate check for
    `victim@corp.com`: the DB unique index does not collapse case either, so both
    rows survived and which one a login reached came down to row order.
    """
    return db.query(User).filter(func.lower(User.email) == normalize_email(email)).first()


def _user_to_info(user: User, db: Session) -> UserInfo:
    """Loads the workspaces the user belongs to."""
    memberships = db.query(Membership).filter(Membership.user_id == user.id).all()
    ws_info: list[dict[str, Any]] = []
    for m in memberships:
        ws = db.query(Workspace).filter(Workspace.id == m.workspace_id).first()
        if ws:
            ws_info.append(
                {
                    "id": cast(str, ws.id),
                    "name": cast(str, ws.name),
                    "role": cast(str, m.role),
                }
            )
    return UserInfo(
        id=cast(str, user.id),
        email=cast(str, user.email),
        name=cast(str | None, user.name),
        avatar_url=cast(str | None, user.avatar_url),
        workspaces=ws_info,
    )


# ---------- Endpoints ----------


@router.post(
    "/register",
    status_code=201,
    response_model=None,
    responses=_LEGACY_JSON_201,
)
def register(
    payload: RegisterPayload,
    response: Response,
    db: Session = Depends(get_mgmt_db),
) -> Any:
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
            raise HTTPException(status_code=409, detail="This email is already registered")
        # The claim flow below is for INVITED users: someone deliberately created
        # a membership for their real address, so knowing that address is a weak
        # but deliberate proof of identity. It must not extend to the
        # auto-provisioned account, whose address is the same hardcoded
        # placeholder on every install and is published in this repo — claiming
        # it needs no knowledge at all, and it owns the workspace, the vaults and
        # the API tokens. Bootstrapping that account requires filesystem access:
        # `pipeline/scripts/set_user_password.py`.
        if is_auto_provisioned_account(existing):
            raise HTTPException(
                status_code=403,
                detail=(
                    "This is the default local account and cannot be claimed by email. "
                    "Run pipeline/scripts/set_user_password.py on the server."
                ),
            )
        # Claim: assign a password to the pre-existing user (their memberships).
        setattr(existing, "password_hash", hash_password(payload.password))
        if payload.name and not existing.name:
            setattr(existing, "name", payload.name)
        try:
            db.commit()
        except Exception:
            db.rollback()
            raise HTTPException(status_code=500, detail="Error saving the password")
        _set_session_cookie(response, cast(str, existing.id))
        return _user_to_info(existing, db)

    # New case: create user
    user = User(
        email=normalize_email(payload.email),
        name=payload.name or payload.email.split("@", 1)[0],
        password_hash=hash_password(payload.password),
    )
    db.add(user)
    try:
        db.commit()
        db.refresh(user)
    except Exception:
        db.rollback()
        raise HTTPException(status_code=500, detail="Error creating the user")

    _set_session_cookie(response, cast(str, user.id))
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


@router.post("/login", response_model=None, responses=_LEGACY_JSON_200)
def login(
    payload: LoginPayload,
    response: Response,
    db: Session = Depends(get_mgmt_db),
) -> Any:
    """Login via email + password. 401 if credentials are incorrect."""
    user = _find_user_by_email(db, payload.email)
    if not user or not user.password_hash:
        # Same message for "doesn't exist" and "has no password" to avoid
        # enumeration attacks (attack: trying emails to find out if they exist).
        raise HTTPException(status_code=401, detail="Email o contrasenya incorrectes")
    if not verify_password(payload.password, cast(str, user.password_hash)):
        raise HTTPException(status_code=401, detail="Email o contrasenya incorrectes")

    _set_session_cookie(response, cast(str, user.id))
    return _user_to_info(user, db)


@router.post("/logout", response_model=None, responses=_LEGACY_JSON_200)
def logout(response: Response) -> Any:
    """Deletes the session cookie. Idempotent."""
    response.delete_cookie(COOKIE_NAME, path="/")
    return {"ok": True}


@router.get("/me", response_model=None, responses=_LEGACY_JSON_200)
def me(
    uid: str | None = Depends(get_current_user_id),
    db: Session = Depends(get_mgmt_db),
) -> Any:
    """Current authenticated user. 401 if there's no session.

    The frontend uses this at bootstrap to decide whether to render the
    login screen or the main app.

    """
    if not uid:
        raise HTTPException(status_code=401, detail="Not authenticated")
    user = db.query(User).filter(User.id == uid).first()
    if not user:
        # Valid token but user deleted from the DB — clear cookie.
        raise HTTPException(status_code=401, detail="User not found")
    return _user_to_info(user, db)


def _require_credentialed_user(uid: str | None, db: Session) -> User:
    """Resolves the authenticated user for the self-service account endpoints.

    Only accounts that ALREADY hold a password may use them: the NOTE above
    explains why handing first credentials to a request-derived identity is an
    account-takeover hole, and that reasoning applies here unchanged. Password-
    less accounts are pointed to their claim flow (`/register` for invited
    users, `set_user_password.py` for the local default account).
    """
    if not uid:
        raise HTTPException(status_code=401, detail="Not authenticated")
    user = db.query(User).filter(User.id == uid).first()
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    if not user.password_hash:
        raise HTTPException(
            status_code=403,
            detail=(
                "This account does not have a password yet. Claim it by registering "
                "with its email or, for the default local account, run "
                "pipeline/scripts/set_user_password.py on the server."
            ),
        )
    return user


@router.post("/change-password", response_model=None, responses=_LEGACY_JSON_200)
def change_password(
    payload: ChangePasswordPayload,
    uid: str | None = Depends(get_current_user_id),
    db: Session = Depends(get_mgmt_db),
) -> Any:
    """Rotates the authenticated user's password.

    Safe as an HTTP endpoint (unlike first credentials, see the NOTE above)
    because it demands the CURRENT password — exactly the knowledge the
    takeover hole lacks. 403 (not 401) on a wrong current password so the
    frontend never mistakes it for an expired session.
    """
    user = _require_credentialed_user(uid, db)
    if not verify_password(payload.current_password, cast(str, user.password_hash)):
        raise HTTPException(status_code=403, detail="La contrasenya actual no és correcta")

    setattr(user, "password_hash", hash_password(payload.new_password))
    try:
        db.commit()
    except Exception:
        db.rollback()
        raise HTTPException(status_code=500, detail="Error desant la contrasenya")
    return {"ok": True}


@router.patch("/me", response_model=None, responses=_LEGACY_JSON_200)
def update_me(
    payload: UpdateProfilePayload,
    uid: str | None = Depends(get_current_user_id),
    db: Session = Depends(get_mgmt_db),
) -> Any:
    """Updates the authenticated user's name and/or email.

    The email is the login identifier, so changing it requires the current
    password: a hijacked session alone must not be able to move the account
    to an address the attacker controls. The name is cosmetic and needs no
    extra proof. Empty strings are treated as "leave unchanged".
    """
    user = _require_credentialed_user(uid, db)

    new_email = normalize_email(payload.email) if payload.email else None
    current_email = cast(str, user.email)
    if new_email and new_email != current_email.lower():
        if not payload.current_password or not verify_password(
            payload.current_password, cast(str, user.password_hash)
        ):
            raise HTTPException(status_code=403, detail="The current password is incorrect")
        other = _find_user_by_email(db, new_email)
        if other and other.id != user.id:
            raise HTTPException(status_code=409, detail="This email is already registered")
        setattr(user, "email", new_email)

    if payload.name is not None and payload.name.strip():
        setattr(user, "name", payload.name.strip())

    try:
        db.commit()
    except Exception:
        db.rollback()
        raise HTTPException(status_code=500, detail="Error desant el perfil")
    return _user_to_info(user, db)
