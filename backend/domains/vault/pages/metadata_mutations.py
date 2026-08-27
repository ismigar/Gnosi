"""Bulk metadata mutations for Vault pages and table templates."""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from contextlib import AbstractContextManager
from dataclasses import dataclass
from pathlib import Path
from typing import Literal, TypedDict, cast

from fastapi import HTTPException

from backend.domains.vault.schemas.pages import PageInfo


Metadata = dict[str, object]
MutationStatus = Literal["ok", "skip", "conflict", "error"]
MutationResult = tuple[MutationStatus, object]
PropertyKeys = tuple[list[str], str]


class EtagResult(TypedDict):
    page_id: str
    etag: object


@dataclass(frozen=True)
class MetadataMutationDependencies:
    """Registry, page I/O, locking, and cache ports used by mutations."""

    registry_mutation: Callable[[], AbstractContextManager[None]]
    load_registry: Callable[[], Metadata]
    save_registry: Callable[[Metadata], None]
    new_id: Callable[[], str]
    page_snapshot: Callable[[], list[PageInfo]]
    find_page: Callable[[str], Path | None]
    parse_frontmatter: Callable[[str, Path], tuple[Metadata, str]]
    save_page: Callable[[Path, Metadata, str], None]
    file_etag: Callable[[Path], str | None]
    refresh_page_index: Callable[[Path, Metadata, str], None]
    invalidate_citation_index: Callable[[], None]
    invalidate_page_cache: Callable[[], None]
    table_id: Callable[[Metadata], str]
    table_by_id: Callable[[str], Metadata | None]
    page_write_lock: Callable[[str], Awaitable[asyncio.Lock]]


def _mapping(value: object) -> Metadata:
    return cast(Metadata, value) if isinstance(value, dict) else {}


def _string(value: object) -> str:
    return cast(str, value or "").strip()


def _etag_map(payload: Metadata) -> Metadata:
    return _mapping(payload.get("expected_etags") or {})


def _result_collections() -> tuple[
    list[EtagResult],
    list[str],
    list[Metadata],
    list[Metadata],
]:
    return [], [], [], []


def _record_result(
    page_id: str,
    result: MutationResult,
    changed: list[EtagResult],
    skipped: list[str],
    conflicts: list[Metadata],
    errors: list[Metadata],
) -> None:
    status, info = result
    if status == "ok":
        changed.append({"page_id": page_id, "etag": info})
    elif status == "skip":
        skipped.append(page_id)
    elif status == "conflict":
        conflicts.append({"page_id": page_id, **_mapping(info)})
    else:
        errors.append({"page_id": page_id, "error": info})


def _etag_conflict(
    page_id: str,
    page_path: Path,
    expected_etags: Metadata,
    dependencies: MetadataMutationDependencies,
) -> MutationResult | None:
    expected = expected_etags.get(page_id)
    if not expected:
        return None
    current = dependencies.file_etag(page_path)
    if current and current != expected:
        return (
            "conflict",
            {"expected_etag": expected, "current_etag": current},
        )
    return None


def _find_table(registry: Metadata, table_id: str) -> Metadata | None:
    tables = registry.get("tables")
    if not isinstance(tables, list):
        return None
    for raw_table in tables:
        table = _mapping(raw_table)
        if table.get("id") == table_id:
            return table
    return None


def _ensure_column(
    table_id: str,
    column_name: str,
    column_type: str,
    dependencies: MetadataMutationDependencies,
) -> tuple[Metadata, bool]:
    with dependencies.registry_mutation():
        registry = dependencies.load_registry()
        table = _find_table(registry, table_id)
        if table is None:
            raise HTTPException(status_code=404, detail=f"Table {table_id} no trobada")
        raw_properties = table.setdefault("properties", [])
        properties = cast(list[object], raw_properties) if isinstance(raw_properties, list) else []
        existing = next(
            (
                prop
                for item in properties
                if (prop := _mapping(item)) and _string(prop.get("name")) == column_name
            ),
            None,
        )
        if existing is not None:
            return existing, False
        new_property: Metadata = {
            "id": dependencies.new_id(),
            "name": column_name,
            "type": column_type,
        }
        properties.append(new_property)
        table["properties"] = properties
        dependencies.save_registry(registry)
        return new_property, True


def _candidate_extra_pages(
    table_id: str,
    zotero_field: str,
    requested: object,
    dependencies: MetadataMutationDependencies,
) -> list[str]:
    if isinstance(requested, list) and requested:
        return [str(page_id) for page_id in requested]
    candidate_ids: list[str] = []
    for page in dependencies.page_snapshot():
        if page.resolved_table_id != table_id:
            continue
        try:
            page_path = dependencies.find_page(page.id)
            if not page_path:
                continue
            metadata, _body = dependencies.parse_frontmatter(
                page_path.read_text(encoding="utf-8"),
                page_path,
            )
            extras = metadata.get("Zotero Extras")
            if isinstance(extras, dict) and zotero_field in extras:
                candidate_ids.append(page.id)
        except OSError:
            continue
    return candidate_ids


def _promote_one_extra(
    page_id: str,
    zotero_field: str,
    column_name: str,
    expected_etags: Metadata,
    dependencies: MetadataMutationDependencies,
) -> MutationResult:
    page_path = dependencies.find_page(page_id)
    if not page_path or not page_path.exists():
        return "error", "not_found"
    conflict = _etag_conflict(page_id, page_path, expected_etags, dependencies)
    if conflict:
        return conflict
    try:
        metadata, body = dependencies.parse_frontmatter(
            page_path.read_text(encoding="utf-8"),
            page_path,
        )
        extras = metadata.get("Zotero Extras")
        if not isinstance(extras, dict) or zotero_field not in extras:
            return "skip", None
        value = extras.pop(zotero_field)
        if extras:
            metadata["Zotero Extras"] = extras
        else:
            metadata.pop("Zotero Extras", None)
        metadata[column_name] = value
        dependencies.save_page(page_path, metadata, body or "")
        dependencies.refresh_page_index(page_path, metadata, body or "")
        return "ok", dependencies.file_etag(page_path)
    except (OSError, ValueError) as error:
        return "error", str(error)


async def promote_zotero_extra(
    payload: Metadata,
    dependencies: MetadataMutationDependencies,
) -> Metadata:
    """Promote one Zotero Extras field into a declared table column."""
    table_id = _string(payload.get("table_id"))
    zotero_field = _string(payload.get("zotero_field"))
    column_name = _string(payload.get("column_name") or zotero_field)
    column_type = _string(payload.get("column_type") or "text")
    if not table_id or not zotero_field:
        raise HTTPException(status_code=400, detail="table_id i zotero_field són obligatoris")
    column, column_created = _ensure_column(
        table_id,
        column_name,
        column_type,
        dependencies,
    )
    candidate_ids = _candidate_extra_pages(
        table_id,
        zotero_field,
        payload.get("page_ids"),
        dependencies,
    )
    expected_etags = _etag_map(payload)
    migrated, skipped, conflicts, errors = _result_collections()
    for page_id in candidate_ids:
        result = await asyncio.to_thread(
            _promote_one_extra,
            page_id,
            zotero_field,
            column_name,
            expected_etags,
            dependencies,
        )
        _record_result(page_id, result, migrated, skipped, conflicts, errors)
    if migrated:
        dependencies.invalidate_citation_index()
        dependencies.invalidate_page_cache()
    return {
        "column_created": column_created,
        "column_id": column.get("id"),
        "column_name": column_name,
        "migrated": len(migrated),
        "migrated_ids": [item["page_id"] for item in migrated],
        "migrated_with_etags": migrated,
        "skipped": skipped,
        "conflicts": conflicts,
        "errors": errors,
    }


def apply_metadata_patch(
    metadata: Metadata,
    updates: Metadata,
    remove_keys: list[str],
) -> Metadata:
    """Apply update/remove semantics without mutating the input mapping."""
    next_metadata = dict(metadata)
    for update_key, value in updates.items():
        if value is None or value == "":
            next_metadata.pop(update_key, None)
        else:
            next_metadata[update_key] = value
    for remove_key in remove_keys:
        next_metadata.pop(remove_key, None)
    return next_metadata


def _bulk_update_one(
    page_id: str,
    updates: Metadata,
    remove_keys: list[str],
    expected_etags: Metadata,
    dependencies: MetadataMutationDependencies,
) -> MutationResult:
    page_path = dependencies.find_page(page_id)
    if not page_path or not page_path.exists():
        return "error", "not_found"
    conflict = _etag_conflict(page_id, page_path, expected_etags, dependencies)
    if conflict:
        return conflict
    try:
        metadata, body = dependencies.parse_frontmatter(
            page_path.read_text(encoding="utf-8"),
            page_path,
        )
        next_metadata = apply_metadata_patch(metadata, updates, remove_keys)
        if next_metadata == metadata:
            return "skip", None
        dependencies.save_page(page_path, next_metadata, body or "")
        dependencies.refresh_page_index(page_path, next_metadata, body or "")
        return "ok", dependencies.file_etag(page_path)
    except (OSError, ValueError) as error:
        return "error", str(error)


async def bulk_update_metadata(
    payload: Metadata,
    dependencies: MetadataMutationDependencies,
) -> Metadata:
    """Apply one metadata patch to multiple pages with ETag conflict reporting."""
    page_ids = payload.get("page_ids") or []
    updates = payload.get("updates") or {}
    remove_keys = payload.get("remove") or []
    if not isinstance(page_ids, list) or not page_ids:
        raise HTTPException(status_code=400, detail="page_ids ha de ser una llista no buida")
    if (
        not isinstance(updates, dict)
        or not isinstance(remove_keys, list)
        or (not updates and not remove_keys)
    ):
        raise HTTPException(status_code=400, detail="updates o remove són obligatoris")
    typed_updates = cast(Metadata, updates)
    typed_remove = [str(key) for key in remove_keys]
    expected_etags = _etag_map(payload)
    updated, skipped, conflicts, errors = _result_collections()
    for raw_page_id in page_ids:
        page_id = str(raw_page_id)
        result = await asyncio.to_thread(
            _bulk_update_one,
            page_id,
            typed_updates,
            typed_remove,
            expected_etags,
            dependencies,
        )
        _record_result(page_id, result, updated, skipped, conflicts, errors)
    if updated:
        dependencies.invalidate_citation_index()
        dependencies.invalidate_page_cache()
    return {
        "updated": len(updated),
        "updated_ids": [item["page_id"] for item in updated],
        "updated_with_etags": updated,
        "skipped": skipped,
        "conflicts": conflicts,
        "errors": errors,
    }


def _read_template(
    template_id: str,
    dependencies: MetadataMutationDependencies,
) -> tuple[Metadata, str] | None:
    template_path = dependencies.find_page(template_id)
    if not template_path or not template_path.exists():
        return None
    metadata, body = dependencies.parse_frontmatter(
        template_path.read_text(encoding="utf-8"),
        template_path,
    )
    return metadata, body or ""


def _template_property_keys(table: Metadata, template_metadata: Metadata) -> list[PropertyKeys]:
    result: list[PropertyKeys] = []
    properties = table.get("properties")
    for raw_property in properties if isinstance(properties, list) else []:
        prop = _mapping(raw_property)
        aliases = prop.get("aliases")
        raw_keys = [prop.get("name"), prop.get("id")]
        if isinstance(aliases, list):
            raw_keys.extend(aliases)
        keys = [str(key) for key in raw_keys if key]
        template_key = next((key for key in keys if key in template_metadata), None)
        if template_key:
            result.append((keys, template_key))
    return result


def _apply_template_one(
    page_id: str,
    table_id: str,
    template_metadata: Metadata,
    template_body: str,
    property_keys: list[PropertyKeys],
    expected_etags: Metadata,
    dependencies: MetadataMutationDependencies,
) -> MutationResult:
    page_path = dependencies.find_page(page_id)
    if not page_path or not page_path.exists():
        return "error", "not_found"
    conflict = _etag_conflict(page_id, page_path, expected_etags, dependencies)
    if conflict:
        return conflict
    metadata, current_body = dependencies.parse_frontmatter(
        page_path.read_text(encoding="utf-8"),
        page_path,
    )
    if metadata.get("is_template") is True:
        return "error", "target_is_template"
    if dependencies.table_id(metadata) != table_id:
        return "error", "different_table"
    next_metadata = dict(metadata)
    for candidate_keys, template_key in property_keys:
        target_key = next((key for key in candidate_keys if key in metadata), template_key)
        next_metadata[target_key] = template_metadata[template_key]
    if next_metadata == metadata and current_body == template_body:
        return "skip", None
    dependencies.save_page(page_path, next_metadata, template_body)
    dependencies.refresh_page_index(page_path, next_metadata, template_body)
    return "ok", dependencies.file_etag(page_path)


async def bulk_apply_template(
    payload: Metadata,
    dependencies: MetadataMutationDependencies,
) -> Metadata:
    """Apply one table template body and its declared fields to selected rows."""
    raw_page_ids = payload.get("page_ids") or []
    template_id = _string(payload.get("template_id"))
    if not isinstance(raw_page_ids, list) or not raw_page_ids:
        raise HTTPException(status_code=400, detail="page_ids must be a non-empty list")
    if not template_id:
        raise HTTPException(status_code=400, detail="template_id is required")
    try:
        template = await asyncio.to_thread(_read_template, template_id, dependencies)
    except (OSError, ValueError) as error:
        raise HTTPException(status_code=400, detail=f"Could not read template: {error}") from error
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")
    template_metadata, template_body = template
    if template_metadata.get("is_template") is not True:
        raise HTTPException(status_code=400, detail="Selected page is not a template")
    table_id = dependencies.table_id(template_metadata)
    table = dependencies.table_by_id(table_id)
    if not table:
        raise HTTPException(status_code=400, detail="Template does not belong to a table")
    property_keys = _template_property_keys(table, template_metadata)
    expected_etags = _etag_map(payload)
    updated, skipped, conflicts, errors = _result_collections()
    page_ids = dict.fromkeys(str(page_id) for page_id in raw_page_ids if page_id)
    for page_id in page_ids:
        async with await dependencies.page_write_lock(page_id):
            try:
                result = await asyncio.to_thread(
                    _apply_template_one,
                    page_id,
                    table_id,
                    template_metadata,
                    template_body,
                    property_keys,
                    expected_etags,
                    dependencies,
                )
            except (OSError, ValueError) as error:
                result = "error", str(error)
        _record_result(page_id, result, updated, skipped, conflicts, errors)
    if updated:
        dependencies.invalidate_citation_index()
        dependencies.invalidate_page_cache()
    return {
        "updated": len(updated),
        "updated_ids": [item["page_id"] for item in updated],
        "updated_with_etags": updated,
        "skipped": skipped,
        "conflicts": conflicts,
        "errors": errors,
    }


__all__ = [
    "Metadata",
    "MetadataMutationDependencies",
    "apply_metadata_patch",
    "bulk_apply_template",
    "bulk_update_metadata",
    "promote_zotero_extra",
]
