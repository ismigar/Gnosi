"""Typed request and response contract for table property updates."""

from __future__ import annotations

from fastapi.routing import APIRoute


def _route() -> APIRoute:
    from backend.domains.vault.tables import routes

    return next(
        route
        for route in routes.router.routes
        if isinstance(route, APIRoute)
        and route.endpoint.__name__ == "patch_table_property"
    )


def test_table_property_route_publishes_typed_model() -> None:
    from backend.domains.vault.tables import contracts

    assert _route().response_model is contracts.TablePropertyPatchResponse


def test_table_property_contract_preserves_registry_property() -> None:
    from backend.domains.vault.tables.contracts import TablePropertyPatchResponse

    payload = {
        "status": "success",
        "table_id": "table-1",
        "property": {
            "id": "status",
            "name": "Status",
            "type": "select",
            "config": {"options": [{"name": "Open"}]},
        },
    }

    assert TablePropertyPatchResponse.model_validate(payload).model_dump() == payload
