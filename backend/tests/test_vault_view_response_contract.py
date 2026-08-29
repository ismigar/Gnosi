"""Typed request and response contracts for saved Vault views."""

from __future__ import annotations

from fastapi.routing import APIRoute


def _routes() -> dict[str, APIRoute]:
    from backend.domains.vault.tables import routes

    names = {
        "create_view",
        "delete_view",
        "get_view",
        "get_view_usage",
        "list_views",
        "reorder_views",
        "update_view",
    }
    return {
        route.endpoint.__name__: route
        for route in routes.router.routes
        if isinstance(route, APIRoute) and route.endpoint.__name__ in names
    }


def test_saved_view_routes_publish_typed_models() -> None:
    from backend.domains.vault.views import contracts

    registered = _routes()

    assert registered["list_views"].response_model == list[contracts.VaultViewResponse]
    assert registered["create_view"].response_model is contracts.VaultViewResponse
    assert registered["get_view"].response_model is contracts.VaultViewResponse
    assert registered["get_view_usage"].response_model is contracts.ViewUsageResponse
    assert registered["reorder_views"].response_model is contracts.ViewReorderResponse
    assert registered["update_view"].response_model is contracts.ViewMutationResponse
    assert registered["delete_view"].response_model is contracts.ViewMutationResponse


def test_saved_view_models_preserve_flexible_registry_shapes() -> None:
    from backend.domains.vault.views import contracts

    view = {
        "id": "view-1",
        "table_id": "table-1",
        "name": "Board",
        "type": "board",
        "is_main": False,
        "visibleProperties": ["title", {"tableId": "table-1", "fieldKey": "status"}],
        "filters": [{"field": "status", "value": "Open"}],
    }

    parsed = contracts.VaultViewResponse.model_validate(view)

    assert parsed.model_dump(exclude_unset=True) == view
    assert contracts.ViewReorderRequest.model_validate(
        {"table_id": "table-1", "ordered_ids": ["view-1"]}
    ).model_dump() == {"table_id": "table-1", "ordered_ids": ["view-1"]}
    assert contracts.ViewUsageResponse.model_validate(
        {
            "view_id": "view-1",
            "count": 1,
            "pages": [{"id": "page-1", "title": "Page", "path": "/vault/Page.md"}],
        }
    ).count == 1
