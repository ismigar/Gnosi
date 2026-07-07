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


def _retry_after_seconds(value: Optional[str], attempt: int) -> float:
    """Segons a esperar davant un 429, tolerant amb el format de `Retry-After`
    (segons O data HTTP). Backoff per defecte i cap a 10s. Delega al helper
    compartit `backend.utils.http_retry` (mateixa lògica que el clon de Notion)."""
    from backend.utils.http_retry import retry_after_seconds
    return retry_after_seconds(value, default=1.5 * (attempt + 1), cap=10.0)


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
        import time
        import httpx
        self._id += 1
        payload = {"jsonrpc": "2.0", "id": self._id, "method": method, "params": params or {}}
        last = None
        for attempt in range(4):
            with httpx.Client(timeout=self.timeout) as c:
                resp = c.post(self.base_url, json=payload, headers=self._headers())
            sid = resp.headers.get("Mcp-Session-Id")
            if sid:
                self._session_id = sid
            if resp.status_code == 429:  # rate limit → espera i reintenta
                time.sleep(_retry_after_seconds(resp.headers.get("Retry-After"), attempt))
                last = resp
                continue
            if resp.status_code == 401:  # token caducat → el caller (notion_mcp) el renova
                raise RuntimeError("MCP 401 invalid_token")
            resp.raise_for_status()
            ctype = resp.headers.get("content-type", "")
            data = _parse_sse(resp.text) if "text/event-stream" in ctype else resp.json()
            if not data:
                return None
            if data.get("error"):
                raise RuntimeError(f"MCP error: {data['error']}")
            return data.get("result")
        if last is not None:
            last.raise_for_status()
        return None

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
