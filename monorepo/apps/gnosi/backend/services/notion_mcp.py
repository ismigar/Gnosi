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
_DEFAULT_FETCH_TOOL = "fetch"


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


def _extract_text(result) -> str:
    """Treu el text del resultat d'una tool MCP ({content:[{type:text,text:...}]})."""
    if result is None:
        return ""
    if isinstance(result, str):
        return result
    content = result.get("content") if isinstance(result, dict) else None
    if isinstance(content, list):
        parts = [c.get("text", "") for c in content if isinstance(c, dict) and c.get("type") == "text"]
        if parts:
            return "\n".join(parts)
    # alguns servidors retornen {text: ...} o el markdown directament a 'structuredContent'
    if isinstance(result, dict):
        return result.get("text") or json.dumps(result)
    return str(result)


def fetch(notion_id: str) -> str:
    """Fa `fetch` d'una pàgina/vista de Notion via l'MCP allotjat → markdown. '' si no hi ha token."""
    token = get_mcp_token()
    if not token:
        return ""
    from backend.mcp.http_client import HttpMCPClient
    client = HttpMCPClient(_env("NOTION_MCP_URL", _DEFAULT_URL), token)
    client.initialize()
    result = client.call_tool(_env("NOTION_MCP_FETCH_TOOL", _DEFAULT_FETCH_TOOL), {"id": notion_id})
    return _extract_text(result)
