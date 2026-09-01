"""Typed HTTP contract for notifications and host filesystem operations."""

from __future__ import annotations

from fastapi import FastAPI

from backend.api import system_routes
from backend.domains.system.schemas import (
    FilesystemBrowseResponse,
    FilesystemSearchResponse,
    NativePickResponse,
)


def _focused_openapi() -> dict[str, object]:
    app = FastAPI()
    app.include_router(system_routes.router, prefix="/api/system")
    return app.openapi()


def test_system_openapi_exposes_concrete_json_responses() -> None:
    schema = _focused_openapi()
    paths = schema["paths"]

    assert paths["/api/system/notifications"]["get"]["responses"]["200"]["content"][
        "application/json"
    ]["schema"] == {"$ref": "#/components/schemas/NotificationPageResponse"}
    assert paths["/api/system/browse"]["post"]["responses"]["200"]["content"]["application/json"][
        "schema"
    ] == {"$ref": "#/components/schemas/FilesystemBrowseResponse"}
    assert paths["/api/system/native-pick"]["post"]["responses"]["200"]["content"][
        "application/json"
    ]["schema"] == {"$ref": "#/components/schemas/NativePickResponse"}
    assert paths["/api/system/search"]["post"]["responses"]["200"]["content"]["application/json"][
        "schema"
    ] == {"$ref": "#/components/schemas/FilesystemSearchResponse"}


def test_system_variant_responses_preserve_short_legacy_payloads() -> None:
    roots = {"vault": "/vault", "home": "/Users/test", "root": "/"}
    browse_error = FilesystemBrowseResponse.model_validate(
        {
            "error": "Path does not exist",
            "error_code": "not_found",
            "roots": roots,
        }
    )
    browse_success = FilesystemBrowseResponse.model_validate(
        {
            "current_path": "/vault",
            "display_path": "/vault",
            "directories": ["Notes"],
            "files": ["README.md"],
            "roots": roots,
        }
    )
    cancelled_pick = NativePickResponse.model_validate({"status": "cancelled"})
    short_search = FilesystemSearchResponse.model_validate({"results": [], "truncated": False})

    assert browse_error.model_dump(exclude_unset=True) == {
        "error": "Path does not exist",
        "error_code": "not_found",
        "roots": roots,
    }
    assert browse_success.model_dump(exclude_unset=True) == {
        "current_path": "/vault",
        "display_path": "/vault",
        "directories": ["Notes"],
        "files": ["README.md"],
        "roots": roots,
    }
    assert cancelled_pick.model_dump(exclude_unset=True) == {"status": "cancelled"}
    assert short_search.model_dump(exclude_unset=True) == {
        "results": [],
        "truncated": False,
    }


def test_system_variable_routes_exclude_unset_compatibility_fields() -> None:
    variable_paths = {"/stats", "/browse", "/native-pick", "/search"}

    for route in system_routes.router.routes:
        if route.path in variable_paths:
            assert route.response_model_exclude_unset is True
