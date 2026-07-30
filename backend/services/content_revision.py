"""Stable content revisions for confirmed filesystem operations."""
from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Iterable, Tuple


_READ_CHUNK_BYTES = 1024 * 1024


def _update_file_digest(digest: "hashlib._Hash", path: Path) -> None:
    with path.open("rb") as handle:
        while chunk := handle.read(_READ_CHUNK_BYTES):
            digest.update(chunk)


def tree_revision(root: Path) -> str:
    """Hash every path, type, symlink target, and file byte below ``root``."""
    root = Path(root)
    digest = hashlib.sha256()
    if not root.exists() and not root.is_symlink():
        digest.update(b"missing\0")
        return digest.hexdigest()

    candidates = [root]
    if root.is_dir() and not root.is_symlink():
        candidates.extend(sorted(root.rglob("*"), key=lambda item: item.as_posix()))

    for path in candidates:
        relative = "." if path == root else path.relative_to(root).as_posix()
        digest.update(relative.encode("utf-8", errors="surrogateescape"))
        digest.update(b"\0")
        if path.is_symlink():
            digest.update(b"symlink\0")
            digest.update(path.readlink().as_posix().encode("utf-8"))
        elif path.is_dir():
            digest.update(b"directory\0")
        elif path.is_file():
            digest.update(b"file\0")
            _update_file_digest(digest, path)
        else:
            digest.update(b"other\0")
    return digest.hexdigest()


def path_collection_revision(entries: Iterable[Tuple[str, Path]]) -> str:
    """Hash a labeled collection of filesystem trees, including missing roots."""
    digest = hashlib.sha256()
    for label, path in sorted(entries, key=lambda item: item[0]):
        digest.update(str(label).encode("utf-8", errors="surrogateescape"))
        digest.update(b"\0")
        digest.update(tree_revision(Path(path)).encode("ascii"))
        digest.update(b"\0")
    return digest.hexdigest()
