"""Architecture contract for the extracted table route composition."""

from __future__ import annotations

import inspect
from pathlib import Path

from fastapi import APIRouter
from fastapi.routing import APIRoute

from backend.api import vault_routes
from backend.domains.vault.tables import composition, routes, security

TARGET_HANDLERS = frozenset(
    {
        "list_databases",
        "create_database",
        "delete_database",
        "list_tables",
        "create_table",
        "delete_table",
        "rename_table",
        "patch_table_property",
        "table_option_usage",
        "rename_table_option",
        "remove_table_option",
        "list_option_catalogs",
        "put_option_catalog",
        "delete_option_catalog",
        "list_views",
        "create_view",
        "reorder_views",
        "get_view",
        "get_view_usage",
        "delete_view",
        "update_view",
        "save_schema",
        "get_schema",
    }
)


def _target_routes(router: APIRouter) -> list[APIRoute]:
    return [
        route
        for route in router.routes
        if isinstance(route, APIRoute) and route.endpoint.__name__ in TARGET_HANDLERS
    ]


def test_table_handlers_are_owned_by_the_domain_and_reexported_by_the_facade() -> None:
    target_routes = _target_routes(vault_routes.router)

    assert len(target_routes) == len(TARGET_HANDLERS)
    assert all(route.endpoint.__module__ == routes.__name__ for route in target_routes)
    assert all(
        route.endpoint is getattr(vault_routes, route.endpoint.__name__) for route in target_routes
    )


def test_flat_route_registration_is_idempotent() -> None:
    parent = APIRouter()

    routes.register_routes(parent)
    first = tuple(parent.routes)
    routes.register_routes(parent)

    assert tuple(parent.routes) == first
    assert len(_target_routes(parent)) == len(TARGET_HANDLERS)


def test_composition_owns_row_schema_and_view_dependencies() -> None:
    dependencies = vault_routes.table_domain_dependencies

    assert isinstance(dependencies, composition.TableDomainDependencies)
    assert dependencies.row_queries is vault_routes.table_row_query_dependencies
    assert dependencies.row_metadata is vault_routes.table_metadata_dependencies
    assert dependencies.properties is vault_routes.table_property_dependencies
    assert dependencies.views is vault_routes.vault_view_dependencies
    assert dependencies.folder_schema is vault_routes.vault_schema_dependencies


def test_domain_does_not_import_the_legacy_vault_facade() -> None:
    for module in (composition, routes, security):
        source = inspect.getsource(module)
        assert "backend.api.vault_routes" not in source


def test_extracted_modules_respect_source_size_limit() -> None:
    for module in (composition, routes, security):
        source_path = Path(inspect.getsourcefile(module) or "")
        assert len(source_path.read_text(encoding="utf-8").splitlines()) <= 800
