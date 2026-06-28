"""Accés a l'MCP allotjat de Notion (per a la recreació de vistes — Fase 2).

Llegeix el token OAuth de `integrations.json` (clau `notion_mcp`, desat per
`api/notion_oauth_routes`), connecta amb `mcp/http_client.HttpMCPClient` i exposa `fetch(id)`
→ Notion-flavored markdown (amb `<database inline url>`), que `notion_view_recreator` parseja.

Config per env (verificar a la implementació real):
  NOTION_MCP_URL          (def. https://mcp.notion.com/mcp)
  NOTION_MCP_FETCH_TOOL   (def. fetch)
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
    """L'MCP de Notion retorna `content[].text` com un JSON `{metadata,title,url,text}` on
    el markdown real (Notion-flavored, amb `<database inline>`) és al camp intern `text`.
    Cal desembolicar-lo (el connector ho fa sol; nosaltres no ho fèiem)."""
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
    """Treu el markdown real del resultat d'una tool MCP de Notion."""
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
    """Renova l'access token MCP amb el refresh_token (els tokens OAuth són de vida curta).
    Desa el nou token via IntegrationManager. Retorna el nou access token o None."""
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
            log.info("Token MCP de Notion renovat")
            return access
    except Exception as e:  # noqa: BLE001
        log.warning(f"No s'ha pogut renovar el token MCP: {e}")
        try:
            import httpx
            if isinstance(e, httpx.HTTPStatusError) and e.response.status_code in (400, 401):
                log.warning("El token de refresc de Notion MCP és invàlid o ha caducat permanentment. S'eliminen les credencials per forçar una reconexió.")
                from backend.services.integration_manager import integration_manager
                for k in ("notion_mcp", "notion_mcp_client", "notion_mcp_pending"):
                    integration_manager.delete_key(k)
        except Exception as cleanup_err:
            log.error(f"Error netejant credencials caducades de Notion MCP: {cleanup_err}")
    return None


_client_cache: dict = {}  # token → HttpMCPClient (inicialitzat un sol cop, reusat)

# Tallafoc: si el token caduca i NO es pot renovar, marquem l'MCP com a mort perquè les crides
# següents (clon = centenars de pàgines × vistes) tornin "" a l'instant sense un round-trip de
# xarxa + refresc fallit cadascuna (era la causa del "no acaba mai"). Es reseteja en reconnectar
# (healthcheck amb token nou) o explícitament via reset_health().
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
        _client_cache.clear()           # només mantenim el token actiu
        _client_cache[token] = c
    return c


def healthcheck() -> tuple[bool, str]:
    """Una sola comprovació viva de l'MCP (initialize, renovant si cal). Retorna (ok, motiu):
    "ok" | "no_token" | "expired" | <error>. Reseteja el tallafoc si l'MCP respon."""
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
    """Fetch d'una pàgina/vista via l'MCP → markdown. Renova el token si ha caducat (401). '' si falla."""
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
            _mcp_dead = True   # token mort i sense renovació → no segueixis picant per cada pàgina
        return ""
