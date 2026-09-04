"""Typed construction of the Gnosi FastAPI application."""

from __future__ import annotations

from collections.abc import Callable
from contextlib import AbstractAsyncContextManager

from fastapi import Depends, FastAPI
from starlette.requests import Request

from backend import models as _models
from backend.app.errors import register_error_handlers
from backend.app.health_contracts import HealthResponse
from backend.app.middleware import register_middleware
from backend.app.routes import register_routers
from backend.config.app_config import load_params
from backend.config.logger_config import setup_logging
from backend.services.auth_public_surface import enforce_authentication
from backend.services.auth_service import require_auth_enabled


Lifespan = Callable[[FastAPI], AbstractAsyncContextManager[None]]
GNOSI_VERSION = "3.0.0"


def refresh_health_snapshot(app: FastAPI) -> None:
    """Build the liveness metadata once, outside request handling."""
    config = load_params(strict_env=False)
    app.state.health_snapshot = {
        "status": "ok",
        "mode": "FastAPI",
        "gnosi_mode": config.gnosi_mode,
        "require_auth": require_auth_enabled(),
        "vault_configured": config.paths.get("VAULT") is not None,
    }


async def health_check(request: Request) -> dict[str, object]:
    # Keep the public OpenAPI description stable. The implementation deliberately
    # serves only the snapshot prepared during startup; it must never touch storage.
    snapshot = request.app.state.health_snapshot
    if not isinstance(snapshot, dict):
        raise RuntimeError("Health snapshot is unavailable")
    return dict(snapshot)


def create_app(lifespan: Lifespan) -> FastAPI:
    """Create one fully composed application without starting its workers."""
    _ = _models
    app = FastAPI(
        title="Gnosi Agent",
        version=GNOSI_VERSION,
        lifespan=lifespan,
        dependencies=[Depends(enforce_authentication)],
    )
    app.state.health_snapshot = {
        "status": "ok",
        "mode": "FastAPI",
        "gnosi_mode": "starting",
        "require_auth": True,
        "vault_configured": False,
    }
    register_middleware(app)
    register_error_handlers(app)
    register_routers(app)
    app.add_api_route(
        "/api/health",
        health_check,
        methods=["GET"],
        response_model=HealthResponse,
    )
    setup_logging()
    return app
