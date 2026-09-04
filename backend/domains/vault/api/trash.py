"""HTTP adapter and retention job for soft-deleted vault pages."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query
from fastapi.params import Depends as DependsParameter

from backend.domains.vault.schemas.pages import PageDeleteResponse
from backend.domains.vault.schemas.trash import (
    PageRestoreResponse,
    TrashEmptyResponse,
    TrashListResponse,
    TrashPurgeResponse,
)
from backend.domains.vault.trash.purge import PurgeResult
from backend.domains.vault.trash.repository import TrashMetadata
from backend.utils.open_values import item_value

PageWriteLock = Callable[[str], Awaitable[asyncio.Lock]]

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class TrashDependencies:
    """Narrow operations required by trash routes and retention."""

    retention_days: int
    validate_page_id: Callable[[str], str]
    get_page_write_lock: PageWriteLock
    find_page: Callable[[str], Path | None]
    move_page: Callable[[str, Path], TrashMetadata]
    remove_link_index: Callable[[str], None]
    remove_page_index: Callable[[str, Path | None], None]
    emit_page_deleted: Callable[[str], None]
    materialize_sidecar: Callable[[str], Awaitable[None]]
    restore_page: Callable[[str], TrashMetadata]
    add_page_index: Callable[[Path], None]
    vault_root: Callable[[], Path]
    read_entries: Callable[[], list[TrashMetadata]]
    trash_root: Callable[[], Path]
    purge_entry: Callable[[str], PurgeResult]
    safe_error_detail: Callable[[Exception, str], str]


_dependencies: TrashDependencies | None = None


def configure(dependencies: TrashDependencies) -> None:
    """Configure this adapter from the historical composition position."""
    global _dependencies
    if _dependencies is not None and _dependencies != dependencies:
        raise RuntimeError("Vault trash API is already configured")
    _dependencies = dependencies


def _deps() -> TrashDependencies:
    if _dependencies is None:
        raise RuntimeError("Vault trash API has not been configured")
    return _dependencies


async def delete_page(page_id: str) -> dict[str, object]:
    """Soft-delete: moves the page to `.trash/{page_id}/`.

    Replaces the previous destructive deletion. The actual purge only happens
    via `DELETE /trash/{id}` or via the `purge_trash` cron after 90 days.
    See `docs/dev_memory/directives/vault_trash.md`.
    """
    dependencies = _deps()
    async with await dependencies.get_page_write_lock(page_id):
        safe_page_id = dependencies.validate_page_id(page_id)
        file_path = await asyncio.to_thread(dependencies.find_page, safe_page_id)
        if not file_path or not file_path.exists():
            raise HTTPException(status_code=404, detail="Page not found")
        try:
            sidecar = await asyncio.to_thread(
                dependencies.move_page,
                safe_page_id,
                file_path,
            )
            await asyncio.to_thread(dependencies.remove_link_index, safe_page_id)
            dependencies.remove_page_index(safe_page_id, file_path)
            dependencies.emit_page_deleted(safe_page_id)
            deleted_at = sidecar.get("deleted_at")
            restorable_until: str | None = None
            if deleted_at:
                try:
                    restorable_until = (
                        datetime.fromisoformat(str(deleted_at))
                        + timedelta(days=dependencies.retention_days)
                    ).isoformat()
                except ValueError:
                    pass
            return {
                "status": "soft_deleted",
                "id": safe_page_id,
                "deleted_at": deleted_at,
                "title": sidecar.get("title"),
                "original_path": sidecar.get("original_path"),
                "retention_days": dependencies.retention_days,
                "restorable_until": restorable_until,
            }
        except Exception as exc:
            log.error("Error soft-deleting page %s: %s", safe_page_id, exc)
            raise HTTPException(
                status_code=500,
                detail=dependencies.safe_error_detail(
                    exc,
                    "DELETE /pages/{page_id}",
                ),
            ) from exc


async def restore_page(page_id: str) -> dict[str, object]:
    """Restores a page from the trash to its `original_path`."""
    dependencies = _deps()
    safe_page_id = dependencies.validate_page_id(page_id)
    await dependencies.materialize_sidecar(safe_page_id)
    try:
        result = await asyncio.to_thread(dependencies.restore_page, safe_page_id)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Trash entry not found") from exc
    except FileExistsError as exc:
        raise HTTPException(
            status_code=409,
            detail=f"A file already exists at the target path: {exc}",
        ) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        log.error("Error restoring page %s: %s", safe_page_id, exc)
        raise HTTPException(
            status_code=500,
            detail=dependencies.safe_error_detail(
                exc,
                "POST /pages/{page_id}/restore",
            ),
        ) from exc

    restored_path = result.get("restored_path")
    if restored_path:
        dependencies.add_page_index(dependencies.vault_root() / str(restored_path))
    return {
        "status": "restored",
        "id": safe_page_id,
        "restored_path": restored_path,
        "title": result.get("title"),
    }


async def list_trash(q: str | None = Query(None)) -> dict[str, object]:
    """Lists the trash entries, ordered by `deleted_at` desc.

    Optional `?q=` filter support on the title (case-insensitive). Listing is
    intentionally read-only and never hydrates every cloud sidecar: an exact
    restore or purge still materializes the one entry it operates on.
    """
    dependencies = _deps()
    try:
        entries = await asyncio.to_thread(dependencies.read_entries)
    except Exception as exc:
        log.error("Error reading trash: %s", exc)
        raise HTTPException(
            status_code=500,
            detail=dependencies.safe_error_detail(exc, "GET /trash"),
        ) from exc
    if q:
        needle = q.lower().strip()
        entries = [entry for entry in entries if needle in str(entry.get("title") or "").lower()]
    return {"items": entries, "retention_days": dependencies.retention_days}


def _empty_all(dependencies: TrashDependencies) -> dict[str, object]:
    purged = 0
    failed = 0
    freed = 0
    failed_ids: list[str] = []
    for entry_dir in list(dependencies.trash_root().iterdir()):
        if not entry_dir.is_dir():
            continue
        try:
            result = dependencies.purge_entry(entry_dir.name)
            purged += 1
            freed += int(result.get("freed_bytes") or 0)
        except Exception as exc:
            failed += 1
            failed_ids.append(entry_dir.name)
            log.warning(
                "Purge failed while emptying the trash for %s: %s",
                entry_dir.name,
                exc,
            )
    return {
        "purged_count": purged,
        "failed_count": failed,
        "failed_ids": failed_ids,
        "freed_bytes": freed,
    }


async def empty_trash() -> dict[str, object]:
    """Empties the whole trash in ONE single request (definitive purge).

    Replaces the old pattern of N client-side `DELETE /trash/{id}` requests.
    With ~100 entries, the client fired ~100 concurrent DELETEs and each
    one held a DB pool connection (via the workspace/role dependencies)
    for the entire request, exhausting the `QueuePool` (size 20 +
    overflow 30) → many requests timed out at 30s and returned 500.
    `Promise.allSettled` on the frontend hid these 500s and the trash wasn't
    emptied ("doesn't work"). Doing it all server-side uses ONE connection and
    tolerates per-entry errors (it reports the real count).
    """
    dependencies = _deps()
    try:
        result = await asyncio.to_thread(_empty_all, dependencies)
    except Exception as exc:
        log.error("Error emptying trash: %s", exc)
        raise HTTPException(
            status_code=500,
            detail=dependencies.safe_error_detail(exc, "DELETE /trash"),
        ) from exc
    return {"status": "emptied", **result}


async def purge_trash_entry(page_id: str) -> dict[str, object]:
    """Immediately purge a trash entry (irreversible)."""
    dependencies = _deps()
    safe_page_id = dependencies.validate_page_id(page_id)
    await dependencies.materialize_sidecar(safe_page_id)
    try:
        result = await asyncio.to_thread(dependencies.purge_entry, safe_page_id)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Trash entry not found") from exc
    except Exception as exc:
        log.error("Error purging trash entry %s: %s", safe_page_id, exc)
        raise HTTPException(
            status_code=500,
            detail=dependencies.safe_error_detail(
                exc,
                "DELETE /trash/{page_id}",
            ),
        ) from exc
    return {"status": "purged", **result}


def purge_expired_trash(now: datetime | None = None) -> dict[str, object]:
    """Purge entries older than the configured retention period."""
    dependencies = _deps()
    now_utc = now or datetime.now(tz=timezone.utc)
    purged = 0
    freed = 0
    skipped = 0
    for entry_dir in dependencies.trash_root().iterdir():
        if not entry_dir.is_dir():
            continue
        sidecar_path = entry_dir / "_trash.json"
        if not sidecar_path.exists():
            skipped += 1
            continue
        try:
            import json

            data: object = json.loads(sidecar_path.read_text(encoding="utf-8"))
            deleted_at = datetime.fromisoformat(str(item_value(data, "deleted_at")))
            if deleted_at.tzinfo is None:
                deleted_at = deleted_at.replace(tzinfo=timezone.utc)
        except (OSError, ValueError, KeyError, TypeError):
            skipped += 1
            continue
        if (now_utc - deleted_at).days < dependencies.retention_days:
            continue
        try:
            result = dependencies.purge_entry(entry_dir.name)
            purged += 1
            freed += int(result.get("freed_bytes") or 0)
        except Exception as exc:
            log.warning("Purge failed for %s: %s", entry_dir.name, exc)
            skipped += 1
    return {"purged_count": purged, "freed_bytes": freed, "skipped": skipped}


def register_routes(
    router: APIRouter,
    *,
    editor_dependencies: Sequence[DependsParameter],
    admin_dependencies: Sequence[DependsParameter],
) -> None:
    """Register routes at their original position in the vault router."""
    router.add_api_route(
        "/pages/{page_id}",
        delete_page,
        methods=["DELETE"],
        dependencies=list(editor_dependencies),
        response_model=PageDeleteResponse,
    )
    router.add_api_route(
        "/pages/{page_id}/restore",
        restore_page,
        methods=["POST"],
        dependencies=list(editor_dependencies),
        response_model=PageRestoreResponse,
    )
    router.add_api_route(
        "/trash",
        list_trash,
        methods=["GET"],
        dependencies=list(admin_dependencies),
        response_model=TrashListResponse,
    )
    router.add_api_route(
        "/trash",
        empty_trash,
        methods=["DELETE"],
        dependencies=list(admin_dependencies),
        response_model=TrashEmptyResponse,
    )
    router.add_api_route(
        "/trash/{page_id}",
        purge_trash_entry,
        methods=["DELETE"],
        dependencies=list(admin_dependencies),
        response_model=TrashPurgeResponse,
    )


__all__ = [
    "TrashDependencies",
    "configure",
    "delete_page",
    "empty_trash",
    "list_trash",
    "purge_expired_trash",
    "purge_trash_entry",
    "register_routes",
    "restore_page",
]
