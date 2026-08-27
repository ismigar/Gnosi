"""HTTP adapter for duplicating a vault page."""

from __future__ import annotations

import logging
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from fastapi import APIRouter, BackgroundTasks, HTTPException
from fastapi.params import Depends as DependsParameter

Metadata = dict[str, Any]

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class DuplicatePageDependencies:
    find_page: Callable[[str], Path | None]
    is_dashboard: Callable[[Path], bool]
    read_dashboard: Callable[[Path], tuple[Metadata, str]]
    parse_frontmatter: Callable[[str, Path | None], tuple[Metadata, str]]
    new_id: Callable[[], str]
    write_dashboard: Callable[[Path, str, str, Metadata, str], None]
    ensure_citation_key: Callable[[Metadata], Metadata]
    save_page: Callable[[Path, Metadata, str], None]
    add_page_index: Callable[[Path], None]
    update_link_index: Callable[[], Callable[[Path], object]]


_dependencies: DuplicatePageDependencies | None = None


def configure(dependencies: DuplicatePageDependencies) -> None:
    global _dependencies
    if _dependencies is not None and _dependencies != dependencies:
        raise RuntimeError("Vault duplicate-page API is already configured")
    _dependencies = dependencies


def _deps() -> DuplicatePageDependencies:
    if _dependencies is None:
        raise RuntimeError("Vault duplicate-page API has not been configured")
    return _dependencies


async def duplicate_page(
    page_id: str,
    background_tasks: BackgroundTasks,
) -> dict[str, str]:
    """Duplicates an existing page and returns the new ID."""
    dependencies = _deps()
    source_path = dependencies.find_page(page_id)
    if not source_path or not source_path.exists():
        raise HTTPException(
            status_code=404,
            detail="Source page not found (non-existent ID)",
        )
    try:
        is_dashboard = dependencies.is_dashboard(source_path)
        if is_dashboard:
            metadata, body = dependencies.read_dashboard(source_path)
        else:
            raw_content = source_path.read_text(encoding="utf-8")
            metadata, body = dependencies.parse_frontmatter(raw_content, source_path)

        new_page_id = dependencies.new_id()
        new_metadata = metadata.copy()
        new_metadata["id"] = new_page_id
        old_title = metadata.get("title", "Untitled")
        new_title = f"{old_title} (Copy)"
        new_metadata["title"] = new_title

        if is_dashboard:
            new_file_path = source_path.parent / f"{new_page_id}.json"
            dependencies.write_dashboard(
                new_file_path,
                new_page_id,
                new_title,
                new_metadata,
                body,
            )
        else:
            new_file_path = source_path.parent / f"{new_page_id}.md"
            new_metadata = dependencies.ensure_citation_key(new_metadata)
            dependencies.save_page(new_file_path, new_metadata, body)

        dependencies.add_page_index(new_file_path)
        background_tasks.add_task(dependencies.update_link_index(), new_file_path)
        return {
            "status": "created",
            "id": new_page_id,
            "message": "Page duplicated",
            "title": new_title,
        }
    except Exception as exc:
        log.error("Error duplicating page %s: %s", page_id, exc)
        raise HTTPException(
            status_code=500,
            detail="Error duplicating target file",
        ) from exc


def register_routes(
    router: APIRouter,
    *,
    editor_dependencies: Sequence[DependsParameter],
) -> None:
    router.add_api_route(
        "/pages/{page_id}/duplicate",
        duplicate_page,
        methods=["POST"],
        dependencies=list(editor_dependencies),
        response_model=None,
    )


__all__ = [
    "DuplicatePageDependencies",
    "configure",
    "duplicate_page",
    "register_routes",
]
