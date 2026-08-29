"""Typed response contracts for the Vault custom-icon flow."""

from __future__ import annotations

from fastapi.routing import APIRoute


def _routes() -> dict[tuple[str, str], APIRoute]:
    from backend.api import vault_routes

    wanted = {
        ("POST", "/upload-cover"),
        ("POST", "/upload-icon"),
        ("POST", "/import-icon-url"),
        ("GET", "/custom-icons"),
        ("PUT", "/custom-icons"),
    }
    return {
        (method, route.path): route
        for route in vault_routes.router.routes
        if isinstance(route, APIRoute)
        for method in route.methods
        if (method, route.path) in wanted
    }


def test_icon_routes_publish_exact_response_models() -> None:
    from backend.domains.vault.assets import schemas

    routes = _routes()

    assert routes[("POST", "/upload-icon")].response_model is schemas.IconAssetResponse
    assert routes[("POST", "/upload-cover")].response_model is schemas.ImageAssetResponse
    assert (
        routes[("POST", "/import-icon-url")].response_model
        is schemas.IconAssetResponse
    )
    assert routes[("GET", "/custom-icons")].response_model is schemas.CustomIconsResponse
    assert routes[("PUT", "/custom-icons")].response_model is schemas.CustomIconsResponse


def test_icon_models_preserve_historical_json_shapes() -> None:
    from backend.domains.vault.assets import schemas

    icon = {
        "url": "/api/vault/assets/Icons/icon-abc.png",
        "path": "Assets/Icons/icon-abc.png",
        "thumbnail_url": None,
        "thumbnail_path": None,
    }
    library = {
        "icons": [
            "/api/vault/assets/Icons/icon-abc.png",
            "https://example.test/icon.svg",
        ]
    }
    cover = {
        "url": "/api/vault/assets/Covers/cover.jpg",
        "path": "Assets/Covers/cover.jpg",
    }

    assert schemas.IconAssetResponse.model_validate(icon).model_dump() == icon
    assert schemas.ImageAssetResponse.model_validate(cover).model_dump() == cover
    assert schemas.CustomIconsResponse.model_validate(library).model_dump() == library
