"""Application service for creating one vault page."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from fastapi import BackgroundTasks, HTTPException

from backend.domains.vault.schemas.pages import PageSaveRequest

Metadata = dict[str, Any]

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class CreatePageDependencies:
    """Narrow operations used by the create-page workflow."""

    new_id: Callable[[], str]
    normalize_metadata: Callable[[Metadata], Metadata]
    prepare_table_metadata: Callable[
        [Metadata],
        tuple[Metadata, Metadata | None],
    ]
    process_updates: Callable[[str, Metadata, Metadata], Metadata]
    stamp_author: Callable[[Metadata, str | None, bool], None]
    persist_assets: Callable[[Metadata], Metadata]
    ensure_citation_key: Callable[[Metadata, Metadata | None], Metadata]
    dedupe_citation_key: Callable[[Metadata, str], Metadata]
    fill_authorship: Callable[[Metadata, Metadata | None], Metadata]
    path_for: Callable[[str], Path]
    is_calendar_entry: Callable[[Metadata], bool]
    table_folder: Callable[[Metadata], Path | None]
    canonicalize_id: Callable[[object], str]
    parse_frontmatter: Callable[[str, Path | None], tuple[Metadata, str]]
    unique_file_path: Callable[[Path, str, str], Path]
    save_page: Callable[[Path, Metadata, str], None]
    get_table_id: Callable[[Metadata], str | None]
    recompute_formulas: Callable[[str, str], object]
    index_created_page: Callable[[str, Path], None]
    invalidate_page_responses: Callable[[], None]
    add_page_index: Callable[[Path], None]
    update_link_index: Callable[[Path], object]
    queue_planning: Callable[[BackgroundTasks], None]
    propagate_relations: Callable[[str, str | None, Metadata, Metadata], object]
    resolve_page_context: Callable[[Metadata, Path], tuple[str, str | None]]
    emit_created: Callable[[str, str], None]


async def _prepare_metadata(
    request: PageSaveRequest,
    page_id: str,
    user_id: str | None,
    dependencies: CreatePageDependencies,
) -> Metadata:
    metadata = request.metadata.copy()
    metadata["id"] = page_id
    metadata = dependencies.normalize_metadata(metadata)
    metadata, table = dependencies.prepare_table_metadata(metadata)
    metadata["id"] = page_id
    metadata["title"] = request.title
    if request.parent_id:
        metadata["parent_id"] = request.parent_id
    if request.is_database:
        metadata["is_database"] = True
    if metadata.get("is_dashboard") is True:
        metadata.pop("content_format", None)
    try:
        metadata = await asyncio.to_thread(
            dependencies.process_updates,
            page_id,
            {},
            metadata,
        )
    except Exception as exc:
        log.error("Error processing automations on create for %s: %s", page_id, exc)
    dependencies.stamp_author(metadata, user_id, True)
    metadata = dependencies.persist_assets(metadata)
    metadata = dependencies.ensure_citation_key(metadata, table)
    metadata = dependencies.dedupe_citation_key(metadata, page_id)
    return dependencies.fill_authorship(metadata, table)


def _target_directory(
    metadata: Metadata,
    dependencies: CreatePageDependencies,
) -> Path:
    if metadata.get("is_template") is True:
        return dependencies.path_for("PLANTILLES")
    if str(metadata.get("note_type") or "").strip().lower() == "daily":
        return dependencies.path_for("DAILY")
    if dependencies.is_calendar_entry(metadata):
        return dependencies.path_for("CALENDAR")
    if metadata.get("is_dashboard") is True:
        return dependencies.path_for("DASHBOARDS")
    return dependencies.table_folder(metadata) or dependencies.path_for("WIKI")


def _find_existing_path(
    target_dir: Path,
    metadata: Metadata,
    dependencies: CreatePageDependencies,
) -> Path | None:
    requested_id = str(metadata.get("id") or "").strip()
    canonical_id = dependencies.canonicalize_id(requested_id) if requested_id else ""
    if not canonical_id:
        return None
    try:
        for candidate in target_dir.iterdir():
            if not candidate.is_file() or candidate.suffix != ".md":
                continue
            try:
                raw_existing = candidate.read_text(encoding="utf-8")
                existing_metadata, _ = dependencies.parse_frontmatter(
                    raw_existing,
                    candidate,
                )
                existing_id = dependencies.canonicalize_id(str(existing_metadata.get("id", "")))
                if existing_id == canonical_id:
                    return candidate
            except Exception:
                continue
    except OSError:
        return None
    return None


async def create_page(
    request: PageSaveRequest,
    background_tasks: BackgroundTasks,
    user_id: str | None,
    dependencies: CreatePageDependencies,
) -> dict[str, object]:
    """Create a page while preserving all index and relation side effects."""
    page_id = dependencies.new_id()
    metadata = await _prepare_metadata(request, page_id, user_id, dependencies)
    target_dir = _target_directory(metadata, dependencies)
    target_dir.mkdir(parents=True, exist_ok=True)
    existing_path = _find_existing_path(target_dir, metadata, dependencies)
    if existing_path is not None:
        page_id = str(metadata.get("id") or page_id)
        file_path = existing_path
        log.info("Reusing existing page for id %s: %s", page_id, file_path)
    else:
        file_path = dependencies.unique_file_path(
            target_dir,
            request.title,
            ".md",
        )

    log.info("Creating new page at: %s", file_path.absolute())
    try:
        relation_snapshot = dict(metadata)
        dependencies.save_page(file_path, metadata, request.content)
        table_id = dependencies.get_table_id(metadata)
        if table_id:
            background_tasks.add_task(
                dependencies.recompute_formulas,
                table_id,
                page_id,
            )
        dependencies.index_created_page(page_id, file_path)
        dependencies.invalidate_page_responses()
        dependencies.add_page_index(file_path)
        background_tasks.add_task(dependencies.update_link_index, file_path)
        dependencies.queue_planning(background_tasks)
        background_tasks.add_task(
            dependencies.propagate_relations,
            page_id,
            dependencies.get_table_id(metadata),
            {},
            relation_snapshot,
        )
        folder, resolved_table_id = dependencies.resolve_page_context(
            metadata,
            file_path,
        )
        dependencies.emit_created(page_id, request.title)
        return {
            "status": "created",
            "id": page_id,
            "title": request.title,
            "metadata": metadata,
            "content": request.content,
            "folder": folder,
            "resolved_table_id": resolved_table_id,
            "message": "Page created",
        }
    except Exception as exc:
        log.error("Error creating the page: %s", exc)
        raise HTTPException(status_code=500, detail="Error writing the page file") from exc


__all__ = ["CreatePageDependencies", "create_page"]
