"""Canonical Markdown writer with identity and sidecar loss guards."""

from __future__ import annotations

import logging
import re
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any


Metadata = dict[str, Any]


@dataclass(frozen=True)
class MarkdownWriterDependencies:
    """Ports required to serialize one Vault page safely."""

    is_dashboard_file: Callable[[Path], bool]
    read_dashboard_file: Callable[[Path], tuple[Metadata, str]]
    parse_frontmatter: Callable[[str, Path], tuple[Metadata, str]]
    new_uuid: Callable[[], str]
    get_table_id: Callable[[Metadata], str | None]
    table_by_id: Callable[[str], Metadata | None]
    to_storage_names: Callable[[Metadata, Metadata], Metadata]
    strip_virtual_keys: Callable[[Metadata, Metadata], Metadata]
    relation_keys: Callable[[Metadata | None], object]
    decorate_relations: Callable[[Metadata, object | None], Metadata]
    persist_sidecar: Callable[[Metadata, Path], Metadata]
    dump_yaml: Callable[[Metadata], str]
    inject_view_snapshots: Callable[[str, object | None], str]
    compact_view_fences: Callable[[str], str]
    write_text: Callable[[Path, str], None]
    logger: logging.Logger


def _read_existing_identity(
    file_path: Path,
    dependencies: MarkdownWriterDependencies,
) -> tuple[str | None, object | None]:
    if not file_path.exists():
        return None, None
    existing_raw = file_path.read_text(encoding="utf-8")
    existing_metadata: Metadata = {}
    try:
        if dependencies.is_dashboard_file(file_path):
            existing_metadata, _body = dependencies.read_dashboard_file(file_path)
        else:
            existing_metadata, _body = dependencies.parse_frontmatter(
                existing_raw,
                file_path,
            )
    except Exception:
        pass
    normalized_metadata = existing_metadata or {}
    recovered_id = str(normalized_metadata.get("id") or "").strip() or None
    recovered_title = normalized_metadata.get("title")
    if recovered_id:
        return recovered_id, recovered_title
    match = re.search(
        r"(?mi)^\s*id:\s*['\"]?"
        r"([0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12})",
        existing_raw,
    )
    return (match.group(1).strip(), recovered_title) if match else (None, recovered_title)


def _ensure_identity(
    file_path: Path,
    metadata: Metadata,
    dependencies: MarkdownWriterDependencies,
) -> Metadata:
    if str((metadata or {}).get("id") or "").strip():
        return metadata
    recovered_id: str | None = None
    recovered_title: object | None = None
    try:
        recovered_id, recovered_title = _read_existing_identity(file_path, dependencies)
    except Exception as exc:
        dependencies.logger.warning(
            "save_page_md: could not recover the id for %s: %s",
            file_path,
            exc,
        )
    result = dict(metadata or {})
    if recovered_id:
        result["id"] = recovered_id
        if not str(result.get("title") or "").strip():
            result["title"] = recovered_title or file_path.stem
        dependencies.logger.error(
            "save_page_md: metadata WITHOUT an id for %s; recovered from disk "
            "(%s). A caller is dropping frontmatter; investigate "
            "(the note was NOT corrupted).",
            file_path,
            recovered_id,
        )
        return result
    new_id = dependencies.new_uuid()
    result["id"] = new_id
    if not str(result.get("title") or "").strip():
        result["title"] = file_path.stem
    dependencies.logger.error(
        "save_page_md: metadata WITHOUT 'id' for %s and not recoverable from "
        "disk; assigned new id %s to avoid corruption. Investigate the caller.",
        file_path,
        new_id,
    )
    return result


def _normalize_storage(
    file_path: Path,
    metadata: Metadata,
    dependencies: MarkdownWriterDependencies,
) -> tuple[Metadata, Metadata | None]:
    table: Metadata | None = None
    try:
        table_id = dependencies.get_table_id(metadata)
        if table_id:
            table = dependencies.table_by_id(table_id)
            if table:
                metadata = dependencies.to_storage_names(metadata, table)
                metadata = dependencies.strip_virtual_keys(metadata, table)
    except Exception as exc:
        dependencies.logger.debug(
            "to_storage_names ha fallat per %s: %s",
            file_path,
            exc,
        )
    return metadata, table


def _decorate_relations(
    file_path: Path,
    metadata: Metadata,
    table: Metadata | None,
    dependencies: MarkdownWriterDependencies,
) -> Metadata:
    try:
        relation_keys = dependencies.relation_keys(table) or None
        return dependencies.decorate_relations(metadata, relation_keys)
    except Exception as exc:
        dependencies.logger.debug(
            "Relationship decoration failed for %s: %s",
            file_path,
            exc,
        )
        return metadata


def _frontmatter(
    metadata: Metadata,
    file_path: Path,
    dependencies: MarkdownWriterDependencies,
) -> str:
    frontmatter_metadata = dependencies.persist_sidecar(metadata, file_path)
    if not frontmatter_metadata:
        return "---\n---\n"
    return f"---\n{dependencies.dump_yaml(frontmatter_metadata)}---\n"


def _portable_body(
    file_path: Path,
    body: str,
    page_id: object | None,
    dependencies: MarkdownWriterDependencies,
) -> str:
    try:
        body = dependencies.inject_view_snapshots(body, page_id)
        return dependencies.compact_view_fences(body)
    except Exception as exc:
        dependencies.logger.debug(
            "View snapshot failed for %s: %s",
            file_path,
            exc,
        )
        return body


def save_page_markdown(
    file_path: Path,
    metadata: Metadata,
    body: str,
    dependencies: MarkdownWriterDependencies,
) -> None:
    """Write clean frontmatter and portable body without ever losing page ID."""
    metadata = _ensure_identity(file_path, metadata, dependencies)
    metadata, table = _normalize_storage(file_path, metadata, dependencies)
    metadata = _decorate_relations(file_path, metadata, table, dependencies)
    frontmatter = _frontmatter(metadata, file_path, dependencies)
    body = _portable_body(
        file_path,
        body,
        metadata.get("id"),
        dependencies,
    )
    dependencies.write_text(file_path, f"{frontmatter}\n{(body or '').lstrip()}")


__all__ = ["MarkdownWriterDependencies", "save_page_markdown"]
