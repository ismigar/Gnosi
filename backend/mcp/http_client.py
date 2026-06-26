"""Client MCP sobre HTTP (streamable) amb Bearer OAuth.

Complement de `DockerMCPClient` (stdio): per a MCP allotjats com el de Notion
(`mcp.notion.com`), que parlen JSON-RPC sobre HTTP i autentiquen amb `Authorization: Bearer`.
Gestiona resposta `application/json` i `text/event-stream` (streamable HTTP).

⚠️ Endpoint/scope/nom-de-tool exactes de l'MCP de Notion → verificar a la implementació real
(config per env). cf. directiva `notion_mcp_oauth_views.md`.
"""
from __future__ import annotations

import json
import logging
from typing import Any, Dict, Optional

log = logging.getLogger(__name__)


def _parse_sse(text: str) -> Dict[str, Any]:
    """Extreu el primer payload JSON-RPC d'un cos SSE (línies `data: {...}`)."""
    for line in text.splitlines():
        line = line.strip()
        if line.startswith("data:"):
            chunk = line[5:].strip()
            if chunk and chunk != "[DONE]":
                try:
                    return json.loads(chunk)
                except Exception:
                    continue
    return {}


class HttpMCPClient:
    """Client JSON-RPC MCP mínim sobre HTTP. Síncron (pensat per a `asyncio.to_thread`)."""

    def __init__(self, base_url: str, token: str, *, timeout: float = 60.0):
        self.base_url = base_url
        self.token = token
        self.timeout = timeout
        self._id = 0
        self._session_id: Optional[str] = None

    def _headers(self) -> Dict[str, str]:
        h = {
            "Authorization": f"Bearer {self.token}",
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
            # mcp.notion.com és darrere Cloudflare i BLOQUEJA (error 1010) el User-Agent
            # per defecte de Python (urllib/httpx). Cal un UA de navegador per passar.
            "User-Agent": ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                           "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"),
        }
        if self._session_id:
            h["Mcp-Session-Id"] = self._session_id
        return h

    def _rpc(self, method: str, params: Optional[Dict[str, Any]] = None) -> Any:
        import httpx
        self._id += 1
        payload = {"jsonrpc": "2.0", "id": self._id, "method": method, "params": params or {}}
        with httpx.Client(timeout=self.timeout) as c:
            resp = c.post(self.base_url, json=payload, headers=self._headers())
            # Captura l'id de sessió (streamable HTTP el retorna a la 1a resposta)
            sid = resp.headers.get("Mcp-Session-Id")
            if sid:
                self._session_id = sid
            resp.raise_for_status()
            ctype = resp.headers.get("content-type", "")
            data = _parse_sse(resp.text) if "text/event-stream" in ctype else resp.json()
        if not data:
            return None
        if data.get("error"):
            raise RuntimeError(f"MCP error: {data['error']}")
        return data.get("result")

    def initialize(self) -> Any:
        result = self._rpc("initialize", {
            "protocolVersion": "2024-11-05",
            "capabilities": {},
            "clientInfo": {"name": "gnosi-host", "version": "1.0"},
        })
        # notificació "initialized" (best-effort)
        try:
            self._rpc("notifications/initialized", {})
        except Exception:
            pass
        return result

    def call_tool(self, name: str, arguments: Dict[str, Any]) -> Any:
        return self._rpc("tools/call", {"name": name, "arguments": arguments})
