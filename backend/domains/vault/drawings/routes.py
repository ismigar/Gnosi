"""Typed Vault domain extracted from the historical route facade."""

from __future__ import annotations

from pathlib import Path

from fastapi import Depends, HTTPException
from pydantic import BaseModel, ConfigDict, JsonValue, RootModel

from backend.api.vault_routes import router as router
from backend.domains.vault.api import history as _history_api
from backend.domains.vault.drawings import service as _drawing_service
from backend.domains.vault.drawings.composition import drawing_dependencies as _drawing_dependencies
from backend.domains.vault.drawings.composition import vault as _vault
from backend.domains.vault.history.repository import HistoryRepository as _HistoryRepository
from backend.domains.vault.pages.runtime import DrawingSaveRequest as _DrawingSaveRequest
from backend.services.workspace_service import require_role as _require_role


class DrawingSummaryResponse(BaseModel):
    """Stable catalog entry for current and legacy drawing files."""

    model_config = ConfigDict(extra="allow")

    id: str
    title: str
    last_modified: str
    size: int


class DrawingDocumentResponse(RootModel[dict[str, JsonValue]]):
    """Arbitrary JSON document understood by Tldraw or legacy Excalidraw."""


class DrawingSaveResponse(BaseModel):
    status: str
    id: str


class DrawingDeleteResponse(BaseModel):
    """Recoverable deletion result returned by the shared Vault trash."""

    model_config = ConfigDict(extra="allow")

    status: str
    id: str
    deleted_at: str | None
    title: str

_DRAWING_DEPENDENCIES = _drawing_dependencies()


@router.get("/drawings", response_model=list[DrawingSummaryResponse])
async def list_drawings() -> list[dict[str, object]]:
    """Lists all drawings in the vault (tldraw and excalidraw)."""
    return await _drawing_service.list_drawings(_DRAWING_DEPENDENCIES)


@router.get("/drawings/{drawing_id}", response_model=DrawingDocumentResponse)
async def get_drawing(drawing_id: str) -> object:
    """Returns the data of a Tldraw drawing."""
    try:
        return await _drawing_service.get_drawing(drawing_id, _DRAWING_DEPENDENCIES)
    except _drawing_service.DrawingNotFoundError:
        raise HTTPException(status_code=404, detail="Drawing not found")
    except _drawing_service.DrawingReadError:
        raise HTTPException(status_code=500, detail="Error reading target file")


def _backup_drawing_version(drawing_id: str, file_path: Path) -> None:
    """Copies the current .tldraw.json to .history/{id}/{ts}.tldraw.json before
    overwriting it. Last line of defense against clients that save an empty
    canvas after a failed load (directive tldraw_save_integrity.md).
    Same 10 min cooldown as `_create_page_version`: also prevents a broken
    client saving in a loop from clobbering the good backup with empty versions.

    """
    _drawing_service.backup_drawing_version(drawing_id, file_path, _DRAWING_DEPENDENCIES)


@router.put(
    "/drawings/{drawing_id}",
    dependencies=[Depends(_require_role("editor"))],
    response_model=DrawingSaveResponse,
)
async def save_drawing(
    drawing_id: str,
    request: _DrawingSaveRequest,
) -> dict[str, object]:
    """Saves or updates a Tldraw drawing."""
    try:
        return await _drawing_service.save_drawing(
            drawing_id,
            request.title,
            request.data,
            request.metadata or {},
            _DRAWING_DEPENDENCIES,
        )
    except _drawing_service.DrawingWriteError:
        raise HTTPException(status_code=500, detail="Error writing target file")


@router.delete(
    "/drawings/{drawing_id}",
    dependencies=[Depends(_require_role("editor"))],
    response_model=DrawingDeleteResponse,
)
async def delete_drawing(drawing_id: str) -> dict[str, object]:
    """Soft-delete: moves the drawing to the trash, like pages.

    It used to do a direct `unlink()`: instant and IRREVERSIBLE deletion —
    the only thing in the app without the 90-day recovery window. And the
    `.history` backup didn't cover this case: it only exists if the drawing
    had been overwritten at some point (the first save doesn't create one), so
    a newly created drawing that got deleted was lost entirely. The trash
    mechanism is format-agnostic (it stores the file + a sidecar with
    `original_path` and restores there), so we reuse `_move_page_to_trash`:
    Restore/Purge and the 90-day cron work for free.

    """
    drawing_id = _vault._validate_safe_page_id(drawing_id)
    try:
        return await _drawing_service.delete_drawing(
            drawing_id,
            _DRAWING_DEPENDENCIES,
        )
    except _drawing_service.DrawingNotFoundError:
        raise HTTPException(status_code=404, detail="Drawing not found")


def _create_page_version(page_id: str, file_path: Path, force: bool = False) -> None:
    """Saves a version of the current file to .history/{page_id}/{timestamp}.md if cooldown passed.

    `force=True` skips the cooldown: it's for the SAFETY snapshots
    of explicit actions (e.g. the "state right before the restore"). The
    cooldown is meant to avoid saturating with autosaves; applying it also to
    the pre-restore snapshot meant that, if you had edited less than 10 min ago,
    the current state would be SILENTLY discarded and become unrecoverable after
    the restore (reproduced: restoring v1 with v3 on disk lost v3 forever).

    """
    _HistoryRepository(_vault.get_p("VAULT")).create_file_version(
        page_id, file_path, force=force
    )


def _create_page_version_from_content(page_id: str, original_content: str) -> None:
    """Variant of `_create_page_version` that writes the original content
    directly as passed in as a parameter, without needing to `shutil.copy2` the
    file. Meant to run as a `background_task` AFTER the
    response to the client has already been sent: if we waited to copy the file
    before `save_page_md`, the user would pay an extra 50-300 ms of OneDrive I/O
    per PATCH; here we do it in the background with the content the
    handler already had in memory.

    Keeps the original 10 min cooldown.

    """
    _HistoryRepository(_vault.get_p("VAULT")).create_content_version(
        page_id, original_content
    )


_history_api.configure(
    _history_api.HistoryDependencies(
        vault_root=lambda: _vault.get_p("VAULT"),
        validate_page_id=_vault._validate_safe_page_id,
        validate_timestamp=_vault._validate_history_timestamp,
        parse_frontmatter=_vault.parse_frontmatter,
        find_page=lambda page_id: _vault.find_page_path(page_id),
        create_page_version=lambda page_id, file_path, force: _create_page_version(
            page_id, file_path, force=force
        ),
        get_table_id=_vault.get_table_id,
        recompute_formulas=_vault._recompute_cross_record_formulas_for_table,
    )
)
_history_api.register_routes(
    router,
    editor_dependencies=[Depends(_require_role("editor"))],
    admin_dependencies=[Depends(_require_role("admin"))],
)
get_page_history = _history_api.get_page_history
get_page_version_content = _history_api.get_page_version_content
restore_page_version = _history_api.restore_page_version
purge_page_history = _history_api.purge_page_history
