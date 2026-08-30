"""Process identity is optional and independent of private runtime settings."""

from __future__ import annotations

import asyncio

import pytest
from starlette.types import Message, Receive, Scope, Send

from backend.app.desktop_instance import INSTANCE_HEADER, DesktopInstanceMiddleware


@pytest.mark.parametrize("identity", ["", "a" * 64])
@pytest.mark.parametrize(
    "path,status", [("/api/health", 200), ("/api/health", 503), ("/api/other", 200)]
)
def test_identity_only_decorates_successful_health(
    monkeypatch: pytest.MonkeyPatch,
    identity: str,
    path: str,
    status: int,
) -> None:
    monkeypatch.setenv("GNOSI_DESKTOP_INSTANCE", identity)
    sent: list[Message] = []
    original: Message = {
        "type": "http.response.start",
        "status": status,
        "headers": [(b"content-type", b"application/json")],
    }
    body: Message = {"type": "http.response.body", "body": b'{"status":"ok"}'}

    async def application(_scope: Scope, _receive: Receive, send: Send) -> None:
        await send(original)
        await send(body)

    async def receive() -> Message:
        return {"type": "http.request", "body": b""}

    async def send(message: Message) -> None:
        sent.append(message)

    middleware = DesktopInstanceMiddleware(application)
    # A renderer-supplied marker never becomes the server's identity.
    scope: Scope = {"type": "http", "path": path, "headers": [(INSTANCE_HEADER, b"forged")]}
    asyncio.run(middleware(scope, receive, send))
    headers = dict(sent[0]["headers"])
    if identity and path == "/api/health" and status == 200:
        assert headers[INSTANCE_HEADER] == identity.encode()
        assert headers[b"cache-control"] == b"no-store"
    else:
        assert INSTANCE_HEADER not in headers
    assert sent[1] is body
    assert original["headers"] == [(b"content-type", b"application/json")]


@pytest.mark.parametrize("identity", ["unsafe\r\nheader", "z" * 64, "a" * 63])
def test_invalid_identity_fails_before_readiness(
    monkeypatch: pytest.MonkeyPatch,
    identity: str,
) -> None:
    monkeypatch.setenv("GNOSI_DESKTOP_INSTANCE", identity)

    async def application(_scope: Scope, _receive: Receive, _send: Send) -> None:
        raise AssertionError("Invalid identity must not run the application")

    with pytest.raises(ValueError, match="Invalid desktop process identity"):
        DesktopInstanceMiddleware(application)
