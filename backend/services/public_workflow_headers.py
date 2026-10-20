"""Keep revocable token responses out of caches and referrers."""

from starlette.types import ASGIApp, Message, Receive, Scope, Send


class PublicWorkflowHeadersMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        path = str(scope.get("path", ""))
        selected = path.startswith(("/api/forms", "/api/booking", "/forms/", "/book/"))
        if scope["type"] != "http" or not selected:
            await self.app(scope, receive, send)
            return

        async def protected_send(message: Message) -> None:
            if message["type"] == "http.response.start":
                protected = {b"cache-control", b"referrer-policy", b"x-robots-tag"}
                message = {**message, "headers": [
                    (key, value) for key, value in message.get("headers", [])
                    if key.lower() not in protected
                ] + [(b"cache-control", b"no-store"), (b"referrer-policy", b"no-referrer"),
                     (b"x-robots-tag", b"noindex, nofollow")]}
            await send(message)

        await self.app(scope, receive, protected_send)
