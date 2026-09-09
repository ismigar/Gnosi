"""Browser liveness remains local even with an active-vault cookie/header."""

import asyncio
from unittest.mock import AsyncMock

import pytest

from backend.services import active_vault_middleware as routing


@pytest.mark.parametrize("headers,query", [
    ([(b"cookie", b"gnosi_active_vault=unavailable-vault")], b""),
    ([(b"x-vault-id", b"unavailable-vault")], b""),
    ([], b"vault=unavailable-vault"),
])
def test_liveness_does_not_resolve_the_browser_vault(monkeypatch, headers, query):
    lookup = AsyncMock(side_effect=AssertionError("Liveness attempted storage access"))
    monkeypatch.setattr(routing, "_resolve_request_vault_identity", lookup)
    sent = []

    async def app(scope, receive, send):
        assert scope["path"] == "/api/health"
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await send({"type": "http.response.body", "body": b"ok"})

    async def receive():
        return {"type": "http.request", "body": b""}

    async def send(message):
        sent.append(message)

    asyncio.run(routing.ActiveVaultMiddleware(app)({
        "type": "http", "method": "GET", "path": "/api/health",
        "headers": headers, "query_string": query,
    }, receive, send))
    lookup.assert_not_called()
    assert sent[0]["status"] == 200


@pytest.mark.parametrize("method,path", [("POST", "/api/health"), ("GET", "/api/health/other")])
def test_only_the_exact_get_liveness_route_skips_vault_resolution(monkeypatch, method, path):
    lookup = AsyncMock(return_value=None)
    monkeypatch.setattr(routing, "_resolve_request_vault_identity", lookup)

    async def app(scope, receive, send):
        pass

    async def callback(*_):
        pass

    asyncio.run(routing.ActiveVaultMiddleware(app)({
        "type": "http", "method": method, "path": path,
        "headers": [(b"x-vault-id", b"fixture")], "query_string": b"",
    }, callback, callback))
    lookup.assert_awaited_once_with("fixture")
