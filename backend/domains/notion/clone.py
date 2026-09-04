"""Typed exact-clone domain for Notion → Gnosi."""

from __future__ import annotations

import re as re
import time as time
import uuid as uuid
from typing import Callable, Dict, List, Optional

from backend.domains.notion import view_recreator as nvr
from backend.domains.notion.clone_runtime import (
    CloneDependencies,
    CloneRestClient,
    CloneRuntime,
    JsonMap,
    ProgressCallback,
    SaveAsset,
    run_clone_workspace,
)
from backend.domains.notion.importer import (
    _emoji_icon,
    _page_title,
    _plain_title,
    map_database_schema,
    page_to_values,
)
from backend.utils.safe_io import sanitize_vault_title

_CLONE_NS = uuid.UUID("6f0c9b2e-1a4d-5e6f-8a9b-000000000003")
_MARKER_RE = re.compile(r"<!--\s*gnosi-notion-db:([0-9a-f]{32})\s*-->")


class CloneAborted(Exception):
    """The user requested cooperative cancellation between clone passes."""


def clone_table_id(notion_db_id: str) -> str:
    return str(uuid.uuid5(_CLONE_NS, "table:" + str(notion_db_id or "").replace("-", "")))


def clone_page_id(notion_page_id: str) -> str:
    return str(uuid.uuid5(_CLONE_NS, "page:" + str(notion_page_id or "").replace("-", "")))


_LEADING_ICON_RE = re.compile(r"^[\s\U0001F000-\U0001FAFF☀-➿←-⇿⬀-⯿️‍⃣™ℹ]+")


def _map_list(value: object) -> List[Dict[str, object]]:
    return [item for item in value if isinstance(item, dict)] if isinstance(value, list) else []


def _value_list(value: object) -> List[object]:
    return value if isinstance(value, list) else []


def _clean(name: object) -> object:
    """Remove only a decorative field-name prefix, preserving accents and case."""
    if not isinstance(name, str) or not name:
        return name
    return _LEADING_ICON_RE.sub("", name).strip() or name


def _child_page_ids(blocks: object) -> List[str]:
    """Return nested child-page IDs without descending into the child pages themselves."""
    out: List[str] = []
    for block in _map_list(blocks):
        if block.get("type") == "child_page" and block.get("id"):
            out.append(str(block["id"]))
            continue
        out.extend(_child_page_ids(block.get("_children")))
    return out


def block_file_url(block: Dict[str, object]) -> Optional[str]:
    """Return the fresh URL carried by a Notion media block."""
    if not isinstance(block, dict):
        return None
    payload_raw = block.get(str(block.get("type") or ""))
    payload = payload_raw if isinstance(payload_raw, dict) else {}
    inner_raw = payload.get(str(payload.get("type") or ""))
    inner = inner_raw if isinstance(inner_raw, dict) else {}
    url = inner.get("url") or payload.get("url")
    return str(url) if isinstance(url, str) and url.strip() else None


def _icon_or_cover_url(obj: object) -> Optional[str]:
    if not isinstance(obj, dict):
        return None
    kind = obj.get("type")
    payload = obj.get(str(kind or ""))
    if kind not in ("external", "file") or not isinstance(payload, dict):
        return None
    url = payload.get("url")
    return str(url) if isinstance(url, str) else None


def _apply_icon_cover(
    meta: Dict[str, object],
    page: Dict[str, object],
    table: Dict[str, object],
    save_asset: Optional[SaveAsset],
) -> int:
    """Store an emoji or local icon/cover and return the download count."""
    downloaded = 0
    emoji = _emoji_icon(page.get("icon"))
    if emoji:
        meta["icon"] = emoji
    elif save_asset is not None:
        icon_url = _icon_or_cover_url(page.get("icon"))
        local_icon = save_asset(icon_url, "_icones", table) if icon_url else None
        if local_icon:
            meta["icon"] = local_icon
            downloaded += 1
    if save_asset is not None:
        cover_url = _icon_or_cover_url(page.get("cover"))
        local_cover = save_asset(cover_url, "_portades", table) if cover_url else None
        if local_cover:
            meta["cover"] = local_cover
            downloaded += 1
    return downloaded


def clone_table_schema(notion_db: Dict[str, object]) -> Dict[str, object]:
    """Clone a table schema with namespaced IDs and clean field names."""
    table = dict(map_database_schema(notion_db))
    table["id"] = clone_table_id(str(notion_db.get("id") or ""))
    table["schema_source"] = {
        "provider": "notion",
        "database_id": str(notion_db.get("id") or ""),
        "mode": "exact_clone",
    }
    for prop in _map_list(table.get("properties")):
        prop["name"] = _clean(prop.get("name"))
        target = prop.get("relation_database_id")
        if prop.get("type") == "relation" and target:
            prop["relation_database_id"] = clone_table_id(str(target))
    return table


def clone_values(values: Dict[str, object], schema: List[Dict[str, object]]) -> Dict[str, object]:
    """Keep effective-schema values and remap relations to clone page IDs."""
    by_clean = {str(prop.get("name") or ""): prop for prop in schema or []}
    out: Dict[str, object] = {}
    for key, value in values.items():
        clean_key = str(_clean(key) or key)
        field = by_clean.get(clean_key)
        if field is None:
            continue
        if field.get("type") == "relation" and isinstance(value, list):
            out[clean_key] = [clone_page_id(str(item)) for item in value if item]
        else:
            out[clean_key] = value
    return out


def _clean_view_fields(view: Dict[str, object]) -> Dict[str, object]:
    view["visibleProperties"] = [
        _clean(item) for item in _value_list(view.get("visibleProperties"))
    ]
    for item in _map_list(view.get("filters")):
        if item.get("field"):
            item["field"] = _clean(item["field"])
    for item in _map_list(view.get("sorts")):
        if item.get("field"):
            item["field"] = _clean(item["field"])
    for key in ("groupBy", "xField", "yField", "dateField", "endDateField"):
        if view.get(key):
            view[key] = _clean(view[key])
    return view


SKIP_VIEW_TYPES = ("chart",)


def build_clone_views(
    notion_host_page_id: str,
    clone_host_table_id: str,
    view_block_id: str,
    view_md: str,
    resolve_clone_table: Callable[[str], Optional[Dict[str, object]]],
    skip_types: tuple[str, ...] = SKIP_VIEW_TYPES,
) -> List[Dict[str, object]]:
    """Build every real tab of one cloned Notion database block."""
    out: List[Dict[str, object]] = []
    for index, meta in enumerate(nvr.parse_mcp_views(view_md or "")):
        if meta.get("view_type") in (skip_types or ()):
            continue
        table = resolve_clone_table(str(meta.get("data_source_name") or ""))
        if not table:
            continue
        name = meta.get("name") or meta.get("data_source_name") or table.get("name") or "Vista"
        view = nvr.build_gnosi_view(
            notion_host_page_id, table, clone_host_table_id, meta, str(name)
        )
        seed = f"view:{notion_host_page_id}:{view_block_id}"
        if index:
            seed += f":{meta.get('view_url') or index}"
        view["id"] = str(uuid.uuid5(_CLONE_NS, seed))
        out.append(_clean_view_fields(view))
    if out:
        out[0]["tabs"] = [view["id"] for view in out[1:]]
    return out


def resolve_view_markers(
    body_md: str,
    notion_host_page_id: str,
    clone_host_table_id: str,
    *,
    fetch_view: Callable[[str], str],
    resolve_clone_table: Callable[[str], Optional[Dict[str, object]]],
) -> tuple[str, List[Dict[str, object]]]:
    """Replace Notion database markers with cloned anchor-view embeds."""
    views: List[Dict[str, object]] = []

    def replace(match: re.Match[str]) -> str:
        view_id = match.group(1)
        try:
            cloned = build_clone_views(
                notion_host_page_id,
                clone_host_table_id,
                view_id,
                fetch_view(view_id),
                resolve_clone_table,
            )
            if not cloned:
                return ""
            views.extend(cloned)
            return str(nvr.view_embed(str(cloned[0]["id"])))
        except Exception:  # noqa: BLE001
            return ""

    return _MARKER_RE.sub(replace, body_md), views


def _dependencies() -> CloneDependencies:
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


def _clone_workspace_with_dependencies(
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
    save_asset: Optional[SaveAsset] = None,
    loose_page_types: Optional[Dict[str, str]] = None,
    follow_subpages: bool = True,
    progress_cb: Optional[ProgressCallback] = None,
    should_cancel: Optional[Callable[[], bool]] = None,
    registry_tables: Optional[List[Dict[str, object]]] = None,
    dependencies: CloneDependencies,
) -> Dict[str, object]:
    runtime = CloneRuntime(
        rest_client=rest_client,
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
        dependencies=dependencies,
    )
    return run_clone_workspace(runtime)


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
    """Clone selected databases and standalone pages in the historical phase order."""
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
        dependencies=_dependencies(),
    )
