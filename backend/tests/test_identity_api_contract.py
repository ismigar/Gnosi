"""Typed OpenAPI contract for the vault-local identity profile."""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.routing import APIRoute

from backend.api import identity_routes
from backend.domains.identity.schemas import IdentityProfile, IdentityReadResponse


def _focused_openapi() -> dict[str, object]:
    app = FastAPI()
    app.include_router(identity_routes.router)
    return app.openapi()


def test_identity_json_routes_have_concrete_response_models() -> None:
    routes = [route for route in identity_routes.router.routes if isinstance(route, APIRoute)]

    assert len(routes) == 2
    assert all(route.response_model is not None for route in routes)


def test_identity_openapi_exposes_read_write_contracts() -> None:
    operations = _focused_openapi()["paths"]["/api/identity"]

    assert operations["get"]["responses"]["200"]["content"]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/IdentityReadResponse"
    }
    assert operations["post"]["requestBody"]["content"]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/IdentityProfile"
    }
    assert operations["post"]["responses"]["200"]["content"]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/IdentitySaveResponse"
    }


def test_identity_models_preserve_defaults_and_additive_legacy_fields() -> None:
    assert IdentityProfile().model_dump() == {
        "full_name": "",
        "first_name": "",
        "last_name": "",
        "email": "",
        "phone": "",
        "address": "",
        "city": "",
        "zip_code": "",
        "dni_nie": "",
        "notes": "",
    }
    legacy = IdentityReadResponse.model_validate(
        {"full_name": "Ada Lovelace", "preferred_pronouns": "she/her"}
    )
    assert legacy.model_dump(exclude_unset=True) == {
        "full_name": "Ada Lovelace",
        "preferred_pronouns": "she/her",
    }
