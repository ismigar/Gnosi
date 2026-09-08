"""Serialize family mutations across threads and local server workers."""
from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from hashlib import sha256
from threading import RLock, local
import sys

from backend.config.data_dir import resolve_data_dir
from backend.services.context_vars import get_active_vault_path

_THREAD_LOCK = RLock()
_DEPTH = local()


@contextmanager
def network_lock() -> Iterator[None]:
    with _THREAD_LOCK:
        if getattr(_DEPTH, "held", False):
            yield
            return
        vault = get_active_vault_path()
        key = sha256(str(vault).encode()).hexdigest()
        directory = resolve_data_dir() / "locks" / "genograms"
        directory.mkdir(parents=True, exist_ok=True)
        with (directory / f"{key}.lock").open("a+b") as handle:
            if sys.platform == "win32":
                import msvcrt
                if handle.tell() == 0:
                    handle.write(b"0")
                    handle.flush()
                handle.seek(0)
                msvcrt.locking(handle.fileno(), msvcrt.LK_LOCK, 1)
            else:
                import fcntl
                fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
            _DEPTH.held = True
            try:
                yield
            finally:
                _DEPTH.held = False
                if sys.platform == "win32":
                    handle.seek(0)
                    msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
                else:
                    fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
