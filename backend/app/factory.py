"""Typed construction of the Gnosi FastAPI application."""

from __future__ import annotations

from collections.abc import Callable
from contextlib import AbstractAsyncContextManager

from fastapi import Depends, FastAPI

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


async def health_check() -> dict[str, object]:
    config = load_params(strict_env=False)
    return {
        "status": "ok",
        "mode": "FastAPI",
        "gnosi_mode": config.gnosi_mode,
        "require_auth": require_auth_enabled(),
        "vault_configured": config.paths.get("VAULT") is not None,
    }


def create_app(lifespan: Lifespan) -> FastAPI:
    """Create one fully composed application without starting its workers."""
    _ = _models
    app = FastAPI(
        title="Gnosi Agent",
        version="0.2.0",
        lifespan=lifespan,
        dependencies=[Depends(enforce_authentication)],
    )
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
