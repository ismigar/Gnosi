"""Cross-process page mutation lock."""

from __future__ import annotations

import hashlib
import tempfile
import threading
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Dict

from backend.domains.agent.gnosi_support import (
    ActionConflictError,
    _file_revision,
    _parse,
    _write_page,
)

_PAGE_LOCKS_GUARD = threading.Lock()


_PAGE_LOCKS: Dict[str, threading.RLock] = {}


@contextmanager
def _page_lock(path: Path) -> Iterator[None]:
    """Serialize one canonical page path across threads and worker processes."""
    key = str(path.resolve())
    lock_stripe = hashlib.sha256(key.encode("utf-8")).hexdigest()[:2]
    with _PAGE_LOCKS_GUARD:
        thread_lock = _PAGE_LOCKS.setdefault(lock_stripe, threading.RLock())
    with thread_lock:
        lock_path = Path(tempfile.gettempdir()) / f"gnosi-page-lock-{lock_stripe}.lock"
        with lock_path.open("a+b") as lock_file:
            fcntl_module: Any = None
            try:
                import fcntl as fcntl_module

                fcntl_module.flock(lock_file.fileno(), fcntl_module.LOCK_EX)
            except ImportError:
                pass
            try:
                yield
            finally:
                if fcntl_module is not None:
                    fcntl_module.flock(lock_file.fileno(), fcntl_module.LOCK_UN)


def _mutate_page(
    path: Path,
    mutator: Callable[[Dict[str, Any], str], tuple[Dict[str, Any], str]],
) -> Dict[str, Any]:
    """Read, mutate, version, and write a page as one serialized operation."""
    with _page_lock(path):
        expected_revision = _file_revision(path)
        metadata, body = _parse(path)
        next_metadata, next_body = mutator(metadata, body)
        if _file_revision(path) != expected_revision:
            raise ActionConflictError(
                "The page changed while the agent was preparing the update.",
            )
        _write_page(path, next_metadata, next_body)
        return next_metadata
