"""Mail-only route for bounded recovery of blocked remote raster images."""

from __future__ import annotations

from fastapi import HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field

from backend.domains.mail.routing import router
from backend.domains.mail.services.remote_images import (
    RemoteMailImageError,
    fetch_remote_mail_image,
)


class RemoteMailImageRequest(BaseModel):
    url: str = Field(min_length=1, max_length=4_000)


@router.post(
    "/remote-images/fetch",
    response_class=Response,
    response_model=None,
)
async def fetch_remote_image(payload: RemoteMailImageRequest) -> Response:
    """Return one validated raster image without retaining source or bytes."""
    try:
        image = await fetch_remote_mail_image(payload.url)
    except RemoteMailImageError as error:
        raise HTTPException(status_code=error.status_code, detail=error.code) from None
    return Response(
        content=image.body,
        media_type=image.content_type,
        headers={
            "Cache-Control": "private, no-store, max-age=0",
            "Content-Security-Policy": "default-src 'none'; sandbox",
            "X-Content-Type-Options": "nosniff",
        },
    )
