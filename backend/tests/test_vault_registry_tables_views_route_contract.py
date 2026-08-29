"""Frozen route contract for the PR6 registry/table/view extraction."""

from __future__ import annotations

from fastapi.routing import APIRoute

from backend.api import vault_routes
from backend.domains.vault.tables.contracts import RegistryRecord


RouteFingerprint = tuple[str, str, str, int]

EXPECTED_ROUTE_FINGERPRINT: tuple[RouteFingerprint, ...] = (
    ("GET", "/registry", "get_registry", 1),
    ("POST", "/registry", "update_registry", 2),
    ("GET", "/databases", "list_databases", 1),
    ("POST", "/databases", "create_database", 2),
    ("DELETE", "/databases/{database_id}", "delete_database", 2),
    ("GET", "/tables", "list_tables", 1),
    ("POST", "/tables", "create_table", 2),
    ("DELETE", "/tables/{table_id}", "delete_table", 2),
    ("PUT", "/tables/{table_id}", "rename_table", 2),
    (
        "PATCH",
        "/tables/{table_id}/properties/{field_id}",
        "patch_table_property",
        2,
    ),
    ("GET", "/tables/{table_id}/options/usage", "table_option_usage", 1),
    (
        "POST",
        "/tables/{table_id}/options/rename",
        "rename_table_option",
        2,
    ),
    (
        "POST",
        "/tables/{table_id}/options/remove",
        "remove_table_option",
        2,
    ),
    ("GET", "/option-catalogs", "list_option_catalogs", 1),
    ("PUT", "/option-catalogs/{name}", "put_option_catalog", 2),
    ("DELETE", "/option-catalogs/{name}", "delete_option_catalog", 2),
    ("GET", "/views", "list_views", 1),
    ("POST", "/views", "create_view", 2),
    ("PUT", "/views/order", "reorder_views", 2),
    ("GET", "/views/{view_id}", "get_view", 1),
    ("GET", "/views/{view_id}/usage", "get_view_usage", 1),
    ("DELETE", "/views/{view_id}", "delete_view", 2),
    ("PUT", "/views/{view_id}", "update_view", 2),
    ("POST", "/schema", "save_schema", 2),
    ("GET", "/schema", "get_schema", 1),
)

TARGET_HANDLER_NAMES = frozenset(
    handler_name for _method, _path, handler_name, _dependency_count in EXPECTED_ROUTE_FINGERPRINT
)


def _fingerprint() -> tuple[RouteFingerprint, ...]:
    output: list[RouteFingerprint] = []
    for route in vault_routes.router.routes:
        if not isinstance(route, APIRoute):
            continue
        handler_name = route.endpoint.__name__
        if handler_name not in TARGET_HANDLER_NAMES:
            continue
        output.extend(
            (
                method,
                route.path,
                handler_name,
                len(route.dependant.dependencies),
            )
            for method in sorted(route.methods)
        )
    return tuple(output)


def test_registry_table_view_route_fingerprint_is_unchanged() -> None:
    assert _fingerprint() == EXPECTED_ROUTE_FINGERPRINT


def test_registry_table_view_routes_keep_legacy_facade_identity() -> None:
    routes = {
        route.endpoint.__name__: route
        for route in vault_routes.router.routes
        if isinstance(route, APIRoute) and route.endpoint.__name__ in TARGET_HANDLER_NAMES
    }
    assert tuple(routes) == tuple(item[2] for item in EXPECTED_ROUTE_FINGERPRINT)
    for handler_name, route in routes.items():
        assert route.endpoint is getattr(vault_routes, handler_name)


def test_list_tables_exposes_the_typed_registry_contract() -> None:
    route = next(
        route
        for route in vault_routes.router.routes
        if isinstance(route, APIRoute) and route.endpoint.__name__ == "list_tables"
    )
    assert route.response_model == list[RegistryRecord]
