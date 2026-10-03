"""Global HTTP error translation and private diagnostic notification."""

from __future__ import annotations

import asyncio
import logging
import traceback

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from backend.utils.metadata_io import MetadataUnavailable

from backend.platform.notifications import notify as _notify_fn


log = logging.getLogger(__name__)


async def global_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """Log an uncontrolled error and return a data-safe client response."""
    if isinstance(exc, MetadataUnavailable):
        return await metadata_exception_handler(request, exc)
    route = f"{request.method} {request.url.path}"
    error_detail = str(exc)
    trace = traceback.format_exc()
    log.error("Unhandled exception on %s: %s\n%s", route, error_detail, trace)

    try:
        short_trace = trace.split("\n")[-3] if trace else error_detail
        await asyncio.to_thread(
            _notify_fn,
            f"Application error: {route}",
            f"{error_detail}\n\n{short_trace}",
            level="ERROR",
        )
    except Exception:  # noqa: BLE001
        pass

    error_id = hex(abs(hash((route, error_detail))) & 0xFFFFFFFF)[2:]
    log.error("error_id=%s", error_id)
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error", "error_id": error_id},
    )


async def metadata_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """Expose a retryable provider failure without paths or file contents."""
    language = request.headers.get("Accept-Language", "en").split(",", 1)[0].split("-", 1)[0].lower()
    messages = {
        "ca": "Les dades del núvol encara no estan disponibles. Torna-ho a provar d’aquí a uns segons.",
        "es": "Los datos de la nube aún no están disponibles. Vuelve a intentarlo en unos segundos.",
        "fr": "Les données du cloud ne sont pas encore disponibles. Réessayez dans quelques secondes.",
        "en": "Cloud data is not available yet. Retry shortly.",
    }
    return JSONResponse(
        status_code=503,
        headers={"Retry-After": "30"},
        content={"detail": messages.get(language, messages["en"]),
                 "code": "metadata_unavailable"},
    )


def register_error_handlers(app: FastAPI) -> None:
    """Install the global exception boundary on one application instance."""
    app.add_exception_handler(MetadataUnavailable, metadata_exception_handler)
    app.add_exception_handler(Exception, global_exception_handler)
