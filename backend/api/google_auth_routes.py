from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import RedirectResponse
import os
import logging
os.environ.setdefault('OAUTHLIB_RELAX_TOKEN_SCOPE', '1')
from google_auth_oauthlib.flow import Flow
from backend.services.integration_manager import integration_manager
from pathlib import Path

router = APIRouter(prefix="/api/auth/google", tags=["auth"])
log = logging.getLogger(__name__)

import time

# Temporary in-memory storage for the Code Verifier (PKCE).
# Entries carry a created_at timestamp and are pruned on each login so that
# abandoned flows (user closed the tab) don't grow the dict without bound.
pending_auths = {}
_PENDING_AUTH_TTL_SECONDS = 600.0


def _prune_pending_auths() -> None:
    now = time.monotonic()
    for st in [s for s, v in pending_auths.items()
               if now - (v.get("created_at") or 0) > _PENDING_AUTH_TTL_SECONDS]:
        pending_auths.pop(st, None)

# Scopes needed for Calendar and Gmail
SCOPES = [
    'https://www.googleapis.com/auth/calendar',
    'https://mail.google.com/',
    'https://www.googleapis.com/auth/contacts',
    'openid',
    'https://www.googleapis.com/auth/userinfo.email'
]

from backend.config.env_config import get_env

def get_google_config():
    client_id = get_env("GOOGLE_OAUTH_CLIENT_ID")
    client_secret = get_env("GOOGLE_OAUTH_CLIENT_SECRET")
    redirect_uri = get_env("GOOGLE_OAUTH_REDIRECT_URI", "http://localhost:5002/api/auth/google/callback")
    
    log.debug(f"Checking Google Config: ID={client_id[:5] if client_id else 'None'}, Secret={'Present' if client_secret else 'None'}")
    
    if not client_id or not client_secret or client_id == "your_client_id_here":
        log.warning(f"Google OAuth not fully configured: ID found? {bool(client_id)}, Secret found? {bool(client_secret)}")
        return None
        
    return {
        "web": {
            "client_id": client_id,
            "client_secret": client_secret,
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
            "redirect_uris": [redirect_uri]
        }
    }

@router.get("/status")
async def status():
    config = get_google_config()
    return {
        "configured": config is not None,
        "client_id": get_env("GOOGLE_OAUTH_CLIENT_ID") if config else None
    }


@router.get("/health")
async def health():
    """OAuth2 diagnostics for the UI: config status, connected accounts,
    and heuristics about whether the app is in Testing or Production mode.

    Heuristic for "testing":
      - If any account has a recent (<14 days) `last_token_refresh_failure`
        with cause `invalid_grant`, it's likely in Testing.
      - If all accounts with a refresh_token have recent tokens (<7 days),
        the app may be in Production.
      - If there isn't enough data, we return `unknown`.
    
    """
    from backend.services.integration_manager import integration_manager
    config = get_google_config()
    accounts = integration_manager.get_all_mail_accounts()
    google_accs = [a for a in accounts if integration_manager.is_google_account(a)]

    has_refresh = sum(1 for a in google_accs if a.get("refresh_token"))
    recently_failed = sum(
        1 for a in google_accs
        if a.get("last_refresh_error") and "invalid_grant" in str(a.get("last_refresh_error", ""))
    )

    if recently_failed:
        app_status = "testing-likely"
        hint = (
            "At least one account recently received invalid_grant, which commonly "
            "indicates Testing mode and a refresh token that expired after seven "
            "days. Consider publishing the app; see "
            "docs/dev_memory/directives/publish_google_app.md."
        )
    elif has_refresh and not recently_failed:
        app_status = "healthy"
        hint = "All Google accounts have a valid refresh_token."
    else:
        app_status = "unknown"
        hint = "No Google account is connected, or there is not enough data to infer status."

    return {
        "configured": config is not None,
        "client_id_present": bool(get_env("GOOGLE_OAUTH_CLIENT_ID")),
        "scopes": SCOPES,
        "google_accounts_total": len(google_accs),
        "google_accounts_with_refresh_token": has_refresh,
        "google_accounts_recently_failed": recently_failed,
        "app_status": app_status,
        "hint": hint,
        "publish_guide": "/docs/dev_memory/directives/publish_google_app.md",
    }

@router.get("/login")
async def login(type: str = None):
    config = get_google_config()
    if not config:
        raise HTTPException(status_code=400, detail="Google OAuth credentials not configured in .env_shared")
        
    flow = Flow.from_client_config(
        config,
        scopes=SCOPES,
        redirect_uri=config["web"]["redirect_uris"][0]
    )
    
    authorization_url, state = flow.authorization_url(
        access_type='offline',
        include_granted_scopes='true',
        prompt='consent'
    )
    
    # Save the generated code_verifier and context associated with the state
    if hasattr(flow, "code_verifier"):
        _prune_pending_auths()
        pending_auths[state] = {
            "code_verifier": flow.code_verifier,
            "type": type or "calendar",
            "created_at": time.monotonic(),
        }
        
    return RedirectResponse(url=authorization_url)

@router.get("/callback")
async def callback(request: Request):
    code = request.query_params.get("code")
    state = request.query_params.get("state")

    if not code:
        raise HTTPException(status_code=400, detail="Authorization code not found")

    # Validate `state` against the pending ones — CSRF prevention. Without this
    # validation, an attacker could craft a callback URL with their own code
    # and get the victim to link their account to the attacker's. PKCE
    # mitigates part of the risk, but only if we have the code_verifier — and
    # that only exists if `state` matches.
    if not state or state not in pending_auths:
        log.warning(f"OAuth callback amb state invàlid o expirat: {state!r}")
        raise HTTPException(
            status_code=400,
            detail="Invalid or expired OAuth state. Please retry the login.",
        )

    config = get_google_config()
    flow = Flow.from_client_config(
        config,
        scopes=SCOPES,
        redirect_uri=config["web"]["redirect_uris"][0]
    )

    # Retrieve the code_verifier (state already validated above)
    auth_info = pending_auths.pop(state)
    auth_type = "calendar"
    if isinstance(auth_info, dict):
        flow.code_verifier = auth_info.get("code_verifier")
        auth_type = auth_info.get("type", "calendar")
    else:
        flow.code_verifier = auth_info

    try:
        flow.fetch_token(code=code)
        credentials = flow.credentials
        
        # Get user info to identify the account
        from googleapiclient.discovery import build
        service = build('oauth2', 'v2', credentials=credentials)
        user_info = service.userinfo().get().execute()
        email = user_info.get("email")
        log.info(f"Google OAuth successful for email: {email}")
        
        # Format to be recognized by the frontend in general lists of emails and calendars.
        # IMAP/SMTP fields injected because mail goes via IMAP+XOAUTH2 (not the Gmail API).
        import time as _time
        account_data = {
            "id": f"google_{email}",
            "email": email,
            "name": user_info.get('name', email),
            "picture": user_info.get('picture'),
            "provider": "google",
            "auth_type": "oauth2",
            "token": credentials.token,
            "refresh_token": credentials.refresh_token,
            "client_id": credentials.client_id,
            "client_secret": credentials.client_secret,
            "token_uri": credentials.token_uri,
            "token_status": "connected",
            "refresh_token_status": "connected",
            # Marks the callback's timestamp as the last successful refresh so that
            # `ensure_fresh_token` knows when to refresh again.
            "last_refresh_success_at": int(_time.time()),
            "imap_host": "imap.gmail.com",
            "imap_port": 993,
            "imap_encryption": "ssl",
            "imap_user": email,
            "smtp_host": "smtp.gmail.com",
            "smtp_port": 465,
            "smtp_encryption": "ssl",
            "smtp_user": email,
            "mail_transport": "imap-xoauth2",
        }
        
        # We save it as a calendar and email integration if applicable
        # We use bulk_update to ensure everything is saved at once and use consistent keys
        log.info(f"Saving integration data for {email}...")
        integration_manager.bulk_update({
            "mail_accounts": [account_data],
            "calendars": [account_data],
            "contacts": [account_data]
        })
        log.info(f"Integration data saved for {email}. Redirecting to frontend.")
        
        # Hybrid architecture: no need to sync to the vault, the API is queried directly
        
        # Redirect back to the frontend with context
        # Tab management: activeTab in frontend should react to this
        base = get_env("FRONTEND_URL", "http://localhost:5173")
        frontend_url = f"{base}/calendar?auth=success&tab={auth_type}"
        return RedirectResponse(url=frontend_url)

    except Exception as e:
        log.error(f"Error in Google OAuth callback: {e}")
        base = get_env("FRONTEND_URL", "http://localhost:5173")
        return RedirectResponse(url=f"{base}/calendar?auth=error")
