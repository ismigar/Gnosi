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

# Temporary in-memory storage for the Code Verifier (PKCE)
pending_auths = {}

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
        pending_auths[state] = {
            "code_verifier": flow.code_verifier,
            "type": type or "calendar"
        }
        
    return RedirectResponse(url=authorization_url)

@router.get("/callback")
async def callback(request: Request):
    code = request.query_params.get("code")
    state = request.query_params.get("state")
    
    if not code:
        raise HTTPException(status_code=400, detail="Authorization code not found")
        
    config = get_google_config()
    flow = Flow.from_client_config(
        config,
        scopes=SCOPES,
        redirect_uri=config["web"]["redirect_uris"][0]
    )
    
    # Retrieve the code_verifier if it exists
    auth_type = "calendar"
    if state and state in pending_auths:
        auth_info = pending_auths.pop(state)
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
        
        # Format to be recognized by the frontend in general lists of emails and calendars
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
            "refresh_token_status": "connected"
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
        
        # Arquitectura híbrida: no cal sync al vault, es consulta l'API directament
        
        # Redirect back to the frontend with context
        # Tab management: activeTab in frontend should react to this
        base = get_env("FRONTEND_URL", "http://localhost:5173")
        frontend_url = f"{base}/calendar?auth=success&tab={auth_type}"
        return RedirectResponse(url=frontend_url)

    except Exception as e:
        log.error(f"Error in Google OAuth callback: {e}")
        base = get_env("FRONTEND_URL", "http://localhost:5173")
        return RedirectResponse(url=f"{base}/calendar?auth=error")
