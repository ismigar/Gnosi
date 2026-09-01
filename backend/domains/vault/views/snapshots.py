"""Materialized Markdown snapshots for saved table views."""

from __future__ import annotations

import logging
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

from backend.domains.vault.registry.records import is_object_list, is_record
from backend.domains.vault.registry.state import RegistryData
from backend.domains.vault.schemas.pages import PageInfo
from backend.utils.open_values import iterable_values


ViewRows = list[RegistryData]
SnapshotTable = RegistryData
PageDocument = tuple[Path, RegistryData, str, bool]


class RematerializeMarkdown(Protocol):
    def __call__(
        self,
        markdown: str,
        page_id: str,
        *,
        resolve_ids: Callable[[str, object], list[str]],
        id_to_title: Callable[[str], str | None],
        config_for: Callable[[str], RegistryData],
        resolve_table: Callable[[str, object], SnapshotTable | None],
    ) -> str: ...


@dataclass(frozen=True)
class SnapshotDependencies:
    pages_for_table: Callable[[str], list[PageInfo]]
    table_by_id: Callable[[str], RegistryData | None]
    inject_virtual_fields: Callable[
        [RegistryData | None, list[PageInfo], Callable[[str], list[PageInfo]]],
        object,
    ]
    virtual_page_loader: Callable[[str], list[PageInfo]]
    response_names: Callable[[object, RegistryData], RegistryData]
    load_registry: Callable[[], RegistryData]
    apply_joins: Callable[[ViewRows, list[object], Callable[[str], ViewRows]], ViewRows]
    resolve_row_ids: Callable[[ViewRows, RegistryData, object], list[str]]
    resolve_rows: Callable[[ViewRows, RegistryData, object], ViewRows]
    decorate_relation: Callable[[str], str]
    link_title: Callable[[str], str | None]
    default_limit: int
    documents: Callable[[], Iterable[PageDocument]]
    resolve_page_id: Callable[[RegistryData, Path], str | None]
    rematerialize: RematerializeMarkdown
    write_text: Callable[[Path, str], object]
    logger: logging.Logger


def _registry_items(registry: RegistryData, key: str) -> list[RegistryData]:
    raw_items = registry.get(key, [])
    return [item for item in iterable_values(raw_items) if is_record(item)]


def load_table_rows(
    table_id: str,
    dependencies: SnapshotDependencies,
) -> ViewRows:
    """Load non-template rows using response-facing property names."""
    if not table_id:
        return []
    pages = dependencies.pages_for_table(table_id)
    table = dependencies.table_by_id(table_id)
    try:
        dependencies.inject_virtual_fields(
            table,
            pages,
            dependencies.virtual_page_loader,
        )
    except Exception as error:
        dependencies.logger.debug("virtual fields injection (table %s) failed: %s", table_id, error)
    rows: ViewRows = []
    for page in pages:
        metadata = page.metadata or {}
        if metadata.get("is_template"):
            continue
        response_metadata = (
            dependencies.response_names(dict(metadata), table) if table else dict(metadata)
        )
        rows.append({"id": page.id, "title": page.title, "metadata": response_metadata})
    return rows


def resolve_view_and_candidates(
    view_id: str,
    host_page_id: object,
    dependencies: SnapshotDependencies,
) -> tuple[RegistryData | None, ViewRows]:
    """Resolve one saved view and its joined candidate rows."""
    del host_page_id
    normalized_view_id = str(view_id or "").strip()
    if not normalized_view_id:
        return None, []
    registry = dependencies.load_registry()
    view = next(
        (
            item
            for item in _registry_items(registry, "views")
            if str(item.get("id")) == normalized_view_id
        ),
        None,
    )
    if not view:
        return None, []
    table_id = str(view.get("table_id") or "")
    if not table_id:
        return view, []
    rows = load_table_rows(table_id, dependencies)
    raw_joins = view.get("joins")
    if is_object_list(raw_joins) and raw_joins:
        try:
            rows = dependencies.apply_joins(
                rows,
                raw_joins,
                lambda joined_table_id: load_table_rows(joined_table_id, dependencies),
            )
        except Exception as error:
            dependencies.logger.debug("apply_joins (view %s) failed: %s", normalized_view_id, error)
    return view, rows


def resolve_view_row_ids(
    view_id: str,
    host_page_id: object,
    dependencies: SnapshotDependencies,
) -> list[str]:
    """Return the ordered page IDs produced by one view."""
    try:
        view, rows = resolve_view_and_candidates(view_id, host_page_id, dependencies)
        if not view:
            return []
        return dependencies.resolve_row_ids(rows, view, host_page_id)
    except Exception as error:
        dependencies.logger.debug("_resolve_view_row_ids(%s) ha fallat: %s", view_id, error)
        return []


def format_snapshot_cell(
    value: object,
    field_type: str | None,
    dependencies: SnapshotDependencies,
) -> str:
    """Format one persisted value for a Markdown table cell."""
    if value is None or value == "":
        return ""
    if field_type == "relation":
        values = value if is_object_list(value) else [value]
        return ", ".join(
            dependencies.decorate_relation(str(item)) for item in values if item not in (None, "")
        )
    if is_object_list(value):
        return ", ".join(str(item) for item in value if item not in (None, ""))
    if is_record(value):
        return str(value.get("src") or value.get("title") or value.get("name") or "")
    rendered = str(value)
    return rendered[:200] + "…" if len(rendered) > 200 else rendered


def normalize_visible_properties(
    visible: object,
    base_table_id: str | None,
) -> list[RegistryData]:
    """Normalize visible-property strings and qualified property objects."""
    fallback: RegistryData = {
        "tableId": base_table_id,
        "fieldKey": "title",
    }
    if not visible or not is_object_list(visible):
        return [fallback]
    output: list[RegistryData] = []
    for entry in visible:
        if isinstance(entry, str):
            output.append({"tableId": base_table_id, "fieldKey": entry})
        elif is_record(entry) and entry.get("fieldKey"):
            output.append(
                {
                    "tableId": entry.get("tableId") or base_table_id,
                    "fieldKey": entry.get("fieldKey"),
                    "label": entry.get("label"),
                }
            )
    return output or [fallback]


def _property_types(table: RegistryData | None) -> tuple[str | None, dict[str, str]]:
    properties = _registry_items(table or {}, "properties")
    title_field = next(
        (
            str(prop.get("name"))
            for prop in properties
            if prop.get("type") == "title" and prop.get("name")
        ),
        None,
    )
    type_by_name = {
        str(prop["name"]): str(prop.get("type") or "") for prop in properties if prop.get("name")
    }
    return title_field, type_by_name


def _non_title_columns(
    view: RegistryData,
    base_table_id: str | None,
    title_field: str | None,
    type_by_name: dict[str, str],
) -> list[RegistryData]:
    visible = view.get("visibleProperties") or view.get("visible_properties") or ["title"]
    columns = normalize_visible_properties(visible, base_table_id)

    def is_title_reference(key: object) -> bool:
        return (
            key == "title"
            or bool(title_field and key == title_field)
            or type_by_name.get(str(key)) == "title"
        )

    return [
        column
        for column in columns
        if not (
            column.get("tableId") == base_table_id and is_title_reference(column.get("fieldKey"))
        )
    ]


def _snapshot_headers(
    columns: list[RegistryData],
    base_table_id: str | None,
    title_field: str | None,
    dependencies: SnapshotDependencies,
) -> list[str]:
    table_names = _snapshot_table_names(columns, dependencies)
    headers = [title_field or "Títol"]
    for column in columns:
        headers.append(_snapshot_column_header(column, columns, base_table_id, table_names))
    return headers


def _snapshot_table_names(
    columns: list[RegistryData],
    dependencies: SnapshotDependencies,
) -> dict[str, str]:
    table_names: dict[str, str] = {}
    for column in columns:
        table_id = str(column.get("tableId") or "")
        if table_id and table_id not in table_names:
            table = dependencies.table_by_id(table_id)
            table_names[table_id] = str((table or {}).get("name") or table_id)
    return table_names


def _snapshot_column_header(
    column: RegistryData,
    columns: list[RegistryData],
    base_table_id: str | None,
    table_names: dict[str, str],
) -> str:
    label = column.get("label")
    if label:
        return str(label)
    table_id = str(column.get("tableId") or "")
    field_key = str(column.get("fieldKey") or "")
    same_key_count = sum(item.get("fieldKey") == field_key for item in columns)
    if table_id and table_id != base_table_id and same_key_count > 1:
        return f"{table_names.get(table_id, table_id)} · {field_key}"
    return field_key


def _snapshot_rows(
    rows: ViewRows,
    view: RegistryData,
    host_page_id: object,
    base_table_id: str | None,
    columns: list[RegistryData],
    type_by_name: dict[str, str],
    dependencies: SnapshotDependencies,
) -> list[list[str]]:
    output: list[list[str]] = []
    for row in dependencies.resolve_rows(rows, view, host_page_id):
        cells = [dependencies.decorate_relation(str(row.get("id")))]
        raw_metadata = row.get("metadata") or {}
        metadata = raw_metadata if is_record(raw_metadata) else {}
        for column in columns:
            table_id = str(column.get("tableId") or "")
            field_key = str(column.get("fieldKey") or "")
            if not table_id or table_id == base_table_id:
                cells.append(
                    format_snapshot_cell(
                        metadata.get(field_key),
                        type_by_name.get(field_key),
                        dependencies,
                    )
                )
                continue
            raw_joined = metadata.get(f"_join:{table_id}") or []
            joined = raw_joined if is_object_list(raw_joined) else []
            first = joined[0] if joined and is_record(joined[0]) else {}
            cells.append(format_snapshot_cell(first.get(field_key), None, dependencies))
        output.append(cells)
    return output


def resolve_view_table(
    view_id: str,
    host_page_id: object,
    dependencies: SnapshotDependencies,
) -> SnapshotTable | None:
    """Resolve a table/list view into headers and concrete Markdown rows."""
    try:
        view, rows = resolve_view_and_candidates(view_id, host_page_id, dependencies)
        if not view or str(view.get("type") or "table").lower() not in (
            "table",
            "list",
        ):
            return None
        base_table_id = str(view.get("table_id") or "") or None
        table = dependencies.table_by_id(base_table_id) if base_table_id else None
        title_field, type_by_name = _property_types(table)
        columns = _non_title_columns(view, base_table_id, title_field, type_by_name)
        return {
            "headers": _snapshot_headers(
                columns,
                base_table_id,
                title_field,
                dependencies,
            ),
            "rows": _snapshot_rows(
                rows,
                view,
                host_page_id,
                base_table_id,
                columns,
                type_by_name,
                dependencies,
            ),
        }
    except Exception as error:
        dependencies.logger.debug("_resolve_view_table(%s) ha fallat: %s", view_id, error)
        return None


def view_snapshot_config(
    view_id: str,
    dependencies: SnapshotDependencies,
) -> RegistryData:
    """Return persisted materialization settings for one view."""
    try:
        registry = dependencies.load_registry()
        view = next(
            (
                item
                for item in _registry_items(registry, "views")
                if str(item.get("id")) == str(view_id)
            ),
            {},
        )
        enabled: object = view.get("resultSnapshot", True)
        if isinstance(enabled, str):
            enabled = enabled.strip().lower() not in ("false", "0", "no", "")
        raw_limit = view.get("resultSnapshotLimit", dependencies.default_limit)
        try:
            limit = (
                int(raw_limit)
                if isinstance(raw_limit, (str, int, float))
                else dependencies.default_limit
            )
        except (TypeError, ValueError):
            limit = dependencies.default_limit
        return {"enabled": bool(enabled), "limit": limit}
    except Exception:
        return {"enabled": True, "limit": dependencies.default_limit}


def refresh_view_snapshots(
    dry_run: bool,
    dependencies: SnapshotDependencies,
) -> RegistryData:
    """Materialize every embedded view snapshot without touching frontmatter."""
    scanned = 0
    changed = 0
    errors = 0
    changed_pages: list[str] = []
    try:
        documents = dependencies.documents()
    except Exception as error:
        dependencies.logger.warning("refresh_view_snapshots: could not list the vault: %s", error)
        return {
            "ok": False,
            "error": str(error),
            "scanned": 0,
            "changed": 0,
            "errors": 1,
        }
    for file_path, metadata, _body, is_dashboard in documents:
        if is_dashboard:
            continue
        try:
            raw = file_path.read_text(encoding="utf-8")
        except Exception:
            errors += 1
            continue
        if "gnosi-view" not in raw:
            continue
        scanned += 1
        try:
            page_id = str(
                metadata.get("id") or dependencies.resolve_page_id(metadata, file_path) or ""
            )
            new_raw = dependencies.rematerialize(
                raw,
                page_id,
                resolve_ids=lambda view_id, host_id: resolve_view_row_ids(
                    view_id, host_id, dependencies
                ),
                id_to_title=dependencies.link_title,
                config_for=lambda view_id: view_snapshot_config(view_id, dependencies),
                resolve_table=lambda view_id, host_id: resolve_view_table(
                    view_id, host_id, dependencies
                ),
            )
            if new_raw != raw:
                changed += 1
                if len(changed_pages) < 50:
                    changed_pages.append(str(file_path))
                if not dry_run:
                    dependencies.write_text(file_path, new_raw)
        except Exception as error:
            errors += 1
            dependencies.logger.warning(
                "refresh_view_snapshots: error a %s: %s", file_path.name, error
            )
    dependencies.logger.info(
        "refresh_view_snapshots: scanned=%s changed=%s errors=%s dry_run=%s",
        scanned,
        changed,
        errors,
        dry_run,
    )
    return {
        "ok": True,
        "dry_run": dry_run,
        "scanned": scanned,
        "changed": changed,
        "errors": errors,
        "changed_pages": changed_pages,
    }


__all__ = [
    "SnapshotDependencies",
    "format_snapshot_cell",
    "load_table_rows",
    "normalize_visible_properties",
    "refresh_view_snapshots",
    "resolve_view_and_candidates",
    "resolve_view_row_ids",
    "resolve_view_table",
    "view_snapshot_config",
]
