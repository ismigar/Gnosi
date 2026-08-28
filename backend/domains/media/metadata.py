"""Vault-synchronized user metadata for media files."""

from __future__ import annotations

import json
import logging
from _thread import RLock
from collections.abc import Callable, Iterable, Mapping
from pathlib import Path
from typing import Protocol, cast

from backend.domains.media.types import HydratedUserMetadata, UserMetadataItem, UserMetadataStore


class MetadataService(Protocol):
    """Facade state and late-bound methods needed by metadata operations."""

    _user_metadata: UserMetadataStore | None
    _user_metadata_lock: RLock

    def _root_dir(self, root: str = "images") -> Path | None: ...

    def _ensure_user_metadata_loaded(self) -> None: ...

    def _save_user_metadata(self) -> bool: ...

    def _user_meta_key(self, root: str, rel_path_in_root: str) -> str: ...


def user_meta_path(
    active_vault_path: Callable[[], Path | None],
    filename: str,
    logger: logging.Logger,
) -> Path | None:
    """Return the metadata sidecar path, creating its private folder."""
    base = active_vault_path()
    if base is None:
        return None
    directory = base / ".gnosi"
    try:
        directory.mkdir(parents=True, exist_ok=True)
    except OSError as error:
        logger.debug(f"Could not create {directory}: {error}")
        return None
    return directory / filename


def ensure_user_metadata_loaded(
    service: MetadataService,
    metadata_path: Callable[[], Path | None],
    logger: logging.Logger,
) -> None:
    """Load the metadata sidecar once under the historical re-entrant lock."""
    if service._user_metadata is not None:
        return
    with service._user_metadata_lock:
        if service._user_metadata is not None:
            return
        path = metadata_path()
        loaded: UserMetadataStore = {"version": 1, "items": {}}
        if path and path.exists():
            try:
                with path.open("r", encoding="utf-8") as handle:
                    raw = cast(object, json.load(handle))
                if isinstance(raw, dict) and isinstance(raw.get("items"), dict):
                    loaded = cast(UserMetadataStore, raw)
            except (OSError, json.JSONDecodeError) as error:
                logger.warning(f"media_metadata.json corrupte ({path}): {error} — reinicialitzant")
        service._user_metadata = loaded


def user_meta_key(root: str, rel_path_in_root: str) -> str:
    """Build the stable sidecar key for one media path."""
    return f"{root}::{rel_path_in_root}"


def save_user_metadata(
    service: MetadataService,
    path: Path | None,
    replace_file: Callable[[Path, Path], None],
    logger: logging.Logger,
) -> bool:
    """Atomically persist the current metadata payload."""
    if path is None:
        return False
    with service._user_metadata_lock:
        try:
            temporary = path.with_suffix(path.suffix + ".tmp")
            with temporary.open("w", encoding="utf-8") as handle:
                json.dump(service._user_metadata, handle, ensure_ascii=False, indent=2)
            replace_file(temporary, path)
            return True
        except OSError as error:
            logger.warning(f"Could not save media_metadata.json: {error}")
            return False


def get_user_meta_for(
    service: MetadataService,
    root: str,
    rel_path_in_root: str,
) -> HydratedUserMetadata:
    """Return tags and description, applying historical defaults."""
    service._ensure_user_metadata_loaded()
    store = cast(UserMetadataStore, service._user_metadata)
    item = store["items"].get(service._user_meta_key(root, rel_path_in_root))
    if not item:
        return {"tags": [], "description": ""}
    return {
        "tags": list(item.get("tags") or []),
        "description": str(item.get("description") or ""),
    }


def _normalized_tags(
    metadata: Mapping[str, object],
    existing: UserMetadataItem,
) -> list[str]:
    if "tags" not in metadata:
        return list(existing.get("tags") or [])
    raw_tags = cast(Iterable[str | None], metadata.get("tags") or [])
    return sorted({(tag or "").strip().lower() for tag in raw_tags if (tag or "").strip()})


def _normalized_description(
    metadata: Mapping[str, object],
    existing: UserMetadataItem,
) -> str:
    if "description" in metadata:
        return str(metadata.get("description") or "")
    return str(existing.get("description") or "")


def update_metadata(
    service: MetadataService,
    path_in_root: str,
    metadata: Mapping[str, object],
    root: str,
    *,
    now_iso: Callable[[], str],
    logger: logging.Logger,
) -> bool:
    """Validate, normalize, and persist one media metadata entry."""
    if not path_in_root:
        return False
    root_directory = service._root_dir(root)
    if root_directory is None:
        return False
    try:
        (root_directory / path_in_root).resolve().relative_to(root_directory.resolve())
    except ValueError:
        logger.warning(f"update_metadata: path outside root {root!r}: {path_in_root!r}")
        return False

    service._ensure_user_metadata_loaded()
    store = cast(UserMetadataStore, service._user_metadata)
    key = service._user_meta_key(root, path_in_root)
    with service._user_metadata_lock:
        existing = store["items"].get(key, {})
        store["items"][key] = {
            "tags": _normalized_tags(metadata, existing),
            "description": _normalized_description(metadata, existing),
            "updated_at": now_iso(),
        }
    return service._save_user_metadata()
