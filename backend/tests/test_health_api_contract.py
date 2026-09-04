"""Typed contract for the public Gnosi liveness endpoint."""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
import json
from pathlib import Path
import tomllib
from typing import Any

from fastapi import FastAPI
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient

from backend.app.factory import GNOSI_VERSION, create_app
from backend.app.health_contracts import HealthResponse


@asynccontextmanager
async def _lifespan(_app: FastAPI) -> AsyncIterator[None]:
    yield


ROOT = Path(__file__).resolve().parents[2]


def test_public_application_version_matches_every_release_manifest() -> None:
    app = create_app(_lifespan)
    python_manifest = tomllib.loads((ROOT / "pyproject.toml").read_text(encoding="utf-8"))
    node_versions = [
        json.loads((ROOT / manifest).read_text(encoding="utf-8"))["version"]
        for manifest in ("package.json", "frontend/package.json", "desktop/package.json")
    ]

    assert app.version == GNOSI_VERSION == python_manifest["project"]["version"]
    assert node_versions == [GNOSI_VERSION, GNOSI_VERSION, GNOSI_VERSION]
    assert app.openapi()["info"]["version"] == GNOSI_VERSION


def test_health_route_has_a_concrete_response_model() -> None:
    app = create_app(_lifespan)
    route = next(
        route for route in app.routes if isinstance(route, APIRoute) and route.path == "/api/health"
    )

    assert route.response_model is HealthResponse


def test_health_openapi_exposes_the_existing_payload_shape() -> None:
    app = create_app(_lifespan)
    schema: dict[str, Any] = app.openapi()

    assert schema["paths"]["/api/health"]["get"]["responses"]["200"]["content"]["application/json"][
        "schema"
    ] == {"$ref": "#/components/schemas/HealthResponse"}
    assert schema["components"]["schemas"]["HealthResponse"]["required"] == [
        "status",
        "mode",
        "gnosi_mode",
        "require_auth",
        "vault_configured",
    ]


def test_health_model_preserves_the_liveness_payload() -> None:
    payload = {
        "status": "ok",
        "mode": "FastAPI",
        "gnosi_mode": "personal",
        "require_auth": False,
        "vault_configured": True,
    }

    assert HealthResponse.model_validate(payload).model_dump() == payload


def test_health_request_uses_only_the_in_memory_snapshot(monkeypatch) -> None:
    app = create_app(_lifespan)
    expected = {
        "status": "ok",
        "mode": "FastAPI",
        "gnosi_mode": "personal",
        "require_auth": False,
        "vault_configured": True,
    }
    app.state.health_snapshot = expected

    import backend.app.factory as factory

    monkeypatch.setattr(
        factory,
        "load_params",
        lambda **_kwargs: (_ for _ in ()).throw(AssertionError("storage read")),
    )
    with TestClient(app) as client:
        response = client.get("/api/health")

    assert response.status_code == 200
    assert response.json() == expected
