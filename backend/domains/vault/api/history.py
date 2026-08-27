"""HTTP adapter for vault page history."""

from __future__ import annotations

import logging
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from fastapi import APIRouter, BackgroundTasks, HTTPException
from fastapi.params import Depends as DependsParameter

from backend.domains.vault.history.repository import HistoryRepository

FrontmatterParser = Callable[[str, Path | None], tuple[dict[str, Any], str]]
PageFinder = Callable[[str], Path | None]
PageVersionWriter = Callable[[str, Path, bool], None]
TableIdReader = Callable[[dict[str, Any]], str | None]
FormulaRecompute = Callable[[str, str], object]

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class HistoryDependencies:
    """Narrow services required by the history HTTP adapter."""

    vault_root: Callable[[], Path]
    validate_page_id: Callable[[str], str]
    validate_timestamp: Callable[[str], str]
    parse_frontmatter: FrontmatterParser
    find_page: PageFinder
    create_page_version: PageVersionWriter
    get_table_id: TableIdReader
    recompute_formulas: FormulaRecompute


_dependencies: HistoryDependencies | None = None


def configure(dependencies: HistoryDependencies) -> None:
    """Configure the adapter once from the application composition boundary."""
    global _dependencies
    if _dependencies is not None and _dependencies != dependencies:
        raise RuntimeError("Vault history API is already configured")
    _dependencies = dependencies


def _deps() -> HistoryDependencies:
    if _dependencies is None:
        raise RuntimeError("Vault history API has not been configured")
    return _dependencies


def _repository() -> HistoryRepository:
    return HistoryRepository(_deps().vault_root())


async def get_page_history(page_id: str) -> list[dict[str, object]]:
    """Returns the list of available versions for a page."""
    safe_page_id = _deps().validate_page_id(page_id)
    return _repository().list_versions(safe_page_id)


async def get_page_version_content(page_id: str, timestamp: str) -> dict[str, object]:
    """Returns the content of a specific version."""
    dependencies = _deps()
    safe_page_id = dependencies.validate_page_id(page_id)
    safe_timestamp = dependencies.validate_timestamp(timestamp)
    repository = _repository()
    version_path = repository.version_path(safe_page_id, safe_timestamp)
    if not version_path.exists():
        raise HTTPException(status_code=404, detail="Version not found")
    try:
        raw_content = repository.read_version(safe_page_id, safe_timestamp)
        metadata, body = dependencies.parse_frontmatter(raw_content, version_path)
        return {
            "id": safe_page_id,
            "version_id": safe_timestamp,
            "metadata": metadata,
            "content": body.strip(),
        }
    except Exception as exc:
        log.error(
            "Error reading version %s of %s: %s",
            safe_timestamp,
            safe_page_id,
            exc,
        )
        raise HTTPException(status_code=500, detail="Error reading the version") from exc


async def restore_page_version(
    page_id: str,
    timestamp: str,
    background_tasks: BackgroundTasks,
) -> dict[str, str]:
    """Restores a page to a previous version."""
    dependencies = _deps()
    safe_page_id = dependencies.validate_page_id(page_id)
    safe_timestamp = dependencies.validate_timestamp(timestamp)
    repository = _repository()
    version_path = repository.version_path(safe_page_id, safe_timestamp)
    if not version_path.exists():
        raise HTTPException(status_code=404, detail="Version not found")
    file_path = dependencies.find_page(safe_page_id)
    if not file_path:
        raise HTTPException(status_code=404, detail="Current page not found")

    dependencies.create_page_version(safe_page_id, file_path, True)
    try:
        repository.restore_version(safe_page_id, safe_timestamp, file_path)
        log.info("Page %s restored to version %s", safe_page_id, safe_timestamp)
        raw_content = file_path.read_text(encoding="utf-8")
        metadata, _ = dependencies.parse_frontmatter(raw_content, file_path)
        table_id = dependencies.get_table_id(metadata)
        if table_id:
            background_tasks.add_task(
                dependencies.recompute_formulas,
                table_id,
                safe_page_id,
            )
        return {"status": "success", "message": "Page restored successfully"}
    except Exception as exc:
        log.error(
            "Error restoring version %s of %s: %s",
            safe_timestamp,
            safe_page_id,
            exc,
        )
        raise HTTPException(status_code=500, detail="Error restoring the version") from exc


async def purge_page_history(page_id: str) -> dict[str, str]:
    """Deletes all version history of a page.

    Important: `page_id` must pass `_validate_safe_page_id` BEFORE
    building the path. Without this, `page_id=".."` would do
    `shutil.rmtree(VAULT/.history/..)` = deleting the entire Vault.
    """
    safe_page_id = _deps().validate_page_id(page_id)
    try:
        if not _repository().purge(safe_page_id):
            return {"status": "success", "message": "No history to delete"}
        log.info("Page history for %s purged", safe_page_id)
        return {"status": "success", "message": "History deleted successfully"}
    except Exception as exc:
        log.error("Error purging history for %s: %s", safe_page_id, exc)
        raise HTTPException(status_code=500, detail="Error deleting history") from exc


def register_routes(
    router: APIRouter,
    *,
    editor_dependencies: Sequence[DependsParameter],
    admin_dependencies: Sequence[DependsParameter],
) -> None:
    """Register history routes in their historical router position."""
    router.add_api_route(
        "/pages/{page_id}/history",
        get_page_history,
        methods=["GET"],
        response_model=None,
    )
    router.add_api_route(
        "/pages/{page_id}/history/{timestamp}",
        get_page_version_content,
        methods=["GET"],
        response_model=None,
    )
    router.add_api_route(
        "/pages/{page_id}/history/restore/{timestamp}",
        restore_page_version,
        methods=["POST"],
        dependencies=list(editor_dependencies),
        response_model=None,
    )
    router.add_api_route(
        "/pages/{page_id}/history",
        purge_page_history,
        methods=["DELETE"],
        dependencies=list(admin_dependencies),
        response_model=None,
    )


__all__ = [
    "HistoryDependencies",
    "configure",
    "get_page_history",
    "get_page_version_content",
    "purge_page_history",
    "register_routes",
    "restore_page_version",
]
