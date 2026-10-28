"""Bound multipart bytes before FastAPI spools uploaded files, including chunked requests."""
from __future__ import annotations
from collections.abc import Awaitable, Callable
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response
from fastapi.routing import APIRoute
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.formparsers import MultiPartException
from starlette.types import Message
from .models import SiteThemeAsset

MAX_BODY = 4_000_000 + 65_536
LIMIT_ERROR = "Website upload exceeds the 4 MB file limit"


class ThemeUploadRoute(APIRoute):
    def get_route_handler(self) -> Callable[[Request], Awaitable[Response]]:
        handler = super().get_route_handler()

        async def bounded(request: Request) -> Response:
            length = request.headers.get("content-length", "")
            if length.isdecimal() and int(length) > MAX_BODY:
                raise HTTPException(413, LIMIT_ERROR)
            received = 0

            async def receive() -> Message:
                nonlocal received
                message = await request.receive()
                received += len(message.get("body", b""))
                if received > MAX_BODY:
                    # Starlette closes any already spooled files on this exception.
                    raise MultiPartException(LIMIT_ERROR)
                return message

            try:
                return await handler(Request(request.scope, receive))
            except StarletteHTTPException as failure:
                if failure.status_code == 400 and failure.detail == LIMIT_ERROR:
                    raise HTTPException(413, LIMIT_ERROR) from None
                raise

        return bounded


def register_routes(router: APIRouter, upload_theme_asset: Callable[..., object]) -> None:
    """Attach only the upload endpoint to the bounded multipart route class."""
    router.add_api_route("/{site_id}/theme/assets", upload_theme_asset, methods=["POST"], response_model=SiteThemeAsset, status_code=201, route_class_override=ThemeUploadRoute)
