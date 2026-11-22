"""Read one caller-authorized vault file through its storage provider."""

from __future__ import annotations

import asyncio
import os
import stat
import sys
from functools import lru_cache
from pathlib import Path
from typing import NamedTuple

from backend.platform.files import FilesProvider, get_files_provider
from backend.platform.files import snapshots
from backend.platform.files.availability import MetadataUnavailable
from backend.platform.files.coordinated import is_cloud_placeholder
from backend.platform.files.snapshots import VaultFileSnapshot
from backend.services.context_vars import active_vault_path
from backend.utils.bounded_file_io import cloud_path


__all__ = [
    "MetadataUnavailable", "VaultFileSnapshot", "ensure_metadata_local", "guard_missing_file",
    "AllocatedFileStamp", "allocated_vault_file_stamp", "is_native_vault_file", "metadata_path", "read_metadata_bytes", "read_metadata_text",
    "read_vault_bytes", "read_vault_bytes_async", "read_vault_text", "read_vault_text_async",
    "read_vault_text_with_stat", "vault_file_snapshot", "vault_file_snapshot_async",
]


@lru_cache(maxsize=32)
def _cloud_root(root: Path, device: int, inode: int, changed: int) -> bool:
    # The stat identity invalidates this classification if an alias is retargeted.
    return bool(cloud_path(root.resolve()))


def _cloud_vault_alias(path: Path) -> Path | None:
    if sys.platform != "darwin" or cloud_path(path):
        return None
    configured = os.environ.get("DIGITAL_BRAIN_VAULT_PATH")
    for root in (active_vault_path.get(), Path(configured).expanduser() if configured else None):
        if root is not None and path.is_relative_to(root):
            try:
                info = root.stat()
                if _cloud_root(root, info.st_dev, info.st_ino, info.st_ctime_ns):
                    return root
            except OSError:
                continue
    return None


def is_native_vault_file(
    path: Path, stat_result: os.stat_result | None = None, *, provider: FilesProvider | None = None,
) -> bool:
    """Whether an allocated or dataless file is managed by native File Provider."""
    if sys.platform != "darwin":
        return False
    if stat_result is None:
        try:
            stat_result = path.stat()
        except OSError:
            pass
    placeholder = stat_result is not None and is_cloud_placeholder(path, stat_result)
    if not placeholder and not cloud_path(path) and _cloud_vault_alias(path) is None:
        return False
    adapter = provider if provider is not None else get_files_provider()
    return getattr(adapter, "warmup_mode", "coordinated") == "coordinated"


def _authorized_path(path: Path, root: Path | None) -> Path:
    path = path.absolute()
    if root is None:
        # Apple provides these aliases itself. Never resolve an untrusted leaf
        # or a directory within a vault when canonicalizing their prefix.
        if sys.platform == "darwin" and path.parts[1:2] in {("var",), ("tmp",), ("etc",)}:
            prefix = Path("/") / path.parts[1]
            canonical = Path("/private") / prefix.name
            if prefix.is_symlink() and prefix.resolve() == canonical:
                path = canonical / path.relative_to(prefix)
        return path
    alias = root.absolute()
    trusted = alias.resolve()
    if ".." in path.parts:
        raise MetadataUnavailable("File is outside the authorized root", path=path, reason="permission")
    if path.is_relative_to(alias):
        relative = path.relative_to(alias)
    elif path.is_relative_to(trusted):
        relative = path.relative_to(trusted)
    else:
        raise MetadataUnavailable("File is outside the authorized root", path=path, reason="permission")
    if any((trusted / part).is_symlink() for part in (relative, *relative.parents)):
        raise MetadataUnavailable("File path is not accessible safely", path=path, reason="permission")
    return trusted / relative


def guard_missing_file(path: Path) -> None:
    """Only a readable parent listing can establish absence for a cloud write."""
    for parent in path.parents:
        try:
            info = parent.stat()
        except (FileNotFoundError, NotADirectoryError):
            continue
        except OSError as error:
            if cloud_path(path) or get_files_provider().name != "local":
                raise MetadataUnavailable.from_oserror(path, error) from error
            raise
        if stat.S_ISDIR(info.st_mode) and is_cloud_placeholder(parent, info):
            raise MetadataUnavailable("Cloud directory is pending", path=path, reason="pending")
        return


def _inspect(path: Path, root: Path | None) -> tuple[Path, os.stat_result, bool]:
    if root is None:
        root = _cloud_vault_alias(path)
    if root is None and ".gnosi" in path.parts:
        ancestor = Path(*path.parts[:path.parts.index(".gnosi")])
        if ancestor.is_symlink():
            root = ancestor
    path = _authorized_path(path, root)
    try:
        info = path.stat()
    except FileNotFoundError:
        guard_missing_file(path)
        raise
    except OSError as error:
        if not cloud_path(path) and get_files_provider().name == "local":
            raise
        raise MetadataUnavailable.from_oserror(path, error) from error
    native = is_native_vault_file(path, info)
    if native:
        if ".." in path.parts or any(part.is_symlink() for part in (path, *path.parents)):
            raise MetadataUnavailable("Cloud file path is not accessible safely", path=path, reason="permission")
        if not stat.S_ISREG(info.st_mode):
            raise MetadataUnavailable("Cloud item is not a regular file", path=path)
    return path, info, native


class AllocatedFileStamp(NamedTuple):
    path: Path
    revision: tuple[int, ...]
    native: bool


def allocated_vault_file_stamp(path: Path, *, root: Path) -> AllocatedFileStamp | None:
    """Inspect an allocated source. Native sources also need an independent provider grant."""
    checked, info, native = _inspect(path, root)
    if (not stat.S_ISREG(info.st_mode) or is_cloud_placeholder(checked, info)
            or _legacy_provider(checked, info) is not None):
        return None
    if native:
        if not snapshots.reads.can_verify_source(checked, info):
            return None
    else:
        fd = os.open(checked, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0))
        try:
            if snapshots.revision(os.fstat(fd)) != snapshots.revision(info):
                return None
        finally:
            os.close(fd)
    return AllocatedFileStamp(checked, (*snapshots.revision(info), getattr(info, "st_flags", 0)), native)


def _on_event_loop() -> bool:
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return False
    return True


def _legacy_provider(path: Path, info: os.stat_result) -> FilesProvider | None:
    adapter = get_files_provider()
    if (adapter.name != "local" and getattr(adapter, "warmup_mode", None) != "coordinated"
            and adapter.is_online_only(path, info)):
        return adapter
    return None


async def _legacy_snapshot(path: Path, provider: FilesProvider) -> VaultFileSnapshot:
    if not await provider.materialize(path):
        raise MetadataUnavailable(path=path)
    try:
        info = await asyncio.to_thread(path.stat)
        if await asyncio.to_thread(provider.is_online_only, path, info):
            raise MetadataUnavailable("Cloud file download is pending", path=path, reason="pending")
        return VaultFileSnapshot(path, info)
    except OSError as error:
        raise MetadataUnavailable.from_oserror(path, error) from error


def vault_file_snapshot(path: Path, *, root: Path | None = None) -> VaultFileSnapshot:
    """Lease a stable native snapshot. Local files keep their normal path."""
    path, info, native = _inspect(path, root)
    if not native:
        adapter = _legacy_provider(path, info)
        if adapter is None:
            return VaultFileSnapshot(path, info)
        if _on_event_loop():
            if adapter.warmup_status(path) == "failed":
                raise MetadataUnavailable(path=path)
            adapter.schedule_warmup(path)
            raise MetadataUnavailable("Cloud file download is pending", path=path, reason="pending")
        return asyncio.run(_legacy_snapshot(path, adapter))
    on_loop = _on_event_loop()
    future = snapshots.reads.request(path, info, handoff=on_loop)
    if on_loop and not future.done():
        raise MetadataUnavailable("Cloud file download is pending", path=path, reason="pending")
    try:
        return future.result(timeout=31).lease()
    except TimeoutError as exc:
        raise MetadataUnavailable("Cloud file download is pending", path=path, reason="pending") from exc


async def vault_file_snapshot_async(
    path: Path, *, root: Path | None = None, background: bool = False,
) -> VaultFileSnapshot:
    """Wait asynchronously for this file, sharing the work across callers."""
    path, info, native = await asyncio.to_thread(_inspect, path, root)
    if not native:
        adapter = await asyncio.to_thread(_legacy_provider, path, info)
        return await _legacy_snapshot(path, adapter) if adapter is not None else VaultFileSnapshot(path, info)
    return await snapshots.await_snapshot(snapshots.reads.request(path, info, background=background))


def read_vault_text_with_stat(
    path: Path, encoding: str = "utf-8", errors: str | None = None, *, root: Path | None = None,
) -> tuple[str, os.stat_result]:
    with vault_file_snapshot(path, root=root) as snapshot:
        with snapshot.path.open("r", encoding=encoding, errors=errors) as handle:
            info = snapshot.stat_result if snapshot.is_private else os.fstat(handle.fileno())
            return handle.read(), info


def read_vault_text(
    path: Path, encoding: str = "utf-8", errors: str | None = None, *, root: Path | None = None,
) -> str:
    with vault_file_snapshot(path, root=root) as snapshot:
        return snapshot.path.read_text(encoding=encoding, errors=errors)


def read_vault_bytes(path: Path, *, root: Path | None = None) -> bytes:
    with vault_file_snapshot(path, root=root) as snapshot:
        return snapshot.path.read_bytes()


async def read_vault_text_async(
    path: Path, encoding: str = "utf-8", errors: str | None = None, *, root: Path | None = None,
) -> str:
    with await vault_file_snapshot_async(path, root=root) as snapshot:
        return await asyncio.to_thread(snapshot.path.read_text, encoding=encoding, errors=errors)


async def read_vault_bytes_async(path: Path, *, root: Path | None = None) -> bytes:
    with await vault_file_snapshot_async(path, root=root) as snapshot:
        return await asyncio.to_thread(snapshot.path.read_bytes)


def ensure_metadata_local(path: Path) -> None:
    """Guard destructive/reopen-in-place callers; absent files may be created."""
    try:
        info = path.stat()
    except FileNotFoundError:
        guard_missing_file(path)
        return
    except OSError as error:
        if cloud_path(path) or get_files_provider().name != "local":
            raise MetadataUnavailable.from_oserror(path, error) from error
        raise
    # Read and write guards must honor the same configured provider. A legacy
    # adapter can recognize an online-only regular file without Darwin flags.
    if stat.S_ISREG(info.st_mode) or is_cloud_placeholder(path, info):
        with vault_file_snapshot(path):
            pass


def read_metadata_text(path: Path, encoding: str = "utf-8", errors: str | None = None) -> str:
    return read_vault_text(path, encoding, errors)


def read_metadata_bytes(path: Path) -> bytes:
    return read_vault_bytes(path)


def metadata_path(path: Path) -> Path:
    """Keep compatibility for path-based writes, locks and legacy consumers."""
    ensure_metadata_local(path)
    return path
