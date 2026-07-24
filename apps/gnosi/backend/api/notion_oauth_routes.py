"""OAuth 2.1 to Notion's hosted MCP (mcp.notion.com) — for recreating views.

Notion's MCP does NOT use standard integration OAuth: it has its own OAuth 2.1 server
with **dynamic client registration (DCR)** + **PKCE** (public client, no secret). Flow:
  /login    → discovery + DCR (client_id) + PKCE → redirects to authorize
  /callback → exchanges the code (with code_verifier) at /token → saves the token to integrations.json
The resulting token is the Bearer for `services/notion_mcp` (mcp.notion.com/mcp).

No manual OAuth app or client secret needed (registration is dynamic).
"""
import base64
import hashlib
import json
import logging
import secrets
from urllib.parse import urlencode, urlparse

from fastapi import APIRouter, Request, Depends
from fastapi.responses import RedirectResponse

from backend.config.env_config import get_env
from backend.services.workspace_service import require_role
from backend.services.integration_manager import integration_manager

log = logging.getLogger(__name__)
router = APIRouter(prefix="/notion-oauth", tags=["Notion MCP OAuth"])

_BASE = lambda: get_env("NOTION_MCP_BASE", "https://mcp.notion.com").rstrip("/")
_REDIRECT = lambda: get_env("NOTION_OAUTH_REDIRECT_URI", "http://localhost:5002/api/notion-oauth/callback")
_FRONTEND = lambda: get_env("FRONTEND_BASE_URL", "http://localhost:5173")

# FIRST-CLASS secrets via IntegrationManager (shared lock + cache): keys
# `notion_mcp` (token), `notion_mcp_client` (client_id DCR), `notion_mcp_pending` (PKCE).


def _frontend_base(request: Request) -> str:
    """REAL frontend origin (scheme + host) derived from the /login request.

    The dev server serves HTTPS on 5173 (mkcert), but FRONTEND_BASE_URL defaults to
    http:// → redirecting there after OAuth gives "Empty reply". We take the origin from the
    navigation's Referer/Origin header (same origin, proxied) to go back to the SAME
    scheme/host it was clicked from. Falls back to FRONTEND_BASE_URL if there is none.
    
    """
    ref = request.headers.get("origin") or request.headers.get("referer")
    if ref:
        try:
            u = urlparse(ref)
            if u.scheme and u.netloc:
                return f"{u.scheme}://{u.netloc}"
        except Exception:  # noqa: BLE001
            pass
    return _FRONTEND()


def _discover() -> dict:
    """MCP OAuth server endpoints (well-known), with fallback to the known ones."""
    base = _BASE()
    defaults = {"authorization_endpoint": f"{base}/authorize",
                "token_endpoint": f"{base}/token",
                "registration_endpoint": f"{base}/register"}
    try:
        import httpx
        with httpx.Client(timeout=15) as c:
            r = c.get(f"{base}/.well-known/oauth-authorization-server")
            r.raise_for_status()
            meta = r.json()
        return {k: meta.get(k) or defaults[k] for k in defaults}
    except Exception:
        return defaults


def _register_client(registration_endpoint: str) -> str:
    """Dynamic registration (caches the client_id in integrations.json to reuse it)."""
    cached = (integration_manager.get_raw("notion_mcp_client") or {}).get("client_id")
    if cached:
        return cached
    import httpx
    with httpx.Client(timeout=20) as c:
        r = c.post(registration_endpoint, json={
            "client_name": "Gnosi",
            "redirect_uris": [_REDIRECT()],
            "grant_types": ["authorization_code", "refresh_token"],
            "response_types": ["code"],
            "token_endpoint_auth_method": "none",
        })
        r.raise_for_status()
        client_id = r.json().get("client_id")
    integration_manager.replace_key("notion_mcp_client", {"client_id": client_id})
    return client_id


def _pkce():
    verifier = base64.urlsafe_b64encode(secrets.token_bytes(48)).rstrip(b"=").decode()
    challenge = base64.urlsafe_b64encode(
        hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    return verifier, challenge


@router.get("/status")
async def status():
    return {"connected": bool((integration_manager.get_raw("notion_mcp") or {}).get("token"))}


@router.get("/login")
async def login(request: Request):
    front = _frontend_base(request)
    try:
        endpoints = _discover()
        client_id = _register_client(endpoints["registration_endpoint"])
        verifier, challenge = _pkce()
        state = secrets.token_urlsafe(24)
        # saves the pending state (state → verifier + frontend origin) for the callback;
        # `update` does an atomic merge under lock → adds this state without stepping on others.
        integration_manager.update("notion_mcp_pending",
                                   {state: {"verifier": verifier, "client_id": client_id, "frontend": front}})
        params = {
            "response_type": "code",
            "client_id": client_id,
            "redirect_uri": _REDIRECT(),
            "state": state,
            "code_challenge": challenge,
            "code_challenge_method": "S256",
        }
        return RedirectResponse(url=f"{endpoints['authorization_endpoint']}?{urlencode(params)}")
    except Exception as e:  # noqa: BLE001
        log.error(f"Notion MCP OAuth login failed: {e}")
        return RedirectResponse(url=f"{front}/?notion_mcp=error")


@router.get("/callback")
async def callback(request: Request):
    code = request.query_params.get("code")
    state = request.query_params.get("state")
    pend = (integration_manager.get_raw("notion_mcp_pending") or {}).get(state) if state else None
    # returns to the SAME frontend origin it was initiated from (saved at /login); fallback to env.
    front = (pend or {}).get("frontend") or _FRONTEND()
    if not code or not pend:
        return RedirectResponse(url=f"{front}/?notion_mcp=error")
    try:
        endpoints = _discover()
        import httpx
        with httpx.Client(timeout=30) as c:
            r = c.post(endpoints["token_endpoint"], data={
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": _REDIRECT(),
                "client_id": pend["client_id"],
                "code_verifier": pend["verifier"],
            }, headers={"Content-Type": "application/x-www-form-urlencoded"})
            r.raise_for_status()
            tok = r.json()
    except Exception as e:  # noqa: BLE001
        log.error(f"Notion MCP OAuth token exchange failed: {e}")
        return RedirectResponse(url=f"{front}/?notion_mcp=error")

    access = tok.get("access_token")
    if not access:
        return RedirectResponse(url=f"{front}/?notion_mcp=error")
    integration_manager.replace_key("notion_mcp", {
        "token": access, "refresh_token": tok.get("refresh_token"),
        "token_type": tok.get("token_type")})
    integration_manager.replace_key("notion_mcp_pending", {})  # cleans up the pending ones
    try:
        from backend.services import notion_mcp
        notion_mcp.reset_health()   # new token → reopens the firewall
    except Exception:
        pass
    return RedirectResponse(url=f"{front}/?notion_mcp=ok")


@router.delete("/token", dependencies=[Depends(require_role("admin"))])
async def disconnect():
    for k in ("notion_mcp", "notion_mcp_client", "notion_mcp_pending"):
        integration_manager.replace_key(k, {})
    return {"status": "success"}
