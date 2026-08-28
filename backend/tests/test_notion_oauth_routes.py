"""Security and compatibility contracts for hosted Notion MCP OAuth."""

from __future__ import annotations

import asyncio
import threading

from starlette.requests import Request

from backend.api import notion_oauth_routes
from backend.services.integration_manager import IntegrationManager


def _request(headers: list[tuple[bytes, bytes]]) -> Request:
    return Request(
        {
            "type": "http",
            "method": "GET",
            "path": "/api/notion-oauth/login",
            "headers": headers,
            "query_string": b"",
            "server": ("localhost", 5002),
            "client": ("127.0.0.1", 1),
            "scheme": "http",
        }
    )


def test_frontend_origin_and_pkce_are_bounded(monkeypatch) -> None:
    request = _request([(b"origin", b"https://localhost:5173")])
    assert notion_oauth_routes._frontend_base(request) == "https://localhost:5173"

    monkeypatch.setattr(notion_oauth_routes, "_frontend_url", lambda: "http://fallback.test")
    assert notion_oauth_routes._frontend_base(_request([])) == "http://fallback.test"

    verifier, challenge = notion_oauth_routes._pkce()
    assert verifier
    assert challenge
    assert verifier != challenge
    assert "=" not in verifier
    assert "=" not in challenge


def test_status_and_disconnect_use_integration_manager(monkeypatch) -> None:
    stored = {"notion_mcp": {"token": "secret"}}
    replaced: list[tuple[str, object]] = []
    monkeypatch.setattr(
        notion_oauth_routes.integration_manager,
        "get_raw",
        lambda key: stored.get(key),
    )
    monkeypatch.setattr(
        notion_oauth_routes.integration_manager,
        "replace_key",
        lambda key, value: replaced.append((key, value)),
    )

    assert asyncio.run(notion_oauth_routes.status()) == {"connected": True}
    assert asyncio.run(notion_oauth_routes.disconnect()) == {"status": "success"}
    assert replaced == [
        ("notion_mcp", {}),
        ("notion_mcp_client", {}),
        ("notion_mcp_pending", {}),
    ]


def test_integration_manager_delete_key_is_atomic_and_idempotent(monkeypatch) -> None:
    manager = IntegrationManager.__new__(IntegrationManager)
    manager._lock = threading.RLock()
    stored = {"notion_mcp": {"token": "secret"}, "other": {"enabled": True}}
    saves: list[dict[str, object]] = []
    monkeypatch.setattr(manager, "_load", lambda: dict(stored))
    monkeypatch.setattr(manager, "_save", lambda value: saves.append(dict(value)))

    manager.delete_key("notion_mcp")
    manager.delete_key("missing")

    assert saves == [{"other": {"enabled": True}}]
