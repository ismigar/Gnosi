from fastapi import APIRouter, HTTPException, Request, BackgroundTasks
from fastapi.responses import RedirectResponse
import os
import logging
from google_auth_oauthlib.flow import Flow
from backend.services.integration_manager import integration_manager
from backend.services.vault_calendar_sync_service import calendar_sync_service
from pathlib import Path

router = APIRouter(prefix="/api/auth/google", tags=["auth"])
log = logging.getLogger(__name__)

# Temporary in-memory storage for the Code Verifier (PKCE)
pending_auths = {}

# Scopes needed for Calendar and Gmail
SCOPES = [
    'https://www.googleapis.com/auth/calendar',
    'https://www.googleapis.com/auth/gmail.modify',
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
async def callback(request: Request, background_tasks: BackgroundTasks):
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
        
        # Format to be recognized by the frontend in general lists of emails and calendars
        account_data = {
            "id": f"google_{email}",
            "email": email,
            "provider": "google",
            "auth_type": "oauth2",
            "token": credentials.token,
            "refresh_token": credentials.refresh_token,
            "client_id": credentials.client_id,
            "client_secret": credentials.client_secret,
            "token_uri": credentials.token_uri
        }
        
        # We save it as a calendar and email integration if applicable
        # The integration_manager.update handles merging/adding by ID
        integration_manager.update("emails", [account_data])
        integration_manager.update("calendars", [account_data])
        integration_manager.update("contacts", [account_data])
        
        # Trigger immediate sync in background
        background_tasks.add_task(calendar_sync_service.sync_all_calendars)
        
        # Redirect back to the frontend with context
        # Tab management: activeTab in frontend should react to this
        frontend_url = f"http://localhost:5173/calendar?auth=success&tab={auth_type}"
        return RedirectResponse(url=frontend_url)
        
    except Exception as e:
        log.error(f"Error in Google OAuth callback: {e}")
        return RedirectResponse(url="http://localhost:5173/calendar?auth=error")
