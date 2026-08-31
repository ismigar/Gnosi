"""Provider-neutral persistence for Tldraw and legacy Excalidraw documents."""

from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import cast

JsonObject = dict[str, object]
DrawingSummary = dict[str, object]


class DrawingNotFoundError(FileNotFoundError):
    """Raised when neither supported drawing representation exists."""


class DrawingReadError(RuntimeError):
    """Raised when a drawing exists but cannot be decoded."""


class DrawingWriteError(RuntimeError):
    """Raised when a drawing cannot be persisted."""


@dataclass(frozen=True)
class DrawingDependencies:
    """Filesystem, trash, time, serialization, and logging ports."""

    drawings_directory: Callable[[], Path]
    vault_root: Callable[[], Path]
    move_to_trash: Callable[[str, Path], JsonObject]
    trash_entry_directory: Callable[[str], Path]
    write_drawing_json: Callable[[Path, object], None]
    write_trash_json: Callable[[Path, object], None]
    copy_file: Callable[[Path, Path], object]
    current_time: Callable[[], float]
    timestamp_label: Callable[[], str]
    modified_iso: Callable[[float], str]
    logger: logging.Logger
    backup_cooldown: float = 600.0


def _read_object(file_path: Path) -> JsonObject:
    loaded: object = json.loads(file_path.read_text(encoding="utf-8"))
    if not isinstance(loaded, dict):
        raise ValueError("drawing payload must be a JSON object")
    return cast(JsonObject, loaded)


def _drawing_path(drawing_id: str, dependencies: DrawingDependencies) -> Path:
    drawings_directory = dependencies.drawings_directory()
    current = drawings_directory / f"{drawing_id}.tldraw.json"
    if current.exists():
        return current
    legacy = drawings_directory / f"{drawing_id}.excalidraw.json"
    if legacy.exists():
        return legacy
    raise DrawingNotFoundError(drawing_id)


def _list_drawings(dependencies: DrawingDependencies) -> list[DrawingSummary]:
    drawings_directory = dependencies.drawings_directory()
    drawings_directory.mkdir(parents=True, exist_ok=True)
    drawings: list[DrawingSummary] = []
    seen_ids: set[str] = set()
    for file_path in drawings_directory.glob("*.tldraw.json"):
        drawing_id = file_path.stem.replace(".tldraw", "")
        seen_ids.add(drawing_id)
        try:
            stat_result = file_path.stat()
            payload = _read_object(file_path)
            drawings.append(
                {
                    "id": drawing_id,
                    "title": payload.get("title", drawing_id),
                    "last_modified": dependencies.modified_iso(stat_result.st_mtime),
                    "size": stat_result.st_size,
                }
            )
        except Exception as error:
            dependencies.logger.warning(
                "Error reading drawing %s: %s",
                file_path.name,
                error,
            )
    for file_path in drawings_directory.glob("*.excalidraw.json"):
        drawing_id = file_path.stem.replace(".excalidraw", "")
        if drawing_id in seen_ids:
            continue
        try:
            stat_result = file_path.stat()
            payload = _read_object(file_path)
            raw_metadata = payload.get("metadata")
            metadata = raw_metadata if isinstance(raw_metadata, dict) else {}
            drawings.append(
                {
                    "id": drawing_id,
                    "title": metadata.get("title", drawing_id),
                    "last_modified": dependencies.modified_iso(stat_result.st_mtime),
                    "size": stat_result.st_size,
                }
            )
        except Exception as error:
            dependencies.logger.warning(
                "Error reading drawing %s: %s",
                file_path.name,
                error,
            )
    return drawings


async def list_drawings(
    dependencies: DrawingDependencies,
) -> list[DrawingSummary]:
    """List current and legacy drawing summaries without blocking the event loop."""
    return await asyncio.to_thread(_list_drawings, dependencies)


async def get_drawing(drawing_id: str, dependencies: DrawingDependencies) -> object:
    """Return the inner Tldraw data or the complete legacy Excalidraw payload."""
    try:
        payload = await asyncio.to_thread(
            lambda: _read_object(_drawing_path(drawing_id, dependencies))
        )
        return payload["data"] if "data" in payload else payload
    except DrawingNotFoundError:
        raise
    except Exception as error:
        dependencies.logger.error(
            "Error reading drawing %s: %s",
            drawing_id,
            error,
        )
        raise DrawingReadError(drawing_id) from error


def backup_drawing_version(
    drawing_id: str,
    file_path: Path,
    dependencies: DrawingDependencies,
) -> None:
    """Create a cooldown-limited copy before overwriting a current drawing."""
    if not file_path.exists():
        return
    history_directory = dependencies.vault_root() / ".history" / drawing_id
    history_directory.mkdir(parents=True, exist_ok=True)
    versions = sorted(history_directory.glob("*.tldraw.json"))
    if versions:
        try:
            if (
                dependencies.current_time() - versions[-1].stat().st_mtime
                < dependencies.backup_cooldown
            ):
                return
        except Exception:
            pass
    version_path = history_directory / f"{dependencies.timestamp_label()}.tldraw.json"
    try:
        dependencies.copy_file(file_path, version_path)
        dependencies.logger.info("Drawing version created: %s", version_path)
    except Exception as error:
        dependencies.logger.warning(
            "Could not create drawing version for %s: %s",
            drawing_id,
            error,
        )


async def save_drawing(
    drawing_id: str,
    title: str,
    data: JsonObject,
    metadata: JsonObject,
    dependencies: DrawingDependencies,
) -> DrawingSummary:
    """Persist a Tldraw document and snapshot its previous version."""
    file_path = dependencies.drawings_directory() / f"{drawing_id}.tldraw.json"
    payload: JsonObject = {"title": title, "data": data, "metadata": metadata}

    def write() -> None:
        dependencies.drawings_directory().mkdir(parents=True, exist_ok=True)
        backup_drawing_version(drawing_id, file_path, dependencies)
        dependencies.write_drawing_json(file_path, payload)

    try:
        await asyncio.to_thread(write)
        return {"status": "success", "id": drawing_id}
    except Exception as error:
        dependencies.logger.error(
            "Error saving drawing %s: %s",
            drawing_id,
            error,
        )
        raise DrawingWriteError(drawing_id) from error


def _delete_drawing(
    drawing_id: str,
    dependencies: DrawingDependencies,
) -> DrawingSummary:
    file_path = _drawing_path(drawing_id, dependencies)
    title = ""
    try:
        title = str(_read_object(file_path).get("title") or "")
    except Exception:
        pass
    sidecar = dependencies.move_to_trash(drawing_id, file_path)
    if title and not sidecar.get("title"):
        sidecar["title"] = title
        dependencies.write_trash_json(
            dependencies.trash_entry_directory(drawing_id) / "_trash.json",
            sidecar,
        )
    return {
        "status": "soft_deleted",
        "id": drawing_id,
        "deleted_at": sidecar.get("deleted_at"),
        "title": sidecar.get("title") or title,
    }


async def delete_drawing(
    drawing_id: str,
    dependencies: DrawingDependencies,
) -> DrawingSummary:
    """Move a drawing to the shared recoverable Vault trash."""
    return await asyncio.to_thread(_delete_drawing, drawing_id, dependencies)


__all__ = [
    "DrawingDependencies",
    "DrawingNotFoundError",
    "DrawingReadError",
    "DrawingSummary",
    "DrawingWriteError",
    "JsonObject",
    "backup_drawing_version",
    "delete_drawing",
    "get_drawing",
    "list_drawings",
    "save_drawing",
]
