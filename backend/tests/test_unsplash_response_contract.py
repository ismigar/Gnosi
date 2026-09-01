"""Typed response contract for the Unsplash cover search proxy."""

from __future__ import annotations

import asyncio

import pytest
from fastapi.routing import APIRoute


def _route() -> APIRoute:
    from backend.domains.vault.media import routes

    return next(
        route
        for route in routes.router.routes
        if isinstance(route, APIRoute) and route.endpoint.__name__ == "unsplash_search"
    )


def test_unsplash_route_exposes_typed_response_model() -> None:
    from backend.domains.vault.media import routes

    route = _route()

    assert route.path == "/unsplash/search"
    assert route.methods == {"GET"}
    assert route.response_model is routes.UnsplashSearchResponse


def test_unsplash_handler_preserves_search_shape(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from backend.domains.vault.media import routes

    class FakeResponse:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict[str, object]:
            return {
                "total_pages": 3,
                "results": [
                    {
                        "id": "photo-1",
                        "urls": {"regular": "https://img.test/full", "small": "https://img.test/thumb"},
                        "user": {
                            "name": "Ada",
                            "links": {"html": "https://unsplash.test/ada"},
                        },
                    }
                ],
            }

    monkeypatch.setenv("UNSPLASH_ACCESS_KEY", "test-key")
    monkeypatch.setattr(routes._legacy.requests, "get", lambda *_args, **_kwargs: FakeResponse())

    result = asyncio.run(routes.unsplash_search("knowledge", page=2))
    expected = {
        "results": [
            {
                "id": "photo-1",
                "url": "https://img.test/full",
                "thumb": "https://img.test/thumb",
                "author": "Ada",
                "author_url": "https://unsplash.test/ada",
            }
        ],
        "total_pages": 3,
    }

    assert result == expected
    assert routes.UnsplashSearchResponse.model_validate(result).model_dump() == expected
