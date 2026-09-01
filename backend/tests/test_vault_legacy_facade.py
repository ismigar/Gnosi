"""Compatibility surface frozen before the PR5 vault domain extraction."""

from __future__ import annotations

import inspect
from typing import get_args, get_type_hints

from fastapi.routing import APIRoute
from pydantic import BaseModel

from backend.api import vault_routes as legacy_vault
from backend.domains.vault.schemas import pages as page_schemas


PUBLIC_PAGE_MODEL_NAMES = (
    "PageSaveRequest",
    "PageInfo",
    "PagePatchRequest",
    "SidebarPageInfo",
    "TablePagesSnapshot",
)

LEGACY_HANDLER_NAMES = (
    "list_pages",
    "list_pages_by_table",
    "list_pages_by_table_snapshot",
    "get_indexer_status_endpoint",
    "list_sidebar_summary",
    "create_page",
    "get_page",
    "get_page_preview",
    "bulk_warm_previews",
    "save_page",
    "patch_page",
    "delete_page",
    "restore_page",
    "list_trash",
    "empty_trash",
    "purge_trash_entry",
    "duplicate_page",
    "get_page_history",
    "get_page_version_content",
    "restore_page_version",
    "purge_page_history",
)

PRODUCTION_HELPER_NAMES = (
    "get_p",
    "purge_vault_caches",
    "kickoff_index_warmup",
    "preload_page_index_from_disk",
    "_get_pages_snapshot",
    "_get_pages_for_table",
    "parse_frontmatter",
    "save_page_md",
    "find_page_path",
    "register_page_in_index",
    "_move_page_to_trash",
    "_remove_page_from_index_cache",
    "_purge_trash_entry",
    "purge_expired_trash",
    "_create_page_version",
    "_create_page_version_from_content",
    "_restore_page_from_trash",
    "_read_trash_entries",
    "_materialize_trash_sidecar",
    "_materialize_all_trash_sidecars",
    "_add_page_to_index_cache",
    "_refresh_page_index_entry",
    "_prepare_save_metadata",
    "_locate_save_file",
    "_read_save_page",
    "_write_save_page_with_version",
    "_find_and_read_patch_page",
    "_prepare_patch_metadata",
    "_relocate_patch_file",
    "_update_patch_caches",
    "_validate_history_timestamp",
    "_validate_safe_page_id",
    "get_page_index_cache_path",
    "get_indexer_status",
)

def _target_routes_by_handler() -> dict[str, APIRoute]:
    routes = [
        route
        for route in legacy_vault.router.routes
        if isinstance(route, APIRoute)
        and route.endpoint.__name__ in LEGACY_HANDLER_NAMES
    ]
    assert len(routes) == len(LEGACY_HANDLER_NAMES)
    return {route.endpoint.__name__: route for route in routes}


def test_legacy_facade_preserves_page_model_identity() -> None:
    for model_name in PUBLIC_PAGE_MODEL_NAMES:
        assert getattr(legacy_vault, model_name) is getattr(page_schemas, model_name)

    assert issubclass(legacy_vault._BulkWarmPayload, BaseModel)

    request_model_bindings = (
        ("create_page", "request", "PageSaveRequest"),
        ("save_page", "request", "PageSaveRequest"),
        ("patch_page", "request", "PagePatchRequest"),
        ("bulk_warm_previews", "payload", "_BulkWarmPayload"),
    )
    for handler_name, parameter_name, model_name in request_model_bindings:
        handler = getattr(legacy_vault, handler_name)
        assert parameter_name in inspect.signature(handler).parameters
        assert get_type_hints(handler)[parameter_name] is getattr(
            legacy_vault,
            model_name,
        )

    routes = _target_routes_by_handler()
    assert get_args(routes["list_pages"].response_model) == (legacy_vault.PageInfo,)
    assert get_args(routes["list_pages_by_table"].response_model) == (
        legacy_vault.PageInfo,
    )
    assert routes["list_pages_by_table_snapshot"].response_model is (
        legacy_vault.TablePagesSnapshot
    )
    assert get_args(routes["list_sidebar_summary"].response_model) == (
        legacy_vault.SidebarPageInfo,
    )


def test_legacy_facade_preserves_handler_identity_on_the_router() -> None:
    routes = _target_routes_by_handler()

    assert tuple(routes) == LEGACY_HANDLER_NAMES
    for handler_name in LEGACY_HANDLER_NAMES:
        handler = getattr(legacy_vault, handler_name)
        assert callable(handler)
        assert routes[handler_name].endpoint is handler


def test_legacy_facade_preserves_production_helper_exports() -> None:
    helper_exports = {
        helper_name: getattr(legacy_vault, helper_name)
        for helper_name in PRODUCTION_HELPER_NAMES
    }
    assert all(callable(helper) for helper in helper_exports.values())
