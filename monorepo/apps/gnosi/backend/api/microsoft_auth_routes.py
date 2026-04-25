"""Microsoft OAuth2 authentication routes.

Implements the authorization-code flow for Microsoft 365 / Entra ID.
Tokens are stored in integrations.json under 'mail_accounts' with
provider='microsoft' so the rest of the mail stack picks them up
automatically.
"""
import secrets
import logging
import requests as http
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import RedirectResponse
from backend.config.env_config import get_env
from backend.services.integration_manager import integration_manager

router = APIRouter(prefix="/api/auth/microsoft", tags=["auth"])
log = logging.getLogger(__name__)

# In-memory store for pending OAuth states (state → {})
_pending: dict = {}

SCOPES = " ".join([
    "https://graph.microsoft.com/Mail.Read",
    "https://graph.microsoft.com/Mail.ReadWrite",
    "https://graph.microsoft.com/Mail.Send",
    "offline_access",
    "User.Read",
])

AUTH_URL  = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize"
TOKEN_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/token"


def _get_config() -> dict | None:
    client_id     = get_env("MICROSOFT_OAUTH_CLIENT_ID")
    client_secret = get_env("MICROSOFT_OAUTH_CLIENT_SECRET")
    redirect_uri  = get_env(
        "MICROSOFT_OAUTH_REDIRECT_URI",
        "http://localhost:5002/api/auth/microsoft/callback",
    )
    if not client_id or not client_secret:
        return None
    return {"client_id": client_id, "client_secret": client_secret, "redirect_uri": redirect_uri}


@router.get("/status")
async def status():
    cfg = _get_config()
    return {"configured": cfg is not None, "client_id": cfg["client_id"] if cfg else None}


@router.get("/login")
async def login():
    cfg = _get_config()
    if not cfg:
        raise HTTPException(
            status_code=400,
            detail="Microsoft OAuth no configurat. Afegeix MICROSOFT_OAUTH_CLIENT_ID i MICROSOFT_OAUTH_CLIENT_SECRET a .env_shared",
        )
    state = secrets.token_urlsafe(32)
    _pending[state] = True

    params = {
        "client_id":     cfg["client_id"],
        "response_type": "code",
        "redirect_uri":  cfg["redirect_uri"],
        "response_mode": "query",
        "scope":         SCOPES,
        "state":         state,
        "prompt":        "select_account",
    }
    url = AUTH_URL + "?" + "&".join(f"{k}={v}" for k, v in params.items())
    return RedirectResponse(url=url)


@router.get("/callback")
async def callback(request: Request):
    code  = request.query_params.get("code")
    state = request.query_params.get("state")
    error = request.query_params.get("error")

    if error:
        desc = request.query_params.get("error_description", error)
        log.error(f"[Microsoft] OAuth error: {desc}")
        return RedirectResponse(url=f"/?error={desc}")

    if not code or state not in _pending:
        raise HTTPException(status_code=400, detail="Paràmetres OAuth invàlids")

    _pending.pop(state, None)
    cfg = _get_config()

    # Exchange code for tokens
    try:
        resp = http.post(TOKEN_URL, data={
            "client_id":     cfg["client_id"],
            "client_secret": cfg["client_secret"],
            "code":          code,
            "redirect_uri":  cfg["redirect_uri"],
            "grant_type":    "authorization_code",
            "scope":         SCOPES,
        }, timeout=15)
        resp.raise_for_status()
        tokens = resp.json()
    except Exception as e:
        log.error(f"[Microsoft] Error intercanviant codi: {e}")
        raise HTTPException(status_code=500, detail=f"Error obtenint token: {e}")

    access_token  = tokens.get("access_token")
    refresh_token = tokens.get("refresh_token")

    # Get user info from Graph API
    try:
        me = http.get(
            "https://graph.microsoft.com/v1.0/me",
            headers={"Authorization": f"Bearer {access_token}"},
            timeout=10,
        ).json()
        email = me.get("mail") or me.get("userPrincipalName", "")
        name  = me.get("displayName", email)
    except Exception as e:
        log.error(f"[Microsoft] Error obtenint perfil: {e}")
        raise HTTPException(status_code=500, detail="No s'ha pogut obtenir el perfil")

    log.info(f"[Microsoft] OAuth completat per {email}")

    account_data = {
        "id":                    f"microsoft_{email}",
        "email":                 email,
        "name":                  name,
        "provider":              "microsoft",
        "auth_type":             "oauth2",
        "token":                 access_token,
        "refresh_token":         refresh_token,
        "token_uri":             TOKEN_URL,
        "client_id":             cfg["client_id"],
        "client_secret":         cfg["client_secret"],
        "token_status":          "connected",
        "refresh_token_status":  "connected",
        "type":                  "mail",
    }

    integration_manager.bulk_update({"mail_accounts": [account_data]})
    return RedirectResponse(url="/?auth=microsoft_success")
