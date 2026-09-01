"""Property-file destination, upload, naming, and response services."""

from __future__ import annotations

import asyncio
import logging
import shutil
import uuid
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from fastapi import HTTPException, UploadFile

Metadata = dict[str, Any]
TableResolver = Callable[
    [str, Metadata],
    tuple[Metadata | None, Metadata | None],
]

log = logging.getLogger(__name__)

STORAGE_FOLDER_ALIASES = {"biblioteca": "library"}
MAX_NUMBERED_ATTEMPTS = 500


@dataclass(frozen=True)
class PropertyFileDependencies:
    """Narrow registry and path ports required by property-file uploads."""

    get_path: Callable[[str], Path]
    load_registry: Callable[[], Metadata]
    resolve_table: TableResolver
    find_property: Callable[[Metadata | None, str], Metadata | None]
    property_config_value: Callable[[Metadata | None, str], object]
    property_assets_dir: Callable[[Metadata, Metadata | None, str], Path]
    sanitize_filename: Callable[[str], str]
    sanitize_segment: Callable[[str, str], str]
    active_vault_path: Callable[[], Path]
    library_roots: Callable[[Path], Sequence[Path]]


def normalize_storage_folder(storage_folder: str) -> str:
    """Canonicalize one storage-folder key and its legacy alias."""
    key = str(storage_folder or "").strip().lower()
    return STORAGE_FOLDER_ALIASES.get(key, key)


def effective_storage_folder(configured_storage: str, requested_storage: str) -> str:
    """Select the configured storage while protecting the free-path mode."""
    effective = str(configured_storage or "").strip() or str(requested_storage or "").strip()
    if (
        normalize_storage_folder(effective) == "free"
        and normalize_storage_folder(configured_storage) != "free"
    ):
        return "assets"
    return effective


def resolve_storage_dir(
    storage_folder: str,
    table: Metadata | None,
    database: Metadata | None,
    property_name: str,
    dest_folder: str,
    dependencies: PropertyFileDependencies,
) -> tuple[Path, str]:
    """Resolve the upload target and legacy response storage kind."""
    normalized = normalize_storage_folder(storage_folder)
    if normalized == "library":
        library = dependencies.get_path("LIBRARY")
        library.mkdir(parents=True, exist_ok=True)
        return library, "absolute"
    if normalized == "free":
        chosen = str(dest_folder or "").strip()
        if not chosen:
            raise HTTPException(
                status_code=400,
                detail="dest_folder is mandatory for a 'free' storage field",
            )
        target = Path(chosen).expanduser()
        if not target.is_absolute():
            raise HTTPException(
                status_code=400,
                detail="dest_folder must be an absolute path",
            )
        if not target.is_dir():
            raise HTTPException(
                status_code=400,
                detail="dest_folder is not an existing directory",
            )
        return target, "absolute"
    if table is None:
        raise HTTPException(status_code=404, detail="Table not found")
    return dependencies.property_assets_dir(table, database, property_name), "assets"


def file_response_payload(
    destination: Path,
    url_prefix_type: str,
    dependencies: PropertyFileDependencies,
) -> dict[str, object]:
    """Build the frozen API payload for one saved or linked file."""
    if url_prefix_type == "assets":
        vault = dependencies.get_path("VAULT")
        try:
            relative = str(destination.relative_to(vault)).replace("\\", "/")
        except ValueError:
            relative = str(destination)
        url = (
            f"/api/vault/assets/{relative[len('Assets/') :]}"
            if relative.startswith("Assets/")
            else f"/api/vault/assets/{relative}"
        )
        return {"path": relative, "url": url, "storage": "assets"}

    served_url: str | None = None
    for root in dependencies.library_roots(dependencies.active_vault_path()):
        try:
            relative = str(destination.relative_to(root)).replace("\\", "/")
            served_url = f"/api/vault/library/{relative}"
            break
        except ValueError:
            continue
    return {"path": str(destination), "url": served_url, "storage": "absolute"}


def numbered_candidate(
    directory: Path,
    stem: str,
    extension: str,
    index: int,
) -> Path:
    """Build the stable numbered attachment candidate."""
    return directory / (f"{stem}{extension}" if index <= 1 else f"{stem}-{index}{extension}")


def save_uploaded_file_to_dir(
    upload: UploadFile,
    target_dir: Path,
    target_name: str,
    dependencies: PropertyFileDependencies,
) -> Path:
    """Atomically claim a numbered upload destination without overwriting."""
    target_dir.mkdir(parents=True, exist_ok=True)
    original_name = upload.filename or "upload.bin"
    extension = Path(original_name).suffix
    if target_name and target_name.strip():
        stem = dependencies.sanitize_filename(target_name.strip())
    else:
        stem = dependencies.sanitize_segment(Path(original_name).stem, "upload")
    for index in range(1, MAX_NUMBERED_ATTEMPTS + 1):
        destination = numbered_candidate(target_dir, stem, extension, index)
        try:
            handle = destination.open("xb")
        except FileExistsError:
            continue
        with handle as buffer:
            shutil.copyfileobj(upload.file, buffer)
        return destination
    destination = target_dir / f"{stem}-{uuid.uuid4().hex[:8]}{extension}"
    with destination.open("wb") as buffer:
        shutil.copyfileobj(upload.file, buffer)
    return destination


async def upload_property_file(
    *,
    table_id: str,
    property_name: str,
    storage_folder: str,
    target_name: str,
    file: UploadFile,
    dest_folder: str,
    dependencies: PropertyFileDependencies,
) -> dict[str, object]:
    """Upload one file according to the registry-owned property storage mode."""
    registry = dependencies.load_registry()
    table, database = dependencies.resolve_table(table_id, registry)
    if not table:
        raise HTTPException(status_code=404, detail="Table not found")
    property_clean = str(property_name or "").strip()
    if not property_clean:
        raise HTTPException(status_code=400, detail="property_name is mandatory")

    target_property = dependencies.find_property(table, property_clean)
    configured_storage = str(
        dependencies.property_config_value(target_property, "storage_folder") or ""
    ).strip()
    effective_storage = effective_storage_folder(configured_storage, storage_folder)
    target_dir, url_type = resolve_storage_dir(
        effective_storage,
        table,
        database,
        property_clean,
        dest_folder,
        dependencies,
    )
    try:
        destination = await asyncio.to_thread(
            save_uploaded_file_to_dir,
            file,
            target_dir,
            target_name,
            dependencies,
        )
    except Exception as exc:
        log.error("Error uploading property file: %s", exc)
        raise HTTPException(status_code=500, detail="Could not save file") from exc
    return file_response_payload(destination, url_type, dependencies)


__all__ = [
    "MAX_NUMBERED_ATTEMPTS",
    "PropertyFileDependencies",
    "effective_storage_folder",
    "file_response_payload",
    "normalize_storage_folder",
    "numbered_candidate",
    "resolve_storage_dir",
    "save_uploaded_file_to_dir",
    "upload_property_file",
]
