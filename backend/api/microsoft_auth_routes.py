"""Microsoft OAuth2 authentication routes.

Implements the authorization-code flow for Microsoft 365 / Entra ID.
Tokens are stored in integrations.json under 'mail_accounts' with
provider='microsoft' so the rest of the mail stack picks them up
automatically.
"""

import asyncio
import logging
import secrets
import time
from typing import Any, TypedDict, cast
from urllib.parse import urlencode

import requests as http
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import RedirectResponse
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


# In-memory store for pending OAuth states (state → monotonic creation time).
_pending: dict[str, float] = {}
_PENDING_TTL_SECONDS = 600.0


def _prune_pending() -> None:
    now = time.monotonic()
    for state, created_at in list(_pending.items()):
        if now - created_at > _PENDING_TTL_SECONDS:
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
    client_secret = get_env("MICROSOFT_OAUTH_CLIENT_SECRET")
    redirect_uri = get_env(
        "MICROSOFT_OAUTH_REDIRECT_URI",
        "http://localhost:5002/api/auth/microsoft/callback",
    )
    if not client_id or not client_secret:
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
@router.get("/login")
async def login() -> RedirectResponse:
    cfg = _get_config()
    if not cfg:
        raise HTTPException(
            status_code=400,
            detail=(
                "Microsoft OAuth no configurat. Desa les credencials als ajustos segurs "
                "o configura-les a l'entorn del procés."
            ),
        )
    state = secrets.token_urlsafe(32)
    _prune_pending()
    _pending[state] = time.monotonic()

    params = {
        "client_id": cfg["client_id"],
        "response_type": "code",
        "redirect_uri": cfg["redirect_uri"],
        "response_mode": "query",
        "scope": SCOPES,
        "state": state,
        "prompt": "select_account",
    }
    # urlencode ensures correct encoding of spaces in SCOPES, `://` in
    # redirect_uri, etc. Manual concatenation used to produce invalid URLs
    # depending on the values.
    url = AUTH_URL + "?" + urlencode(params)
    return RedirectResponse(url=url)


# OAuth completion and provider errors return concrete redirects to the UI.
@router.get("/callback")
async def callback(request: Request) -> RedirectResponse:
    code = request.query_params.get("code")
    state = request.query_params.get("state")
    error = request.query_params.get("error")

    if error:
        desc = request.query_params.get("error_description", error)
        log.error("[Microsoft] OAuth error: %s", desc)
        return RedirectResponse(url=f"/?error={desc}")

    if not code or state not in _pending:
        raise HTTPException(status_code=400, detail="Paràmetres OAuth invàlids")

    _pending.pop(state, None)
    cfg = _get_config()
    if cfg is None:
        raise HTTPException(
            status_code=400,
            detail="Microsoft OAuth configuration is no longer available",
        )

    # Exchange code for tokens — `requests` is blocking; off-thread so
    # not freeze the event loop for up to 15s.
    try:
        resp = await asyncio.to_thread(
            http.post,
            TOKEN_URL,
            data={
                "client_id": cfg["client_id"],
                "client_secret": cfg["client_secret"],
                "code": code,
                "redirect_uri": cfg["redirect_uri"],
                "grant_type": "authorization_code",
                "scope": SCOPES,
            },
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

    # Get user info from Graph API (igualment off-thread).
    try:
        me_resp = await asyncio.to_thread(
            http.get,
            "https://graph.microsoft.com/v1.0/me",
            headers={"Authorization": f"Bearer {access_token}"},
            timeout=10,
        )
        profile_payload: Any = me_resp.json()
        me = cast(dict[str, Any], profile_payload) if isinstance(profile_payload, dict) else {}
        email = me.get("mail") or me.get("userPrincipalName", "")
        name = me.get("displayName", email)
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
    return RedirectResponse(url="/?auth=microsoft_success")
