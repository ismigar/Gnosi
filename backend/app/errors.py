"""Global HTTP error translation and private diagnostic notification."""

from __future__ import annotations

import logging
import traceback

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from backend.platform.notifications import notify as _notify_fn


log = logging.getLogger(__name__)


async def global_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """Log an uncontrolled error and return a data-safe client response."""
    route = f"{request.method} {request.url.path}"
    error_detail = str(exc)
    trace = traceback.format_exc()
    log.error("Unhandled exception on %s: %s\n%s", route, error_detail, trace)

    try:
        short_trace = trace.split("\n")[-3] if trace else error_detail
        _notify_fn(
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


def register_error_handlers(app: FastAPI) -> None:
    """Install the global exception boundary on one application instance."""
    app.add_exception_handler(Exception, global_exception_handler)
