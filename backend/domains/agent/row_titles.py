"""Use the table's visible title field for confirmed row edits."""
from __future__ import annotations

from pathlib import Path
from typing import Any, cast

from backend.domains.vault.pages.index_entries import humanize_relation_index_title
from backend.services.field_resolver import to_response_names


def row_title_state(metadata: dict[str, Any], path: Path) -> tuple[str, dict[str, Any]]:
    """Match native page/index name precedence, including renamed title fields."""
    from backend.domains.agent.gnosi_support import _table

    table_id = str(metadata.get('table_id') or metadata.get('database_table_id') or '')
    table = (_table(table_id) if table_id else None) or {}
    named = to_response_names(metadata, table)
    field: dict[str, Any] = next((field for field in (table.get('properties') or [])
                  if field.get('type') == 'title' and field.get('name')), {})
    binding: dict[str, Any] = {key: field[key] for key in ('id', 'name', 'aliases') if key in field}
    title = named.get(field.get('name')) if field else None
    if title is None:
        title = metadata.get('title') or path.stem
    return humanize_relation_index_title(title, cast(dict[object, object], metadata)), binding


def apply_row_title(metadata: dict[str, Any], title: Any, binding: dict[str, Any]) -> None:
    """Keep the visible name and canonical fallback in agreement before save.

    The native writer persists current names and removes resolved ID/alias keys.
    Setting the current name wins over stale copies under those older keys.
    """
    metadata['title'] = title
    if binding.get('name'):
        metadata[binding['name']] = title
