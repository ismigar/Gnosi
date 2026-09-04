"""Compatibility facade for the typed exact-clone domain."""

from __future__ import annotations

from typing import Any, Callable, Dict, List, Optional

from backend.domains.notion.clone import (
    SKIP_VIEW_TYPES,
    CloneAborted,
    _CLONE_NS,
    _LEADING_ICON_RE,
    _MARKER_RE,
    _apply_icon_cover,
    _child_page_ids,
    _clean,
    _clean_view_fields,
    _clone_workspace_with_dependencies,
    _icon_or_cover_url,
    block_file_url,
    build_clone_views,
    clone_page_id,
    clone_table_id,
    clone_table_schema,
    clone_values,
    re as re,
    resolve_view_markers,
    time as time,
    uuid as uuid,
)
from backend.domains.notion.clone_runtime import (
    CloneDependencies,
    CloneRestClient,
)
from backend.domains.notion.importer import (
    _emoji_icon as _emoji_icon,
    _page_title as _page_title,
    _plain_title as _plain_title,
    map_database_schema as map_database_schema,
    page_to_values as page_to_values,
)
from backend.domains.notion import view_recreator as nvr
from backend.utils.safe_io import sanitize_vault_title as sanitize_vault_title


def _compat_dependencies() -> CloneDependencies:
    """Resolve historical monkeypatch seams at call time."""
    return CloneDependencies(
        aborted_error=CloneAborted,
        apply_icon_cover=_apply_icon_cover,
        block_file_url=block_file_url,
        child_page_ids=_child_page_ids,
        clean_name=_clean,
        clone_page_id=clone_page_id,
        clone_table_id=clone_table_id,
        clone_table_schema=clone_table_schema,
        clone_values=clone_values,
        page_title=_page_title,
        page_to_values=page_to_values,
        plain_title=_plain_title,
        resolve_view_markers=resolve_view_markers,
        sanitize_title=sanitize_vault_title,
        strip_icon=nvr._strip_icon,
    )


def clone_workspace(
    rest_client: CloneRestClient,
    *,
    fetch_page: Callable[[str], str],
    mcp_to_markdown: Callable[[str], str],
    write_table: Callable[[Dict[str, object]], None],
    write_page: Callable[[Dict[str, object]], None],
    write_view: Callable[[Dict[str, object]], None],
    database_ids: List[str],
    target_folder: str = "Clon Notion",
    max_pages: int = 5000,
    schema_overrides: Optional[Dict[str, Dict[str, object]]] = None,
    save_asset: Optional[Callable[[str, Optional[str], Dict[str, object]], Optional[str]]] = None,
    loose_page_types: Optional[Dict[str, str]] = None,
    follow_subpages: bool = True,
    progress_cb: Optional[Callable[[str, int, int, Dict[str, object]], None]] = None,
    should_cancel: Optional[Callable[[], bool]] = None,
    registry_tables: Optional[List[Dict[str, object]]] = None,
) -> Dict[str, object]:
    return _clone_workspace_with_dependencies(
        rest_client,
        fetch_page=fetch_page,
        mcp_to_markdown=mcp_to_markdown,
        write_table=write_table,
        write_page=write_page,
        write_view=write_view,
        database_ids=database_ids,
        target_folder=target_folder,
        max_pages=max_pages,
        schema_overrides=schema_overrides,
        save_asset=save_asset,
        loose_page_types=loose_page_types,
        follow_subpages=follow_subpages,
        progress_cb=progress_cb,
        should_cancel=should_cancel,
        registry_tables=registry_tables,
        dependencies=_compat_dependencies(),
    )


__all__ = [
    "Any",
    "Callable",
    "Dict",
    "List",
    "Optional",
    "SKIP_VIEW_TYPES",
    "CloneAborted",
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
]
