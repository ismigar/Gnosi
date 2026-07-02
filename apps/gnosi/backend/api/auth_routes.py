"""Auth endpoints — register / login / logout / me.

Sistema JWT minimal però funcional:
  - Cookie HttpOnly `gnosi_session` set al login.
  - `GET /api/auth/me` retorna l'usuari actual (404 si no autenticat).
  - `POST /api/auth/logout` clear la cookie.

Para a producció caldrà afegir:
  - Rate limiting al login (evitar brute force).
  - Captcha / 2FA opcional.
  - Verify-email flow (envia confirmació, marca user.email_verified).
  - Reset-password flow (email + token temporal).

Per a la demo cooperativa, el flux mínim viable és suficient: cada
cooperativa crea el seu workspace, convida membres per email, els
membres es registren amb el mateix email i poden entrar.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy.orm import Session

from backend.data.management_db import get_mgmt_db
from backend.models.management import User, Membership, Workspace
from backend.services.auth_service import (
    COOKIE_NAME,
    DEFAULT_TTL_DAYS,
    create_access_token,
    get_current_user_id,
    hash_password,
    verify_password,
)


router = APIRouter(prefix="/api/auth", tags=["auth"])


# ---------- Payloads ----------

class RegisterPayload(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    name: Optional[str] = None


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
    """Emet token i el guarda a una cookie HttpOnly + SameSite=Lax.

    En personal mode (HTTP local), no marquem `secure=True` per defecte
    perquè trencaria amb localhost. A producció el reverse proxy ha de
    set `secure=True` explícitament o ho derivem d'una env var.
    """
    token = create_access_token(user_id)
    response.set_cookie(
        key=COOKIE_NAME,
        value=token,
        max_age=DEFAULT_TTL_DAYS * 24 * 3600,
        httponly=True,
        samesite="lax",
        secure=False,  # cal True a producció amb HTTPS
        path="/",
    )


def _user_to_info(user: User, db: Session) -> UserInfo:
    """Carrega els workspaces a què pertany l'usuari."""
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
    """Crea un nou usuari amb email + password.

    Si ja existeix un usuari amb aquest email **sense password** (legacy
    o membership pendent), li set el password (claim flow). Així una
    cooperativa pot crear memberships per email abans que els usuaris
    s'hagin registrat — quan es registren amb el mateix email, hereten
    automàticament els workspaces.
    """
    existing = db.query(User).filter(User.email == payload.email).first()
    if existing:
        if existing.password_hash:
            raise HTTPException(status_code=409, detail="Aquest email ja està registrat")
        # Claim: assignar password a l'usuari pre-existent (memberships seus).
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

    # Cas nou: crear usuari
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


@router.post("/login")
def login(
    payload: LoginPayload,
    response: Response,
    db: Session = Depends(get_mgmt_db),
):
    """Login per email + password. 401 si credencials incorrectes."""
    user = db.query(User).filter(User.email == payload.email).first()
    if not user or not user.password_hash:
        # Mateix missatge per "no existeix" i "no té password" per evitar
        # enumeration attacks (atac: provar emails per saber si existeixen).
        raise HTTPException(status_code=401, detail="Email o contrasenya incorrectes")
    if not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Email o contrasenya incorrectes")

    _set_session_cookie(response, user.id)
    return _user_to_info(user, db)


@router.post("/logout")
def logout(response: Response):
    """Esborra la cookie de sessió. Idempotent."""
    response.delete_cookie(COOKIE_NAME, path="/")
    return {"ok": True}


@router.get("/me")
def me(
    uid: Optional[str] = Depends(get_current_user_id),
    db: Session = Depends(get_mgmt_db),
):
    """Usuari autenticat actual. 401 si no hi ha sessió.

    El frontend l'usa al bootstrap per decidir si renderitzar la pantalla
    de login o la app principal.
    """
    if not uid:
        raise HTTPException(status_code=401, detail="No autenticat")
    user = db.query(User).filter(User.id == uid).first()
    if not user:
        # Token vàlid però usuari esborrat al BD — clear cookie.
        raise HTTPException(status_code=401, detail="Usuari no trobat")
    return _user_to_info(user, db)
