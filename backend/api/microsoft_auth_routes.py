"""Microsoft OAuth2 authentication routes.

Implements the authorization-code flow for Microsoft 365 / Entra ID.
Tokens are stored in integrations.json under 'mail_accounts' with
provider='microsoft' so the rest of the mail stack picks them up
automatically.
"""

import asyncio
import base64
import hashlib
import logging
import re
import secrets
import time
from dataclasses import dataclass
from typing import Any, TypedDict, cast
from urllib.parse import urlencode

import requests as http
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from pydantic import BaseModel

from backend.config.env_config import get_env
from backend.services.integration_manager import integration_manager

router = APIRouter(prefix="/api/auth/microsoft", tags=["auth"])
log = logging.getLogger(__name__)


class MicrosoftOAuthConfig(TypedDict):
    client_id: str
    client_secret: str
    redirect_uri: str


class MicrosoftOAuthStatusResponse(BaseModel):
    configured: bool
    client_id: str | None


@dataclass(frozen=True)
class PendingAuth:
    created_at: float
    code_verifier: str
    config: MicrosoftOAuthConfig
    desktop: bool = False
    locale: str = "en"


# Keep the PKCE verifier server-side, bound to a single short-lived login.
_pending: dict[str, PendingAuth] = {}
_PENDING_TTL_SECONDS = 600.0


def _prune_pending() -> None:
    now = time.monotonic()
    for state, pending in list(_pending.items()):
        if now - pending.created_at >= _PENDING_TTL_SECONDS:
            _pending.pop(state, None)


SCOPES = " ".join(
    [
        "https://graph.microsoft.com/Mail.Read",
        "https://graph.microsoft.com/Mail.ReadWrite",
        "https://graph.microsoft.com/Mail.Send",
        "offline_access",
        "User.Read",
    ]
)

AUTH_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize"
TOKEN_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/token"


def _get_config() -> MicrosoftOAuthConfig | None:
    client_id = get_env("MICROSOFT_OAUTH_CLIENT_ID")
    client_secret = get_env("MICROSOFT_OAUTH_CLIENT_SECRET", "")
    callback_path = "callback" if client_secret else "desktop/callback"
    redirect_uri = get_env(
        "MICROSOFT_OAUTH_REDIRECT_URI",
        f"http://localhost:{get_env('BACKEND_PORT', '5002')}/api/auth/microsoft/{callback_path}",
    )
    # Native desktop registrations are public clients: PKCE replaces a secret.
    # Retain optional secrets for existing confidential web registrations.
    if not client_id:
        return None
    return {"client_id": client_id, "client_secret": client_secret, "redirect_uri": redirect_uri}


@router.get("/status", response_model=MicrosoftOAuthStatusResponse)
async def status() -> dict[str, object]:
    cfg = _get_config()
    return MicrosoftOAuthStatusResponse(
        configured=cfg is not None,
        client_id=cfg["client_id"] if cfg else None,
    ).model_dump()


# OAuth navigation returns a concrete redirect rather than JSON.
@router.get("/login", response_model=None)
async def login(request: Request) -> HTMLResponse | RedirectResponse:
    cfg = _get_config()
    if not cfg:
        return HTMLResponse(
            status_code=400,
            content="""<!doctype html><html lang="ca"><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Connectar Microsoft · Gnosi</title>
<body style="font:18px system-ui;max-width:38rem;margin:12vh auto;padding:24px">
<h1>Cal configurar la connexió de Gnosi amb Microsoft</h1>
<p>Falta el registre de l'aplicació Gnosi a Microsoft. Encara no s'ha iniciat
l'autenticació del teu compte.</p>
<p>La contrasenya del correu no resol aquesta configuració.
Un cop configurada, Microsoft et portarà a l'accés de la teva organització.</p>
<p><a href="/">Tornar a Gnosi</a></p></body></html>""",
            headers={"Cache-Control": "no-store"},
        )
    state = secrets.token_urlsafe(32)
    verifier = secrets.token_urlsafe(64)
    challenge = (
        base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    )
    _prune_pending()
    _pending[state] = PendingAuth(
        time.monotonic(),
        verifier,
        cfg.copy(),
        request.query_params.get("desktop") == "true",
        request.query_params.get("ui_locales", "en").split("-")[0],
    )

    params = {
        "client_id": cfg["client_id"],
        "response_type": "code",
        "redirect_uri": cfg["redirect_uri"],
        "response_mode": "query",
        "scope": SCOPES,
        "state": state,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
    }
    email = request.query_params.get("login_hint", "").strip()
    if len(email) <= 254 and re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email):
        params["login_hint"] = email
    else:
        params["prompt"] = "select_account"
    # urlencode ensures correct encoding of spaces in SCOPES, `://` in
    # redirect_uri, etc. Manual concatenation used to produce invalid URLs
    # depending on the values.
    url = AUTH_URL + "?" + urlencode(params)
    return RedirectResponse(url=url, headers={"Cache-Control": "no-store"})


def _auth_result(pending: PendingAuth, success: bool) -> HTMLResponse | RedirectResponse:
    if not pending.desktop:
        params = {"auth": "microsoft_success"} if success else {"error": "microsoft_cancelled"}
        return RedirectResponse(url="/?" + urlencode(params))
    messages = {
        "ca": (
            "Compte de Microsoft connectat",
            "No s'ha connectat el compte",
            "Ja pots tancar aquesta pestanya i tornar a Gnosi.",
        ),
        "es": (
            "Cuenta de Microsoft conectada",
            "No se ha conectado la cuenta",
            "Ya puedes cerrar esta pestaña y volver a Gnosi.",
        ),
        "fr": (
            "Compte Microsoft connecté",
            "Le compte n'a pas été connecté",
            "Vous pouvez fermer cet onglet et revenir à Gnosi.",
        ),
        "en": (
            "Microsoft account connected",
            "Account not connected",
            "You can close this tab and return to Gnosi.",
        ),
    }
    locale = pending.locale if pending.locale in messages else "en"
    ok, failed, body = messages[locale]
    title = ok if success else failed
    return HTMLResponse(
        f'<!doctype html><html lang="{locale}"><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width, initial-scale=1">'
        f"<title>Gnosi · {title}</title>"
        '<body style="font:18px system-ui;max-width:38rem;margin:12vh auto;padding:24px">'
        f"<h1>{title}</h1><p>{body}</p></body></html>",
        headers={"Cache-Control": "no-store", "Referrer-Policy": "no-referrer"},
    )


@router.get("/callback", response_model=None)
@router.get("/desktop/callback", response_model=None)
async def callback(request: Request) -> HTMLResponse | RedirectResponse:
    code = request.query_params.get("code")
    state = request.query_params.get("state")
    error = request.query_params.get("error")

    _prune_pending()
    pending = _pending.pop(state, None) if state else None
    if pending is None:
        raise HTTPException(status_code=400, detail="Paràmetres OAuth invàlids o caducats")

    if error:
        log.warning("[Microsoft] OAuth authorization was not completed")
        return _auth_result(pending, False)

    if not code:
        raise HTTPException(status_code=400, detail="Paràmetres OAuth invàlids")

    cfg = _get_config()
    if cfg is None or cfg != pending.config:
        raise HTTPException(
            status_code=400,
            detail="Microsoft OAuth configuration is no longer available",
        )

    # Exchange code for tokens — `requests` is blocking; off-thread so
    # not freeze the event loop for up to 15s.
    token_data = {
        "client_id": cfg["client_id"],
        "code": code,
        "redirect_uri": cfg["redirect_uri"],
        "grant_type": "authorization_code",
        "scope": SCOPES,
        "code_verifier": pending.code_verifier,
    }
    if cfg["client_secret"]:
        token_data["client_secret"] = cfg["client_secret"]
    try:
        resp = await asyncio.to_thread(
            http.post,
            TOKEN_URL,
            data=token_data,
            timeout=15,
        )
        resp.raise_for_status()
        token_payload: Any = resp.json()
        tokens = cast(dict[str, Any], token_payload) if isinstance(token_payload, dict) else {}
    except Exception as exc:
        log.error("[Microsoft] Error exchanging code: %s", exc)
        raise HTTPException(status_code=500, detail="Error obtenint token")

    access_token = tokens.get("access_token")
    refresh_token = tokens.get("refresh_token")
    if not isinstance(access_token, str) or not access_token:
        raise HTTPException(status_code=502, detail="Microsoft no ha retornat un token vàlid")

    # Get user info from Graph API (igualment off-thread).
    try:
        me_resp = await asyncio.to_thread(
            http.get,
            "https://graph.microsoft.com/v1.0/me",
            headers={"Authorization": f"Bearer {access_token}"},
            timeout=10,
        )
        me_resp.raise_for_status()
        profile_payload: Any = me_resp.json()
        me = cast(dict[str, Any], profile_payload) if isinstance(profile_payload, dict) else {}
        email = me.get("mail") or me.get("userPrincipalName", "")
        name = me.get("displayName", email)
        if not isinstance(email, str) or not email:
            raise ValueError("Microsoft profile has no email address")
    except Exception as exc:
        log.error("[Microsoft] Error retrieving profile: %s", exc)
        raise HTTPException(status_code=500, detail="Could not retrieve the profile")

    log.info("[Microsoft] OAuth completed for %s", email)

    account_data: dict[str, Any] = {
        "id": f"microsoft_{email}",
        "email": email,
        "name": name,
        "provider": "microsoft",
        "auth_type": "oauth2",
        "token": access_token,
        "refresh_token": refresh_token,
        "token_uri": TOKEN_URL,
        "client_id": cfg["client_id"],
        "client_secret": cfg["client_secret"],
        "token_status": "connected",
        "refresh_token_status": "connected",
        "type": "mail",
    }

    integration_manager.bulk_update({"mail_accounts": [account_data]})
    return _auth_result(pending, True)
