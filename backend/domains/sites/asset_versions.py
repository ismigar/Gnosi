"""Preview-only reuse of verified private snapshots of unchanged local files.

Confirmation and activation still hash the original source afresh. A preview
cache hit pins the source, checks its full filesystem version, verifies the
private bytes, and checks the source again before exposing the snapshot.
"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import re

from backend.platform.files.coordinated import is_cloud_placeholder

from . import asset_files
from .storage import private_json

# Windows/Python 3.11 ctime is creation time, not an edit token.
_STRONG_CHANGE_TOKEN = os.name == "posix"


def _entry(path: Path, directory: Path) -> Path:
    folder = directory / ".source-versions"
    if folder.is_symlink():
        raise asset_files.AssetFileError("Invalid source version directory")
    return folder / (hashlib.sha256(str(path.resolve()).encode()).hexdigest() + ".json")


def cached_snapshot(path: Path, root: Path, directory: Path, maximum: int) -> tuple[str, Path] | None:
    if not _STRONG_CHANGE_TOKEN:
        return None
    entry = _entry(path, directory)
    if not entry.exists():
        return None
    if entry.is_symlink():
        raise asset_files.AssetFileError("Invalid source version record")
    with asset_files._source(path, maximum, root) as (source, _):
        info = os.fstat(source.fileno())
        if is_cloud_placeholder(path, info):
            return None
        try:
            with asset_files._source(entry, 4096, directory) as (content, _):
                version = json.loads(content.read(4097))
        except (ValueError, OSError):
            return None
        if not isinstance(version, dict) or version.get("identity") != list(asset_files._identity(info)):
            return None
        digest = version.get("digest")
        if not isinstance(digest, str) or not re.fullmatch(r"[0-9a-f]{64}", digest):
            raise asset_files.AssetFileError("Invalid source snapshot digest")
        snapshot = directory / (digest + path.suffix.lower())
        with asset_files._source(snapshot, maximum, directory) as (content, size):
            actual, copied = asset_files._chunks(content, None, maximum)
            if actual != digest or copied != size or size != info.st_size:
                raise asset_files.AssetFileError("A reviewed attachment snapshot changed")
        return digest, snapshot


def save_version(path: Path, root: Path, directory: Path, digest: str, identity: tuple[int, ...]) -> None:
    if not _STRONG_CHANGE_TOKEN:
        return
    # The completed stage already pinned and validated the descriptor/path.
    # This metadata-only check avoids opening the original a third time.
    info = path.lstat()
    if (asset_files._identity(info) != identity or is_cloud_placeholder(path, info)
            or not path.resolve().is_relative_to(root.resolve())):
        return
    entry = _entry(path, directory)
    if entry.is_symlink():
        raise asset_files.AssetFileError("Invalid source version record")
    private_json(entry, {"identity": list(identity), "digest": digest})
