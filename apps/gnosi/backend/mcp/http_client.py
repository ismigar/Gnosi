"""MCP client over HTTP (streamable) with Bearer OAuth.

Complement to `DockerMCPClient` (stdio): for hosted MCPs like Notion's
(`mcp.notion.com`), which speak JSON-RPC over HTTP and authenticate with `Authorization: Bearer`.
Handles `application/json` and `text/event-stream` responses (streamable HTTP).

⚠️ Exact endpoint/scope/tool-name for Notion's MCP → verify in the actual implementation
(config per env). cf. directive `notion_mcp_oauth_views.md`.
"""
from __future__ import annotations

import json
import logging
from typing import Any, Dict, Optional

log = logging.getLogger(__name__)


def _retry_after_seconds(value: Optional[str], attempt: int) -> float:
    """Seconds to wait when facing a 429, tolerant of the `Retry-After`
    format (seconds OR HTTP date). Default backoff up to 10s. Delegates to the
    shared helper `backend.utils.http_retry` (same logic as the Notion clone)."""
    from backend.utils.http_retry import retry_after_seconds
    return retry_after_seconds(value, default=1.5 * (attempt + 1), cap=10.0)


def _parse_sse(text: str) -> Dict[str, Any]:
    """Extracts the first JSON-RPC payload from an SSE body (`data: {...}` lines)."""
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
    """Minimal JSON-RPC MCP client over HTTP. Synchronous (intended for `asyncio.to_thread`)."""

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
            # mcp.notion.com is behind Cloudflare and BLOCKS (error 1010) the User-Agent
            # default in Python (urllib/httpx). A browser UA is needed to get through.
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
            if resp.status_code == 401:  # expired token → the caller (notion_mcp) renews it
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
        # "initialized" notification (best-effort)
        try:
            self._rpc("notifications/initialized", {})
        except Exception:
            pass
        return result

    def call_tool(self, name: str, arguments: Dict[str, Any]) -> Any:
        return self._rpc("tools/call", {"name": name, "arguments": arguments})
