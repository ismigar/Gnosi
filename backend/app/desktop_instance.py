"""Correlate desktop readiness with its spawned process without changing JSON."""

from __future__ import annotations

import os
import re

from starlette.types import ASGIApp, Message, Receive, Scope, Send

INSTANCE_HEADER = b"x-gnosi-desktop-instance"


class DesktopInstanceMiddleware:
    """Expose an optional process marker, never an authentication credential."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app
        identity = os.environ.get("GNOSI_DESKTOP_INSTANCE", "")
        if identity and not re.fullmatch(r"[0-9a-f]{64}", identity):
            raise ValueError("Invalid desktop process identity")
        self.identity = identity.encode("ascii")

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if not self.identity or scope["type"] != "http" or scope["path"] != "/api/health":
            await self.app(scope, receive, send)
            return

        async def send_with_identity(message: Message) -> None:
            if message["type"] == "http.response.start" and message["status"] == 200:
                headers = [
                    (name, value)
                    for name, value in message.get("headers", [])
                    if name.lower() not in {INSTANCE_HEADER, b"cache-control"}
                ]
                message = {
                    **message,
                    "headers": [
                        *headers,
                        (INSTANCE_HEADER, self.identity),
                        (b"cache-control", b"no-store"),
                    ],
                }
            await send(message)

        await self.app(scope, receive, send_with_identity)
