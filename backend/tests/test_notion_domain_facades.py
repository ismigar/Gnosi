"""Compatibility contracts for the typed Notion domain extraction."""

from __future__ import annotations

from inspect import signature
from types import ModuleType
from typing import Any, Dict, Iterable, List

from fastapi.routing import APIRoute
import pytest

from backend.api import notion_routes
from backend.domains.notion import clone as domain_clone
from backend.domains.notion import importer as domain_importer
from backend.domains.notion import view_recreator as domain_views
from backend.services import notion_clone, notion_importer, notion_view_recreator

JsonMap = Dict[str, Any]

HISTORICAL_SERVICE_EXPORTS = {
    notion_clone: {
        "Any",
        "Callable",
        "CloneAborted",
        "Dict",
        "List",
        "Optional",
        "SKIP_VIEW_TYPES",
        "block_file_url",
        "build_clone_views",
        "clone_page_id",
        "clone_table_id",
        "clone_table_schema",
        "clone_values",
        "clone_workspace",
        "map_database_schema",
        "nvr",
        "page_to_values",
        "re",
        "resolve_view_markers",
        "sanitize_vault_title",
        "time",
        "uuid",
    },
    notion_importer: {
        "Any",
        "Callable",
        "Dict",
        "Iterable",
        "List",
        "NOTION_API",
        "NOTION_VERSION",
        "NotionClient",
        "Optional",
        "READ_ONLY_TYPES",
        "block_to_md",
        "blocks_to_md",
        "gnosi_id_for",
        "map_database_schema",
        "map_property_schema",
        "page_id_for",
        "page_to_values",
        "rich_text_to_md",
        "table_id_for",
        "time",
        "uuid",
        "value_to_gnosi",
    },
    notion_view_recreator: {
        "Any",
        "Dict",
        "List",
        "Optional",
        "Tuple",
        "build_gnosi_view",
        "deduplicate_view_definitions",
        "is_contextual_view",
        "json",
        "map_simple_filter",
        "parse_mcp_page",
        "parse_mcp_view",
        "parse_mcp_views",
        "re",
        "recreate_views_for_page",
        "resolve_filter_field",
        "uuid",
        "view_embed",
        "view_identity",
    },
}


def test_notion_router_preserves_the_historical_route_inventory() -> None:
    actual = [
        (next(iter(route.methods or set())), route.path)
        for route in notion_routes.router.routes
        if isinstance(route, APIRoute)
    ]
    assert actual == [
        ("POST", "/notion/token"),
        ("GET", "/notion/status"),
        ("DELETE", "/notion/token"),
        ("GET", "/notion/import-config"),
        ("PUT", "/notion/import-config"),
        ("GET", "/notion/databases"),
        ("GET", "/notion/databases/{db_id}/schema"),
        ("GET", "/notion/linked-databases"),
        ("GET", "/notion/loose-pages"),
        ("GET", "/notion/clone/progress"),
        ("POST", "/notion/clone/abort"),
        ("POST", "/notion/clone"),
        ("POST", "/notion/verify-clone"),
    ]


def test_historical_service_imports_resolve_to_canonical_owners() -> None:
    assert notion_importer.NotionClient is domain_importer.NotionClient
    assert notion_importer.block_to_md is domain_importer.block_to_md
    assert notion_importer.map_database_schema is domain_importer.map_database_schema
    assert notion_view_recreator.build_gnosi_view is domain_views.build_gnosi_view
    assert notion_view_recreator.parse_mcp_views is domain_views.parse_mcp_views
    assert notion_clone.clone_page_id is domain_clone.clone_page_id
    assert notion_clone.clone_table_id is domain_clone.clone_table_id
    assert notion_clone.time is domain_clone.time


@pytest.mark.parametrize("module", HISTORICAL_SERVICE_EXPORTS)
def test_historical_service_star_imports_remain_available(module: ModuleType) -> None:
    assert set(module.__all__) == HISTORICAL_SERVICE_EXPORTS[module]
    assert all(hasattr(module, name) for name in module.__all__)


def test_clone_workspace_preserves_its_historical_call_shape() -> None:
    parameters = list(signature(notion_clone.clone_workspace).parameters)
    assert parameters == [
        "rest_client",
        "fetch_page",
        "mcp_to_markdown",
        "write_table",
        "write_page",
        "write_view",
        "database_ids",
        "target_folder",
        "max_pages",
        "schema_overrides",
        "save_asset",
        "loose_page_types",
        "follow_subpages",
        "progress_cb",
        "should_cancel",
        "registry_tables",
    ]


class _RestClient:
    def list_users(self) -> Dict[str, str]:
        return {}

    def search_databases(self) -> List[JsonMap]:
        return []

    def get_database(self, database_id: str) -> JsonMap:
        return {"id": database_id, "title": []}

    def query_database(self, database_id: str) -> Iterable[JsonMap]:
        del database_id
        return []

    def get_block(self, block_id: str) -> JsonMap:
        return {"id": block_id}

    def get_page(self, page_id: str) -> JsonMap:
        return {"id": page_id, "properties": {}}

    def get_block_children(self, block_id: str) -> List[JsonMap]:
        del block_id
        return []


def test_clone_facade_resolves_monkeypatch_seams_at_call_time(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    observed: List[str] = []
    written_tables: List[JsonMap] = []

    def fake_schema(database: JsonMap) -> JsonMap:
        observed.append(str(database["id"]))
        return {"id": "clone-db", "name": "DB", "properties": []}

    monkeypatch.setattr(notion_clone, "clone_table_schema", fake_schema)
    report = notion_clone.clone_workspace(
        _RestClient(),
        fetch_page=lambda _page_id: "",
        mcp_to_markdown=lambda markdown: markdown,
        write_table=written_tables.append,
        write_page=lambda _page: None,
        write_view=lambda _view: None,
        database_ids=["db-1"],
        follow_subpages=False,
    )

    assert observed == ["db-1"]
    assert written_tables[0]["id"] == "clone-db"
    assert report["tables"] == 1
