"""Bounded immutable copies of explicitly selected public attachments."""
from __future__ import annotations

from contextlib import contextmanager
from contextvars import ContextVar
from collections.abc import Iterator
import hashlib
import os
from pathlib import Path
import stat
import tempfile
from typing import BinaryIO

from backend.utils import bounded_file_io

PUBLIC_ATTACHMENT_MAX_BYTES = 32_000_000
PUBLIC_PDF_MAX_BYTES = 1024 ** 3
_CHUNK_BYTES = 1024 * 1024
_READ_ATTEMPTS = 3
_cloud_source: ContextVar[bool] = ContextVar("website_cloud_source", default=False)


class AssetFileError(ValueError):
    """The selected or reviewed file cannot be copied consistently."""


class AssetTooLarge(AssetFileError):
    """The explicitly selected attachment exceeds its bounded allowance."""


class SourceChanged(AssetFileError):
    """Discard this attempt because its open source changed during the read."""


def attachment_limit(suffix: str) -> int:
    return PUBLIC_PDF_MAX_BYTES if suffix.lower() == ".pdf" else PUBLIC_ATTACHMENT_MAX_BYTES


def _identity(info: os.stat_result) -> tuple[int, ...]:
    return (info.st_dev, info.st_ino, info.st_mode, info.st_size,
            info.st_mtime_ns, info.st_ctime_ns)


def _open_resolved(resolved: Path) -> int:
    if os.open not in os.supports_dir_fd or not hasattr(os, "O_NOFOLLOW"):
        # Windows has no openat directory traversal. Descriptor/path identity
        # and resolved-path checks below still precede exposing any copy.
        return os.open(resolved, os.O_RDONLY | getattr(os, "O_BINARY", 0))
    directory = os.open(resolved.anchor, os.O_RDONLY | os.O_DIRECTORY)
    try:
        for part in resolved.parent.parts[1:]:
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=directory)
            os.close(directory)
            directory = child
        return os.open(resolved.name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK,
                       dir_fd=directory)
    finally:
        os.close(directory)


@contextmanager
def _source(path: Path, maximum: int, root: Path | None = None) -> Iterator[tuple[BinaryIO, int]]:
    if path.is_symlink():
        raise AssetFileError("A selected attachment is a symbolic link")
    resolved = path.resolve(strict=True)
    if root is not None and not resolved.is_relative_to(root.resolve(strict=True)):
        raise AssetFileError("A selected attachment is outside the vault")
    # Pin every directory in the resolved path so a concurrent parent-link
    # replacement cannot redirect the open outside the authorized tree.
    descriptor = _open_resolved(resolved)
    with os.fdopen(descriptor, "rb") as stream:
        before = os.fstat(stream.fileno())
        if not stat.S_ISREG(before.st_mode):
            raise AssetFileError("A selected attachment is not a regular file")
        if before.st_size > maximum:
            raise AssetTooLarge("A selected attachment exceeds the publication size limit")
        token = _cloud_source.set(bounded_file_io.cloud_path(resolved))
        try:
            yield stream, before.st_size
        finally:
            _cloud_source.reset(token)
        if (_identity(before) != _identity(os.fstat(stream.fileno()))
                or _identity(before) != _identity(resolved.lstat())
                or path.resolve(strict=True) != resolved):
            raise SourceChanged("A selected attachment changed while it was being read")


def read_selected_bytes(path: Path, root: Path, maximum: int) -> bytes:
    """Retry a complete bounded read, never bytes from an unstable attempt.

    Cloud hydration can update stat metadata while delivering a file. Each
    attempt still pins the source and requires unchanged descriptor/path
    identities. A continuously changing source remains unavailable.
    """
    for attempt in range(_READ_ATTEMPTS):
        try:
            with _source(path, maximum, root) as (source, size):
                if _cloud_source.get():
                    try:
                        raw, _, _ = bounded_file_io.transfer(source.fileno(), maximum)
                    except bounded_file_io.ReadUnavailable as error:
                        raise AssetFileError("A cloud source could not be read within its deadline") from error
                else:
                    raw = source.read(maximum + 1)
                if len(raw) > maximum:
                    raise AssetTooLarge("A selected file exceeds the publication size limit")
                if len(raw) != size:
                    raise SourceChanged("A selected file changed while it was being read")
            return raw
        except SourceChanged:
            if attempt == _READ_ATTEMPTS - 1:
                raise
    raise AssertionError("No source read attempted")


def _chunks(source: BinaryIO, target: BinaryIO | None, maximum: int) -> tuple[str, int]:
    if _cloud_source.get():
        try:
            _, cloud_digest, total = bounded_file_io.transfer(
                source.fileno(), maximum, target.fileno() if target is not None else None,
                read_bytes=False)
            return cloud_digest, total
        except bounded_file_io.ReadUnavailable as error:
            raise AssetFileError("A cloud attachment could not be read within its deadline") from error
    digest = hashlib.sha256()
    total = 0
    while chunk := source.read(min(_CHUNK_BYTES, maximum - total + 1)):
        total += len(chunk)
        if total > maximum:
            raise AssetTooLarge("A selected attachment exceeds the publication size limit")
        digest.update(chunk)
        if target is not None:
            target.write(chunk)
    return digest.hexdigest(), total


def _stage(path: Path, directory: Path, maximum: int, *, root: Path | None = None,
           expected: str | None = None, version: list[tuple[int, ...]] | None = None) -> tuple[Path, str]:
    temporary = None
    try:
        with _source(path, maximum, root) as (source, size):
            if version is not None:
                version.append(_identity(os.fstat(source.fileno())))
            descriptor, name = tempfile.mkstemp(prefix=".gnosi-asset-", dir=directory)
            temporary = Path(name)
            with os.fdopen(descriptor, "wb") as target:
                digest, copied = _chunks(source, target, maximum)
            if copied != size:
                raise SourceChanged("A selected attachment changed while it was being read")
            if expected is not None and digest != expected:
                raise AssetFileError("A reviewed asset changed before construction")
        return temporary, digest
    except BaseException:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
        raise


def snapshot_asset(path: Path, root: Path, directory: Path, *, reuse_source_version: bool = False) -> tuple[str, Path]:
    """Hash and stage bounded chunks; expose the snapshot only after validation."""
    if directory.is_symlink():
        raise AssetFileError("Invalid attachment snapshot directory")
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    maximum = attachment_limit(path.suffix)
    from .asset_versions import cached_snapshot, save_version
    if reuse_source_version:
        cached = cached_snapshot(path, root, directory, maximum)
        if cached is not None:
            return cached
    for attempt in range(_READ_ATTEMPTS):
        try:
            version: list[tuple[int, ...]] = []
            temporary, digest = _stage(path, directory, maximum, root=root, version=version)
            break
        except SourceChanged:
            if attempt == _READ_ATTEMPTS - 1:
                raise
    snapshot = directory / (digest + path.suffix.lower())
    try:
        if snapshot.exists() or snapshot.is_symlink():
            with _source(snapshot, maximum, directory) as (source, size):
                actual, copied = _chunks(source, None, maximum)
                if actual != digest or copied != size:
                    raise AssetFileError("A reviewed attachment snapshot changed")
        else:
            os.replace(temporary, snapshot)
        save_version(path, root, directory, digest, version[0])
        return digest, snapshot
    finally:
        temporary.unlink(missing_ok=True)


def copy_reviewed_asset(source: Path, target: Path, expected: str) -> None:
    """Verify a private snapshot while streaming it into an atomic public copy."""
    temporary, _ = _stage(source, target.parent, PUBLIC_PDF_MAX_BYTES, expected=expected)
    try:
        temporary.chmod(0o644)
        os.replace(temporary, target)
    finally:
        temporary.unlink(missing_ok=True)
