"""Private, no-clobber filesystem primitives for reference configuration migration."""

from __future__ import annotations

import hashlib
import importlib
import json
import os
import stat
import tempfile
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Protocol, cast


class WindowsFileLock(Protocol):
    """Narrow msvcrt adapter (host stubs do not expose Windows-only members)."""

    LK_NBLCK: int
    LK_UNLCK: int

    def locking(self, descriptor: int, mode: int, count: int, /) -> None: ...


class ReferenceMigrationError(RuntimeError):
    """An explicit migration cannot proceed without operator recovery."""


def checked_path(value: str | Path) -> Path:
    """Reject relative, traversing and symlinked paths without resolving links."""
    path = Path(value)
    if not path.is_absolute() or ".." in path.parts or path == path.parent:
        raise ReferenceMigrationError("Use an absolute non-root path without parent traversal")
    for candidate in (*reversed(path.parents), path):
        if candidate.is_symlink():
            raise ReferenceMigrationError(f"Symlink paths are not supported: {candidate}")
    return path


def read_regular(path: Path) -> bytes:
    """Read a regular file without following a final symlink or leaking its bytes."""
    checked_path(path)
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0)
    try:
        with os.fdopen(os.open(path, flags), "rb") as stream:
            if not stat.S_ISREG(os.fstat(stream.fileno()).st_mode):
                raise ReferenceMigrationError(f"Not a regular file: {path}")
            return stream.read()
    except OSError as error:
        raise ReferenceMigrationError(f"Cannot read migration file: {path}") from error


def configuration_bytes(path: Path) -> bytes:
    """Validate object-valued JSON, preserving all original bytes and unknown fields."""
    data = read_regular(path)
    try:
        # Match runtime's UTF-8 reader; bytes-based json.loads also accepts UTF-16,
        # which would migrate successfully but then be unreadable by the app.
        parsed: object = json.loads(data.decode("utf-8"))
    except (ValueError, UnicodeError):
        raise ReferenceMigrationError(f"Configuration is not valid JSON: {path}") from None
    if not isinstance(parsed, dict):
        raise ReferenceMigrationError(f"Configuration must contain a JSON object: {path}")
    return data


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sync_directory(path: Path) -> None:
    """Persist directory entries where supported (Windows has no directory fsync)."""
    if os.name == "nt":
        return
    descriptor = os.open(path, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def write_exclusive(path: Path, data: bytes) -> None:
    """Create a private payload without replacing any existing object."""
    checked_path(path)
    with os.fdopen(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "wb") as stream:
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())
    sync_directory(path.parent)


def link_exclusive(source: Path, destination: Path) -> None:
    """Publish atomically; unsupported filesystems fail without an unsafe fallback."""
    checked_path(source)
    checked_path(destination)
    try:
        os.link(source, destination)
        sync_directory(destination.parent)
    except OSError as error:
        raise ReferenceMigrationError(
            "Exclusive publication failed; preserve the journal and payload, "
            "check for a competing file and local hard-link support"
        ) from error


def write_journal(path: Path, data: bytes) -> None:
    """Replace this transaction's journal atomically without importing runtime config."""
    checked_path(path)
    descriptor, name = tempfile.mkstemp(prefix=".references-journal-", dir=path.parent)
    temporary = Path(name)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        sync_directory(path.parent)
    finally:
        temporary.unlink(missing_ok=True)


@contextmanager
def migration_lock(journal: Path) -> Iterator[None]:
    """Serialize operators, releasing the OS lock even if a process terminates."""
    path = checked_path(journal.with_suffix(".lock"))
    flags = os.O_RDWR | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0)
    with os.fdopen(os.open(path, flags, 0o600), "r+b") as stream:
        if not stat.S_ISREG(os.fstat(stream.fileno()).st_mode):
            raise ReferenceMigrationError("Migration lock is not a regular file")
        if os.name == "nt":
            # Localized third-party adapter; migration records/results remain checked.
            msvcrt = cast(WindowsFileLock, importlib.import_module("msvcrt"))

            if not os.fstat(stream.fileno()).st_size:
                stream.write(b"\0")
                stream.flush()
            stream.seek(0)
            try:
                msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
            except OSError as error:
                raise ReferenceMigrationError("Another reference migration is running") from error
        else:
            import fcntl

            try:
                fcntl.flock(stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            except OSError as error:
                raise ReferenceMigrationError("Another reference migration is running") from error
        try:
            yield
        finally:
            if os.name == "nt":
                stream.seek(0)
                msvcrt.locking(stream.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(stream.fileno(), fcntl.LOCK_UN)
