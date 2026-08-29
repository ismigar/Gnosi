"""Typed contracts for special Vault page mutations."""

from __future__ import annotations

from fastapi.routing import APIRoute


def _route(endpoint_name: str) -> APIRoute:
    from backend.api import vault_routes

    return next(
        route
        for route in vault_routes.router.routes
        if isinstance(route, APIRoute) and route.endpoint.__name__ == endpoint_name
    )


def test_special_page_routes_publish_typed_models() -> None:
    from backend.domains.vault.citations import lookup_routes  # noqa: F401
    from backend.domains.vault.media import routes  # noqa: F401
    from backend.domains.vault.schemas import pages

    assert _route("duplicate_page").response_model is pages.PageDuplicateResponse
    assert _route("bulk_apply_template").response_model is pages.BulkPageMutationResponse


def test_bulk_template_contract_preserves_etag_results() -> None:
    from backend.domains.vault.schemas.pages import BulkPageMutationResponse

    payload = {
        "updated": 1,
        "updated_ids": ["page-1"],
        "updated_with_etags": [{"page_id": "page-1", "etag": "etag-2"}],
        "skipped": ["page-2"],
        "conflicts": [
            {
                "page_id": "page-3",
                "expected_etag": "etag-1",
                "current_etag": "etag-2",
            }
        ],
        "errors": [{"page_id": "page-4", "error": "missing"}],
    }

    assert BulkPageMutationResponse.model_validate(payload).model_dump() == payload
