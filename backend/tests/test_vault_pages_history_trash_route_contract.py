"""Frozen route fingerprint for the PR5 vault domain extraction."""

from __future__ import annotations

import json

from fastapi.routing import APIRoute

from backend.api import vault_routes


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
        fingerprint.extend(
            (method, route.path, handler_name) for method in sorted(route.methods)
        )
    return tuple(fingerprint)


def test_pages_history_trash_route_fingerprint_is_unchanged() -> None:
    actual = _pages_history_trash_fingerprint()

    assert len(actual) == 21
    assert actual == EXPECTED_ROUTE_FINGERPRINT
    assert json.dumps(actual, separators=(",", ":")) == json.dumps(
        EXPECTED_ROUTE_FINGERPRINT,
        separators=(",", ":"),
    )
