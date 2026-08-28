"""Security and compatibility contracts for hosted Notion MCP OAuth."""

from __future__ import annotations

import asyncio

from starlette.requests import Request

from backend.api import notion_oauth_routes


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
