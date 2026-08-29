"""Typed response contract for the external-link preview route."""

from __future__ import annotations

import asyncio
from types import SimpleNamespace
from typing import cast

import httpx
import pytest
from fastapi import APIRouter
from fastapi.routing import APIRoute

from backend.domains.vault.links.api import preview
from backend.domains.vault.links.api.dependencies import LinkApiDependencies


def _registered_route() -> APIRoute:
    router = APIRouter()
    preview.register_route(
        router,
        cast(LinkApiDependencies, SimpleNamespace()),
    )
    return next(route for route in router.routes if isinstance(route, APIRoute))


def test_link_preview_route_exposes_exact_response_model() -> None:
    route = _registered_route()

    assert set(preview.LinkPreviewResponse.model_fields) == {
        "url",
        "title",
        "description",
        "image",
        "site_name",
        "favicon",
    }
    assert route.path == "/link-preview"
    assert route.methods == {"GET"}
    assert route.status_code is None
    assert route.response_model is preview.LinkPreviewResponse


def test_link_preview_handler_returns_the_frozen_json_shape(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    raw_url = "https://example.test/articles/typed-contract"
    html = (
        '<html><head><meta property="og:title" content="Typed contract">'
        '<meta property="og:description" content="Stable preview metadata">'
        '<meta property="og:image" content="/cover.jpg">'
        '<meta property="og:site_name" content="Example"></head></html>'
    )

    async def fake_fetch_preview_response(
        raw: str,
        _dependencies: LinkApiDependencies,
    ) -> tuple[httpx.Response, str]:
        assert raw == raw_url
        return (
            httpx.Response(
                200,
                headers={"content-type": "text/html; charset=utf-8"},
                text=html,
            ),
            raw_url,
        )

    monkeypatch.setattr(preview, "_fetch_preview_response", fake_fetch_preview_response)

    result = asyncio.run(_registered_route().endpoint(url=raw_url))

    assert isinstance(result, preview.LinkPreviewResponse)
    assert result.model_dump() == {
        "url": raw_url,
        "title": "Typed contract",
        "description": "Stable preview metadata",
        "image": "https://example.test/cover.jpg",
        "site_name": "Example",
        "favicon": "https://example.test/favicon.ico",
    }
