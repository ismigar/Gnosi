"""Typed OpenAPI contract for repository-local environment settings."""

from __future__ import annotations

import asyncio

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.routing import APIRoute

from backend.domains.configuration.api import environment
from backend.domains.configuration.environment_schemas import EnvironmentUpdateRequest


def _focused_openapi() -> dict[str, object]:
    app = FastAPI()
    app.include_router(environment.router, prefix="/api")
    return app.openapi()


def test_environment_json_routes_have_concrete_response_models() -> None:
    routes = [route for route in environment.router.routes if isinstance(route, APIRoute)]

    assert len(routes) == 2
    assert all(route.response_model is not None for route in routes)


def test_environment_openapi_exposes_typed_read_write_contracts() -> None:
    operations = _focused_openapi()["paths"]["/api/env"]

    assert operations["get"]["responses"]["200"]["content"]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/EnvironmentResponse"
    }
    assert operations["post"]["requestBody"]["content"]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/EnvironmentUpdateRequest"
    }
    assert operations["post"]["responses"]["200"]["content"]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/EnvironmentUpdateResponse"
    }


def test_environment_typed_body_keeps_legacy_empty_and_non_object_400() -> None:
    for payload in ({}, []):
        with pytest.raises(HTTPException) as exc_info:
            asyncio.run(environment.update_env(EnvironmentUpdateRequest(payload)))
        assert exc_info.value.status_code == 400
