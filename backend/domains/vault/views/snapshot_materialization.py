"""Idempotent materialization of saved-view results into Markdown."""

from __future__ import annotations

import json
from typing import TypeVar, cast

from backend.domains.vault.views.runtime_types import (
    DecorateItem,
    ResolveIds,
    ResolveTable,
    ResolveTitle,
    SnapshotConfig,
)
from backend.domains.vault.views.snapshot_markup import (
    DEFAULT_MAX_ITEMS,
    FENCE_RE,
    FRONTMATTER_RE,
    build_list_block,
    build_table_block,
    compact_view_fences,
    restore_view_fences,
    strip_view_snapshots,
)

Item = TypeVar("Item")


def _view_id(raw_json: str) -> str:
    try:
        payload = json.loads(raw_json)
    except Exception:
        return ""
    return str(payload.get("view_id") or "") if isinstance(payload, dict) else ""


def _view_config(
    view_id: str,
    config_for: SnapshotConfig | None,
    default_limit: int,
) -> tuple[bool, object]:
    if config_for is None:
        return True, default_limit
    try:
        config = config_for(view_id) or {}
        enabled = config.get("enabled", True)
        limit = config.get("limit") if config.get("limit") is not None else default_limit
        return bool(enabled), limit
    except Exception:
        return True, default_limit


def _truncate(values: list[Item], limit: object) -> tuple[list[Item], int]:
    if not isinstance(limit, (int, float)) or limit <= 0 or len(values) <= limit:
        return values, 0
    boundary = int(limit)
    return values[:boundary], len(values) - boundary


def _table_snapshot(
    view_id: str,
    host_page_id: str | None,
    limit: object,
    resolve_table: ResolveTable | None,
) -> str | None:
    if resolve_table is None:
        return None
    try:
        table = resolve_table(view_id, host_page_id)
    except Exception:
        return None
    if not table or not table.get("headers") or not table.get("rows"):
        return None
    raw_rows = table["rows"]
    raw_headers = table["headers"]
    if not isinstance(raw_rows, list) or not isinstance(raw_headers, list):
        return None
    rows, truncated = _truncate(raw_rows, limit)
    if not rows:
        return None
    headers = [str(header) for header in raw_headers]
    typed_rows = [row for row in rows if isinstance(row, (list, tuple))]
    return build_table_block(view_id, headers, typed_rows, truncated) if typed_rows else None


def _list_snapshot(
    view_id: str,
    host_page_id: str | None,
    limit: object,
    resolve_ids: ResolveIds,
    id_to_title: ResolveTitle | None,
    decorate_item: DecorateItem,
) -> str | None:
    try:
        identifiers = resolve_ids(view_id, host_page_id) or []
    except Exception:
        identifiers = []
    if not identifiers:
        return None
    identifiers, truncated = _truncate(identifiers, limit)
    items = [decorate_item(identifier, id_to_title, None) for identifier in identifiers]
    items = [item for item in items if isinstance(item, str) and item.strip()]
    return build_list_block(view_id, items, truncated) if items else None


def inject_view_snapshots(
    body: object,
    resolve_ids: ResolveIds,
    id_to_title: ResolveTitle | None = None,
    host_page_id: str | None = None,
    max_items: int = DEFAULT_MAX_ITEMS,
    config_for: SnapshotConfig | None = None,
    resolve_table: ResolveTable | None = None,
    *,
    decorate_item: DecorateItem,
) -> object:
    """Materialize each enabled view as a table or wikilink list."""
    if not isinstance(body, str) or "```gnosi-view" not in body:
        return body
    try:
        clean_value = strip_view_snapshots(body)
        clean = cast(str, clean_value)
        output: list[str] = []
        last = 0
        for match in FENCE_RE.finditer(clean):
            output.append(clean[last : match.end()])
            last = match.end()
            view_id = _view_id(match.group("json"))
            if not view_id:
                continue
            enabled, limit = _view_config(view_id, config_for, max_items)
            if not enabled:
                continue
            block = _table_snapshot(view_id, host_page_id, limit, resolve_table)
            if block is None:
                block = _list_snapshot(
                    view_id,
                    host_page_id,
                    limit,
                    resolve_ids,
                    id_to_title,
                    decorate_item,
                )
            if block is not None:
                output.append(f"\n\n{block}")
        output.append(clean[last:])
        return "".join(output)
    except Exception:
        return body


def rematerialize_md(
    raw: object,
    host_page_id: str | None,
    resolve_ids: ResolveIds,
    id_to_title: ResolveTitle | None = None,
    config_for: SnapshotConfig | None = None,
    resolve_table: ResolveTable | None = None,
    *,
    decorate_item: DecorateItem,
) -> object:
    """Refresh snapshot regions while preserving frontmatter bytes."""
    if not isinstance(raw, str) or "gnosi-view" not in raw:
        return raw
    match = FRONTMATTER_RE.match(raw)
    boundary = match.end() if match else 0
    prefix = raw[:boundary]
    body: object = raw[boundary:]
    body = restore_view_fences(body)
    body = strip_view_snapshots(body)
    body = inject_view_snapshots(
        body,
        resolve_ids,
        id_to_title=id_to_title,
        host_page_id=host_page_id,
        config_for=config_for,
        resolve_table=resolve_table,
        decorate_item=decorate_item,
    )
    body = compact_view_fences(body)
    return prefix + cast(str, body)


__all__ = ["inject_view_snapshots", "rematerialize_md"]
