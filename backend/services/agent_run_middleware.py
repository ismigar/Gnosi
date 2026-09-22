"""Expose execution correlation without changing functional response bodies."""
from __future__ import annotations

from contextvars import ContextVar
from starlette.types import ASGIApp, Message, Receive, Scope, Send

_run_ids: ContextVar[list[str] | None] = ContextVar("agent_request_run_ids", default=None)


def report_run(run_id: str) -> None:
    ids = _run_ids.get()
    if ids is not None and run_id not in ids:
        ids.append(run_id)


class AgentRunMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        identifiers: list[str] = []
        token = _run_ids.set(identifiers)
        async def correlated_send(message: Message) -> None:
            if message["type"] == "http.response.start" and identifiers:
                headers = list(message.get("headers", []))
                headers.append((b"x-agent-run-id", identifiers[0].encode("ascii")))
                message = {**message, "headers": headers}
            await send(message)
        try:
            await self.app(scope, receive, correlated_send)
        finally:
            _run_ids.reset(token)
