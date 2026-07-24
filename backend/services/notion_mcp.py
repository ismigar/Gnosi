"""Access to Notion's hosted MCP (for view recreation — Phase 2).

Reads the OAuth token from `integrations.json` (key `notion_mcp`, saved by
`api/notion_oauth_routes`), connects via `mcp/http_client.HttpMCPClient` and exposes `fetch(id)`
→ Notion-flavored markdown (with `<database inline url>`), which `notion_view_recreator` parses.

Config via env (verify against the actual implementation):
  NOTION_MCP_URL          (default https://mcp.notion.com/mcp)
  NOTION_MCP_FETCH_TOOL   (default fetch)
"""
from __future__ import annotations

import json
import logging
from typing import Optional

log = logging.getLogger(__name__)

_DEFAULT_URL = "https://mcp.notion.com/mcp"
_DEFAULT_FETCH_TOOL = "notion-fetch"


def _env(name: str, default: str) -> str:
    try:
        from backend.config.env_config import get_env
        return get_env(name, default) or default
    except Exception:
        return default


def get_mcp_token() -> Optional[str]:
    try:
        from backend.services.integration_manager import integration_manager
        return (integration_manager.get_raw("notion_mcp") or {}).get("token")
    except Exception:
        pass
    return None


def is_connected() -> bool:
    return bool(get_mcp_token())


def _unwrap_notion_json(raw: str) -> str:
    """Notion's MCP returns `content[].text` as a JSON `{metadata,title,url,text}` where
    the real markdown (Notion-flavored, with `<database inline>`) is in the inner `text` field.
    It must be unwrapped (the connector does it automatically; we weren't doing it)."""
    s = (raw or "").strip()
    if s.startswith("{"):
        try:
            obj = json.loads(s)
            if isinstance(obj, dict) and isinstance(obj.get("text"), str):
                return obj["text"]
        except Exception:
            pass
    return raw


def _extract_text(result) -> str:
    """Extracts the real markdown from the result of a Notion MCP tool."""
    if result is None:
        return ""
    if isinstance(result, str):
        return _unwrap_notion_json(result)
    content = result.get("content") if isinstance(result, dict) else None
    if isinstance(content, list):
        parts = [c.get("text", "") for c in content if isinstance(c, dict) and c.get("type") == "text"]
        if parts:
            return _unwrap_notion_json("\n".join(parts))
    if isinstance(result, dict):
        return result.get("text") or json.dumps(result)
    return str(result)


_UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
       "(KHTML, like Gecko) Chrome/120.0 Safari/537.36")


def _is_auth_error(e) -> bool:
    s = str(e).lower()
    return "401" in s or "invalid_token" in s or "invalid access token" in s or "unauthorized" in s


def refresh_token() -> Optional[str]:
    """Renews the MCP access token using the refresh_token (OAuth tokens are short-lived).
    Saves the new token via IntegrationManager. Returns the new access token or None."""
    try:
        from backend.services.integration_manager import integration_manager
        mcp = integration_manager.get_raw("notion_mcp") or {}
        client = integration_manager.get_raw("notion_mcp_client") or {}
        rt, cid = mcp.get("refresh_token"), client.get("client_id")
        if not rt or not cid:
            return None
        import httpx
        token_url = _env("NOTION_OAUTH_TOKEN_URL", "https://mcp.notion.com/token")
        r = httpx.post(token_url, data={"grant_type": "refresh_token", "refresh_token": rt,
                                        "client_id": cid},
                       headers={"Content-Type": "application/x-www-form-urlencoded", "User-Agent": _UA},
                       timeout=30)
        r.raise_for_status()
        tok = r.json()
        access = tok.get("access_token")
        if access:
            integration_manager.replace_key("notion_mcp", {
                "token": access, "refresh_token": tok.get("refresh_token") or rt,
                "token_type": tok.get("token_type")})
            log.info("Notion MCP token refreshed")
            return access
    except Exception as e:  # noqa: BLE001
        log.warning(f"Could not refresh the MCP token: {e}")
        try:
            import httpx
            if isinstance(e, httpx.HTTPStatusError) and e.response.status_code in (400, 401):
                log.warning(
                    "The Notion MCP refresh token is invalid or permanently expired. "
                    "Removing credentials to force reconnection."
                )
                from backend.services.integration_manager import integration_manager
                for k in ("notion_mcp", "notion_mcp_client", "notion_mcp_pending"):
                    integration_manager.delete_key(k)
        except Exception as cleanup_err:
            log.error(f"Could not clean up expired Notion MCP credentials: {cleanup_err}")
    return None


_client_cache: dict = {}  # token → HttpMCPClient (initialized once, reused)

# Circuit breaker: if the token expires and CANNOT be renewed, we mark the MCP as dead so that
# subsequent calls (clone = hundreds of pages × views) instantly return "" without a round-trip
# over the network + a failed refresh each time (this was the cause of the "never finishes"). It resets on reconnect
# (healthcheck with a new token) or explicitly via reset_health().
_mcp_dead: bool = False


def reset_health() -> None:
    global _mcp_dead
    _mcp_dead = False


def _get_client(token: str):
    c = _client_cache.get(token)
    if c is None:
        from backend.mcp.http_client import HttpMCPClient
        c = HttpMCPClient(_env("NOTION_MCP_URL", _DEFAULT_URL), token)
        c.initialize()
        _client_cache.clear()           # we only keep the active token
        _client_cache[token] = c
    return c


def healthcheck() -> tuple[bool, str]:
    """A single live check of the MCP (initialize, renewing if needed). Returns (ok, reason):
    "ok" | "no_token" | "expired" | <error>. Resets the circuit breaker if the MCP responds."""
    global _mcp_dead
    token = get_mcp_token()
    if not token:
        return False, "no_token"
    try:
        _get_client(token)
        _mcp_dead = False
        return True, "ok"
    except Exception as e:  # noqa: BLE001
        if _is_auth_error(e):
            new = refresh_token()
            if new:
                try:
                    _get_client(new)
                    _mcp_dead = False
                    return True, "ok"
                except Exception:  # noqa: BLE001
                    pass
            _mcp_dead = True
            return False, "expired"
        return False, str(e)


def _do_fetch(token: str, notion_id: str) -> str:
    client = _get_client(token)
    result = client.call_tool(_env("NOTION_MCP_FETCH_TOOL", _DEFAULT_FETCH_TOOL), {"id": notion_id})
    return _extract_text(result)


def fetch(notion_id: str) -> str:
    """Fetch of a page/view via the MCP → markdown. Renews the token if it has expired (401). '' on failure."""
    global _mcp_dead
    if _mcp_dead:
        return ""
    token = get_mcp_token()
    if not token:
        return ""
    try:
        return _do_fetch(token, notion_id)
    except Exception as e:  # noqa: BLE001
        if _is_auth_error(e):
            new = refresh_token()
            if new:
                try:
                    return _do_fetch(new, notion_id)
                except Exception:  # noqa: BLE001
                    return ""
            _mcp_dead = True   # dead token with no renewal → don't keep hitting it for every page
        return ""
