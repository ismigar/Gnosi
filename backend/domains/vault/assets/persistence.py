"""Persistence and cleanup of table property asset values."""

from __future__ import annotations

import base64
import logging
import mimetypes
import re
import shutil
import urllib.parse
import uuid
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol, cast

from fastapi import UploadFile

from backend.domains.vault.registry.state import RegistryData


class AssetSegmentSanitizer(Protocol):
    def __call__(self, value: object, fallback: str) -> str: ...


TableResolver = Callable[
    [str, RegistryData],
    tuple[RegistryData | None, RegistryData | None],
]


@dataclass(frozen=True)
class TableAssetPersistenceDependencies:
    """Narrow application and filesystem ports for asset persistence."""

    get_path: Callable[[str], Path]
    is_asset_property: Callable[[RegistryData], bool]
    sanitize_segment: AssetSegmentSanitizer
    sanitize_filename: Callable[[str], str]
    write_bytes: Callable[[Path, bytes], None]
    load_registry: Callable[[], RegistryData]
    resolve_table: TableResolver
    get_table_id: Callable[[RegistryData], str | None]
    property_config_value: Callable[[RegistryData | None, str], object | None]
    normalize_schema_key: Callable[[str], str]
    property_assets_dir: Callable[[RegistryData, RegistryData | None, str], Path]
    copy_local_file: Callable[[Path, Path], str]
    save_data_url: Callable[[str, Path], str | None]
    persist_value: Callable[[object, Path], object]
    logger: logging.Logger


_dependencies: TableAssetPersistenceDependencies | None = None


def configure(dependencies: TableAssetPersistenceDependencies) -> None:
    """Configure persistence exactly once for one dependency set."""
    global _dependencies
    if _dependencies is not None and _dependencies != dependencies:
        raise RuntimeError("Table asset persistence is already configured")
    _dependencies = dependencies


def _deps() -> TableAssetPersistenceDependencies:
    if _dependencies is None:
        raise RuntimeError("Table asset persistence has not been configured")
    return _dependencies


def _registry_items(registry: RegistryData, key: str) -> list[RegistryData]:
    raw_items = registry.get(key, [])
    return [item for item in raw_items if isinstance(item, dict)]


def _database_for_table(
    table: RegistryData,
    registry: RegistryData,
) -> RegistryData | None:
    database_id = table.get("database_id")
    return next(
        (
            database
            for database in _registry_items(registry, "databases")
            if str(database.get("id")) == str(database_id)
        ),
        None,
    )


def _referenced_asset_paths(
    value: object,
) -> Iterable[str]:
    values = value if isinstance(value, list) else [value]
    for raw_path in values:
        if isinstance(raw_path, str):
            yield raw_path


def _contained_asset_path(vault_root: Path, raw_path: str) -> Path | None:
    relative = raw_path.strip()
    if not relative.startswith("Assets/"):
        return None
    assets_root = (vault_root / "Assets").resolve()
    try:
        absolute = (vault_root / relative).resolve()
        absolute.relative_to(assets_root)
    except (ValueError, OSError):
        _deps().logger.warning(
            "Asset path traversal blocked: %r is not under Assets/",
            relative,
        )
        return None
    return absolute


def _delete_referenced_asset(vault_root: Path, raw_path: str) -> None:
    absolute = _contained_asset_path(vault_root, raw_path)
    if absolute is None or not absolute.is_file():
        return
    try:
        absolute.unlink()
        _deps().logger.info("Asset deleted: %s", absolute)
    except Exception as error:
        _deps().logger.warning("Could not delete %s: %s", absolute, error)


def _delete_property_asset_files(
    page_metadata: RegistryData,
    prop: RegistryData,
) -> None:
    property_name = str(prop.get("name") or "").strip()
    if not property_name:
        return
    value: object = page_metadata.get(property_name)
    if not value:
        return
    vault_root = _deps().get_path("VAULT").resolve()
    for raw_path in _referenced_asset_paths(value):
        _delete_referenced_asset(vault_root, raw_path)


def _delete_asset_files_for_page(
    page_metadata: RegistryData,
    table: RegistryData,
    registry: RegistryData,
) -> None:
    """Delete contained asset files referenced by one record's metadata."""
    _database = _database_for_table(table, registry)
    for prop in _registry_items(table, "properties"):
        if _deps().is_asset_property(prop):
            _delete_property_asset_files(page_metadata, prop)


def _copy_local_file_to_assets(local_path: Path, target_dir: Path) -> str:
    target_dir.mkdir(parents=True, exist_ok=True)
    filename = _deps().sanitize_segment(
        local_path.name,
        f"file-{uuid.uuid4().hex[:8]}",
    )
    destination = target_dir / filename
    if destination.exists():
        stem = _deps().sanitize_segment(local_path.stem, "file")
        destination = target_dir / f"{stem}-{uuid.uuid4().hex[:8]}{local_path.suffix}"
    shutil.copy2(local_path, destination)
    return str(destination.relative_to(_deps().get_path("VAULT"))).replace(
        "\\",
        "/",
    )


def _save_uploaded_file_to_assets(
    upload: UploadFile,
    target_dir: Path,
    target_name: str = "",
) -> str:
    target_dir.mkdir(parents=True, exist_ok=True)
    original_name = upload.filename or "upload.bin"
    extension = Path(original_name).suffix
    stem = (
        _deps().sanitize_filename(target_name.strip())
        if target_name and target_name.strip()
        else _deps().sanitize_segment(Path(original_name).stem, "upload")
    )
    destination = target_dir / f"{stem}{extension}"
    if destination.exists():
        destination = target_dir / f"{stem}-{uuid.uuid4().hex[:8]}{extension}"
    with destination.open("wb") as buffer:
        shutil.copyfileobj(upload.file, buffer)
    return str(destination.relative_to(_deps().get_path("VAULT"))).replace(
        "\\",
        "/",
    )


def _decoded_data_url(value: str) -> tuple[str, bytes] | None:
    match = re.match(
        r"^data:(image/[^;]+);base64,(.+)$",
        value.strip(),
        re.IGNORECASE | re.DOTALL,
    )
    if not match:
        return None
    try:
        decoded = base64.b64decode(match.group(2), validate=True)
    except Exception:
        return None
    return match.group(1).lower(), decoded


def _save_data_url_image_to_assets(value: str, target_dir: Path) -> str | None:
    decoded = _decoded_data_url(value)
    if decoded is None:
        return None
    mime_type, payload = decoded
    extension = mimetypes.guess_extension(mime_type) or ".bin"
    if extension == ".jpe":
        extension = ".jpg"
    target_dir.mkdir(parents=True, exist_ok=True)
    destination = target_dir / f"image-{uuid.uuid4().hex[:12]}{extension}"
    _deps().write_bytes(destination, payload)
    return str(destination.relative_to(_deps().get_path("VAULT"))).replace(
        "\\",
        "/",
    )


def _persist_asset_mapping(
    value: dict[object, object],
    target_dir: Path,
) -> dict[object, object]:
    updated = dict(value)
    for key in ("path", "file_path", "url", "src"):
        if key in updated:
            updated[key] = _deps().persist_value(updated[key], target_dir)
    return updated


def _canonical_existing_asset(text: str) -> str | None:
    if text.startswith("/api/vault/assets/"):
        return "Assets/" + text[len("/api/vault/assets/") :]
    if text.startswith("Assets/"):
        return text
    if text.startswith("http://") or text.startswith("https://"):
        return text
    return None


def _persist_asset_string(value: str, target_dir: Path) -> object:
    text = value.strip()
    if not text:
        return value
    existing = _canonical_existing_asset(text)
    if existing is not None:
        return existing
    data_url_result = _deps().save_data_url(text, target_dir)
    if data_url_result:
        return data_url_result
    candidate = urllib.parse.unquote(text[7:]) if text.startswith("file://") else text
    local_path = Path(candidate).expanduser()
    try:
        if local_path.exists() and local_path.is_file():
            return _deps().copy_local_file(local_path, target_dir)
    except Exception:
        return value
    return value


def _persist_asset_value(value: object, target_dir: Path) -> object:
    if value is None:
        return value
    if isinstance(value, list):
        return [_deps().persist_value(item, target_dir) for item in value]
    if isinstance(value, dict):
        mapping = cast(dict[object, object], value)
        return _persist_asset_mapping(mapping, target_dir)
    if isinstance(value, str):
        return _persist_asset_string(value, target_dir)
    return value


def _metadata_asset_key(
    metadata: RegistryData,
    property_name: str,
) -> str | None:
    normalized_property = _deps().normalize_schema_key(property_name)
    return next(
        (key for key in metadata if _deps().normalize_schema_key(key) == normalized_property),
        None,
    )


def _persist_property_asset(
    metadata: RegistryData,
    table: RegistryData,
    database: RegistryData | None,
    prop: RegistryData,
) -> None:
    property_name = str(prop.get("name") or "").strip()
    if not property_name:
        return
    configured_storage = str(_deps().property_config_value(prop, "storage_folder") or "").strip()
    if configured_storage and configured_storage != "assets":
        return
    metadata_key = _metadata_asset_key(metadata, property_name)
    if not metadata_key:
        return
    target_dir = _deps().property_assets_dir(table, database, property_name)
    target_dir.mkdir(parents=True, exist_ok=True)
    metadata[metadata_key] = _deps().persist_value(metadata.get(metadata_key), target_dir)


def _persist_metadata_assets(metadata: RegistryData) -> RegistryData:
    if not metadata:
        return metadata
    table_id = _deps().get_table_id(metadata)
    if not table_id:
        return metadata
    registry = _deps().load_registry()
    table, database = _deps().resolve_table(str(table_id), registry)
    if not table:
        return metadata
    for prop in _registry_items(table, "properties"):
        if _deps().is_asset_property(prop):
            _persist_property_asset(metadata, table, database, prop)
    return metadata


__all__ = [
    "TableAssetPersistenceDependencies",
    "_copy_local_file_to_assets",
    "_delete_asset_files_for_page",
    "_persist_asset_value",
    "_persist_metadata_assets",
    "_save_data_url_image_to_assets",
    "_save_uploaded_file_to_assets",
    "configure",
]
