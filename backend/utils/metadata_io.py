"""Bounded, read-only cloud hydration for Vault metadata.

Callers retain responsibility for Vault authorization. Only paths inside a
literal .gnosi directory are hydrated; local files and other paths are unchanged.
"""
from __future__ import annotations

import asyncio
import threading
import time
from concurrent.futures import Future, ThreadPoolExecutor
from pathlib import Path

from backend.platform.files.coordinated import is_cloud_placeholder, materialize_coordinated


class MetadataUnavailable(RuntimeError):
    """Metadata exists remotely but is not currently readable locally."""


_pool = ThreadPoolExecutor(max_workers=2, thread_name_prefix="gnosi-metadata")
_guard = threading.Lock()
_pending: dict[Path, Future[bool]] = {}
_failed: dict[Path, float] = {}
_MAX_PENDING = 2
_TIMEOUT = 10.0


def _download(path: Path) -> bool:
    ready = asyncio.run(materialize_coordinated(path, _TIMEOUT))
    try:
        return ready and not is_cloud_placeholder(path, path.lstat())
    except OSError:
        return False


def ensure_metadata_local(path: Path) -> None:
    """Download one placeholder, or raise without reading/replacing its contents.

    Async request threads never wait on a provider. Sync readers wait at most
    eleven seconds; two separate, killable helper processes bound concurrency.
    Concurrent callers share a download; failures have a thirty-second cooldown.
    """
    if ".gnosi" not in path.parts:
        return
    path = Path.absolute(path)
    try:
        stat = path.stat()
    except FileNotFoundError:
        return
    if not is_cloud_placeholder(path, stat):
        return
    # Ordinary local configuration aliases retain their existing behavior.
    # Cloud reads must not escape through a symlinked metadata tree.
    if any(parent.is_symlink() for parent in (path, *path.parents)):
        raise MetadataUnavailable("Cloud metadata path is not accessible safely")
    future = _request_download(path)
    if future is None:
        return
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        try:
            ready = future.result(timeout=_TIMEOUT + 1)
        except TimeoutError:
            ready = False
        if ready and not is_cloud_placeholder(path, path.lstat()):
            return
        raise MetadataUnavailable("Cloud metadata download failed; retry later")
    raise MetadataUnavailable("Cloud metadata download is pending; retry shortly")


def read_metadata_text(path: Path, encoding: str = "utf-8", errors: str | None = None) -> str:
    ensure_metadata_local(path)
    return path.read_text(encoding=encoding, errors=errors)


def read_metadata_bytes(path: Path) -> bytes:
    ensure_metadata_local(path)
    return path.read_bytes()


def metadata_path(path: Path) -> Path:
    """Guard a pathlib open without changing its mode or return type."""
    ensure_metadata_local(path)
    return path


def _request_download(path: Path) -> Future[bool] | None:
    """Coalesce downloads and reap completed work under one short lock."""
    with _guard:
        for key, job in list(_pending.items()):
            if job.done():
                _pending.pop(key)
                if not job.result():
                    _failed[key] = time.monotonic()
        # A successful helper may have hydrated this file since the first stat.
        if not is_cloud_placeholder(path, path.lstat()):
            return None
        future = _pending.get(path)
        now = time.monotonic()
        for key in list(_failed):
            if now - _failed[key] >= 30:
                _failed.pop(key)
        if path in _failed:
            raise MetadataUnavailable("Cloud metadata download failed; retry later")
        if future is None:
            if len(_pending) >= _MAX_PENDING:
                raise MetadataUnavailable("Cloud metadata downloads are pending; retry shortly")
            future = _pool.submit(_download, path)
            _pending[path] = future
    return future
