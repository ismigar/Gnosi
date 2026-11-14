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
_read_roots: ContextVar[list[tuple[Path, Path, int | None]] | None] = ContextVar("website_read_root", default=None)
_cached_parents: ContextVar[dict[Path, int] | None] = ContextVar("website_initial_parent_descriptors", default=None)
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


@contextmanager
def read_session() -> Iterator[None]:
    """Pin one canonical root for a scan; retain every per-file check."""
    existing = _read_roots.get()
    roots: list[tuple[Path, Path, int | None]] = []
    token = _read_roots.set(roots) if existing is None else None
    try:
        with bounded_file_io.session():
            yield
    finally:
        if token is not None:
            if roots and roots[0][2] is not None:
                os.close(roots[0][2])
            _read_roots.reset(token)


def _open_directory(path: Path) -> int:
    directory = os.open(path.anchor, os.O_RDONLY | os.O_DIRECTORY)
    try:
        for part in path.parts[1:]:
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=directory)
            os.close(directory)
            directory = child
        return directory
    except BaseException:
        os.close(directory)
        raise


def _canonical_root(root: Path) -> Path:
    roots = _read_roots.get()
    if roots and roots[0][0] == root:
        return roots[0][1]
    canonical = root.resolve(strict=True)
    if roots is not None and not roots:
        descriptor = (_open_directory(canonical)
                      if os.open in os.supports_dir_fd and hasattr(os, "O_NOFOLLOW") and canonical.is_dir()
                      else None)
        roots.append((root, canonical, descriptor))
    return canonical


def _open_resolved(resolved: Path) -> int:
    if os.open not in os.supports_dir_fd or not hasattr(os, "O_NOFOLLOW"):
        return os.open(resolved, os.O_RDONLY | getattr(os, "O_BINARY", 0))
    roots = _read_roots.get()
    if roots and roots[0][2] is not None and resolved.is_relative_to(roots[0][1]):
        directory = roots[0][2]
        parts = resolved.relative_to(roots[0][1]).parts
        owned = False
    else:
        directory = os.open(resolved.anchor, os.O_RDONLY | os.O_DIRECTORY)
        parts = resolved.parts[1:]
        owned = True
    try:
        for part in parts[:-1]:
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=directory)
            if owned:
                os.close(directory)
            directory, owned = child, True
        return os.open(parts[-1] if parts else ".", os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK,
                       dir_fd=directory)
    finally:
        if owned:
            os.close(directory)


@contextmanager
def parent_descriptor_cache() -> Iterator[None]:
    """Reuse initial directory handles; every source still gets a fresh end walk."""
    cache: dict[Path, int] = {}
    token = _cached_parents.set(cache)
    try:
        yield
    finally:
        for descriptor in cache.values():
            os.close(descriptor)
        _cached_parents.reset(token)


def _open_initial(path: Path) -> int:
    cache, roots = _cached_parents.get(), _read_roots.get()
    if cache is None or not roots or roots[0][2] is None or not path.is_relative_to(roots[0][1]) or ".." in path.parts:
        return _open_resolved(path)
    parent = cache.get(path.parent)
    if parent is None:
        if len(cache) >= 64:
            return _open_resolved(path)
        parent = _open_resolved(path.parent)
        if not stat.S_ISDIR(os.fstat(parent).st_mode):
            os.close(parent)
            raise AssetFileError("Invalid selected file directory")
        cache[path.parent] = parent
    return os.open(path.name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent)


@contextmanager
def _source(path: Path, maximum: int, root: Path | None = None) -> Iterator[tuple[BinaryIO, int]]:
    if path.is_symlink():
        raise AssetFileError("A selected attachment is a symbolic link")
    roots = _read_roots.get()
    pinned_root = roots[0] if root is not None and roots and roots[0][0] == root and roots[0][2] is not None else None
    fast = False
    if pinned_root is not None and path.is_relative_to(pinned_root[1]) and ".." not in path.parts:
        # Walk beneath the already-open authorized root, rejecting every alias.
        # This avoids repeatedly resolving all cloud-provider ancestors per file.
        try:
            descriptor = _open_initial(path)
            resolved, fast = path, True
        except OSError:
            pinned_root = None
    if not fast:
        resolved = path.resolve(strict=True)
        if root is not None and not resolved.is_relative_to(_canonical_root(root)):
            raise AssetFileError("A selected attachment is outside the vault")
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
        if fast and pinned_root is not None and pinned_root[2] is not None:
            # A second no-follow walk verifies every parent and the named file;
            # also reject replacement of the authorized root itself.
            try:
                current = _open_resolved(path)
            except OSError as error:
                raise SourceChanged("A selected attachment path changed while it was being read") from error
            try:
                root_now = pinned_root[1].lstat()
                root_open = os.fstat(pinned_root[2])
                changed = (_identity(before) != _identity(os.fstat(current))
                           or (root_now.st_dev, root_now.st_ino) != (root_open.st_dev, root_open.st_ino))
            finally:
                os.close(current)
        else:
            changed = _identity(before) != _identity(resolved.lstat()) or path.resolve(strict=True) != resolved
        if _identity(before) != _identity(os.fstat(stream.fileno())) or changed:
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
