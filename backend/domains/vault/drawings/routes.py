"""Typed Vault domain extracted from the historical route facade."""

import importlib as _legacy_importlib
from typing import Any as _LegacyAny

_legacy: _LegacyAny = _legacy_importlib.import_module("backend.api.vault_routes")

_DRAWING_DEPENDENCIES = _legacy.drawing_service.DrawingDependencies(
    drawings_directory=lambda: _legacy.get_p("DIBUIXOS"),
    vault_root=lambda: _legacy.get_p("VAULT"),
    move_to_trash=lambda drawing_id, path: _legacy.cast(
        _legacy.drawing_service.JsonObject, _legacy._move_page_to_trash(drawing_id, path)
    ),
    trash_entry_directory=lambda drawing_id: _legacy._trash_entry_dir(drawing_id),
    write_drawing_json=lambda path, payload: _legacy.safe_write_json(
        path, payload, indent=2, ensure_ascii=False
    ),
    write_trash_json=lambda path, payload: _legacy.safe_write_json(path, payload, indent=2),
    copy_file=lambda source, target: _legacy.shutil.copy2(source, target),
    current_time=_legacy.time.time,
    timestamp_label=lambda: _legacy.datetime.now().strftime("%Y%m%d_%H%M%S"),
    modified_iso=lambda timestamp: _legacy.datetime.fromtimestamp(timestamp).isoformat(),
    logger=_legacy.log,
)


@_legacy.router.get("/drawings", response_model=None)
async def list_drawings() -> _LegacyAny:
    """Lists all drawings in the vault (tldraw and excalidraw)."""
    return await _legacy.drawing_service.list_drawings(_DRAWING_DEPENDENCIES)


@_legacy.router.get("/drawings/{drawing_id}", response_model=None)
async def get_drawing(drawing_id: str) -> _LegacyAny:
    """Returns the data of a Tldraw drawing."""
    try:
        return await _legacy.drawing_service.get_drawing(drawing_id, _DRAWING_DEPENDENCIES)
    except _legacy.drawing_service.DrawingNotFoundError:
        raise _legacy.HTTPException(status_code=404, detail="Drawing not found")
    except _legacy.drawing_service.DrawingReadError:
        raise _legacy.HTTPException(status_code=500, detail="Error reading target file")


def _backup_drawing_version(drawing_id: str, file_path: _legacy.Path) -> None:
    """Copies the current .tldraw.json to .history/{id}/{ts}.tldraw.json before
    overwriting it. Last line of defense against clients that save an empty
    canvas after a failed load (directive tldraw_save_integrity.md).
    Same 10 min cooldown as `_create_page_version`: also prevents a broken
    client saving in a loop from clobbering the good backup with empty versions.

    """
    _legacy.drawing_service.backup_drawing_version(drawing_id, file_path, _DRAWING_DEPENDENCIES)


@_legacy.router.put(
    "/drawings/{drawing_id}",
    dependencies=[_legacy.Depends(_legacy.require_role("editor"))],
    response_model=None,
)
async def save_drawing(drawing_id: str, request: _legacy.DrawingSaveRequest) -> _LegacyAny:
    """Saves or updates a Tldraw drawing."""
    try:
        return await _legacy.drawing_service.save_drawing(
            drawing_id,
            request.title,
            _legacy.cast(_legacy.drawing_service.JsonObject, request.data),
            _legacy.cast(_legacy.drawing_service.JsonObject, request.metadata or {}),
            _DRAWING_DEPENDENCIES,
        )
    except _legacy.drawing_service.DrawingWriteError:
        raise _legacy.HTTPException(status_code=500, detail="Error writing target file")


@_legacy.router.delete(
    "/drawings/{drawing_id}",
    dependencies=[_legacy.Depends(_legacy.require_role("editor"))],
    response_model=None,
)
async def delete_drawing(drawing_id: str) -> _LegacyAny:
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
    drawing_id = _legacy._validate_safe_page_id(drawing_id)
    try:
        return await _legacy.drawing_service.delete_drawing(drawing_id, _DRAWING_DEPENDENCIES)
    except _legacy.drawing_service.DrawingNotFoundError:
        raise _legacy.HTTPException(status_code=404, detail="Drawing not found")


def _create_page_version(page_id: str, file_path: _legacy.Path, force: bool = False) -> _LegacyAny:
    """Saves a version of the current file to .history/{page_id}/{timestamp}.md if cooldown passed.

    `force=True` skips the cooldown: it's for the SAFETY snapshots
    of explicit actions (e.g. the "state right before the restore"). The
    cooldown is meant to avoid saturating with autosaves; applying it also to
    the pre-restore snapshot meant that, if you had edited less than 10 min ago,
    the current state would be SILENTLY discarded and become unrecoverable after
    the restore (reproduced: restoring v1 with v3 on disk lost v3 forever).

    """
    _legacy.HistoryRepository(_legacy.get_p("VAULT")).create_file_version(
        page_id, file_path, force=force
    )


def _create_page_version_from_content(page_id: str, original_content: str) -> _LegacyAny:
    """Variant of `_create_page_version` that writes the original content
    directly as passed in as a parameter, without needing to `shutil.copy2` the
    file. Meant to run as a `background_task` AFTER the
    response to the client has already been sent: if we waited to copy the file
    before `save_page_md`, the user would pay an extra 50-300 ms of OneDrive I/O
    per PATCH; here we do it in the background with the content the
    handler already had in memory.

    Keeps the original 10 min cooldown.

    """
    _legacy.HistoryRepository(_legacy.get_p("VAULT")).create_content_version(
        page_id, original_content
    )


_legacy.history_api.configure(
    _legacy.history_api.HistoryDependencies(
        vault_root=lambda: _legacy.get_p("VAULT"),
        validate_page_id=_legacy._validate_safe_page_id,
        validate_timestamp=_legacy._validate_history_timestamp,
        parse_frontmatter=_legacy.parse_frontmatter,
        find_page=lambda page_id: _legacy.find_page_path(page_id),
        create_page_version=lambda page_id, file_path, force: _create_page_version(
            page_id, file_path, force=force
        ),
        get_table_id=_legacy.get_table_id,
        recompute_formulas=_legacy._recompute_cross_record_formulas_for_table,
    )
)
_legacy.history_api.register_routes(
    _legacy.router,
    editor_dependencies=[_legacy.Depends(_legacy.require_role("editor"))],
    admin_dependencies=[_legacy.Depends(_legacy.require_role("admin"))],
)
get_page_history = _legacy.history_api.get_page_history
get_page_version_content = _legacy.history_api.get_page_version_content
restore_page_version = _legacy.history_api.restore_page_version
purge_page_history = _legacy.history_api.purge_page_history
