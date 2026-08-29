"""Frozen route fingerprint for the PR5 vault domain extraction."""

from __future__ import annotations

import json
from pathlib import Path

from fastapi.routing import APIRoute

from backend.api import vault_routes
from backend.domains.vault.schemas.pages import (
    BulkPreviewWarmResponse,
    PageDeleteResponse,
    PageDetailResponse,
    PageMutationResponse,
    PagePreviewResponse,
)
from backend.domains.vault.trash import purge as trash_purge


RouteFingerprint = tuple[str, str, str]

EXPECTED_ROUTE_FINGERPRINT: tuple[RouteFingerprint, ...] = (
    ("GET", "/pages", "list_pages"),
    ("GET", "/pages/by-table/{table_id}", "list_pages_by_table"),
    (
        "GET",
        "/pages/by-table/{table_id}/snapshot",
        "list_pages_by_table_snapshot",
    ),
    ("GET", "/indexer-status", "get_indexer_status_endpoint"),
    ("GET", "/sidebar/summary", "list_sidebar_summary"),
    ("POST", "/pages", "create_page"),
    ("GET", "/pages/{page_id}", "get_page"),
    ("GET", "/pages/{page_id}/preview", "get_page_preview"),
    ("POST", "/pages/preview/warm", "bulk_warm_previews"),
    ("PUT", "/pages/{page_id}", "save_page"),
    ("PATCH", "/pages/{page_id}", "patch_page"),
    ("DELETE", "/pages/{page_id}", "delete_page"),
    ("POST", "/pages/{page_id}/restore", "restore_page"),
    ("GET", "/trash", "list_trash"),
    ("DELETE", "/trash", "empty_trash"),
    ("DELETE", "/trash/{page_id}", "purge_trash_entry"),
    ("POST", "/pages/{page_id}/duplicate", "duplicate_page"),
    ("GET", "/pages/{page_id}/history", "get_page_history"),
    (
        "GET",
        "/pages/{page_id}/history/{timestamp}",
        "get_page_version_content",
    ),
    (
        "POST",
        "/pages/{page_id}/history/restore/{timestamp}",
        "restore_page_version",
    ),
    ("DELETE", "/pages/{page_id}/history", "purge_page_history"),
)

TARGET_HANDLER_NAMES = frozenset(
    handler_name for _method, _path, handler_name in EXPECTED_ROUTE_FINGERPRINT
)


def _pages_history_trash_fingerprint() -> tuple[RouteFingerprint, ...]:
    fingerprint: list[RouteFingerprint] = []
    for route in vault_routes.router.routes:
        if not isinstance(route, APIRoute):
            continue
        handler_name = route.endpoint.__name__
        if handler_name not in TARGET_HANDLER_NAMES:
            continue
        fingerprint.extend((method, route.path, handler_name) for method in sorted(route.methods))
    return tuple(fingerprint)


def test_pages_history_trash_route_fingerprint_is_unchanged() -> None:
    actual = _pages_history_trash_fingerprint()

    assert len(actual) == 21
    assert actual == EXPECTED_ROUTE_FINGERPRINT
    assert json.dumps(actual, separators=(",", ":")) == json.dumps(
        EXPECTED_ROUTE_FINGERPRINT,
        separators=(",", ":"),
    )


def test_page_detail_route_exposes_its_typed_response_contract() -> None:
    route = next(
        route
        for route in vault_routes.router.routes
        if isinstance(route, APIRoute) and route.endpoint.__name__ == "get_page"
    )
    assert route.response_model is PageDetailResponse


def test_page_preview_routes_expose_typed_response_contracts() -> None:
    routes = {
        route.endpoint.__name__: route
        for route in vault_routes.router.routes
        if isinstance(route, APIRoute)
        and route.endpoint.__name__ in {"get_page_preview", "bulk_warm_previews"}
    }
    assert routes["get_page_preview"].response_model is PagePreviewResponse
    assert routes["bulk_warm_previews"].response_model is BulkPreviewWarmResponse


def test_page_mutation_routes_share_the_canonical_response_contract() -> None:
    routes = [
        route
        for route in vault_routes.router.routes
        if isinstance(route, APIRoute)
        and route.endpoint.__name__ in {"create_page", "save_page", "patch_page"}
    ]
    assert len(routes) == 3
    assert all(route.response_model is PageMutationResponse for route in routes)


def test_page_delete_route_exposes_its_typed_response_contract() -> None:
    route = next(
        route
        for route in vault_routes.router.routes
        if isinstance(route, APIRoute) and route.endpoint.__name__ == "delete_page"
    )
    assert route.response_model is PageDeleteResponse


def test_trash_purge_domain_does_not_import_http_facade() -> None:
    source_path = Path(trash_purge.__file__ or "")
    assert source_path.is_file()
    assert "backend.api.vault_routes" not in source_path.read_text(encoding="utf-8")
