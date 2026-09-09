"""Base interface for cloud-on-demand storage providers.

Isolates the logic for detecting "online-only" files and materializing them
behind a uniform API, so product code doesn't need to
know the details of each provider (OneDrive, GDrive File Stream,
iCloud Drive, NextCloud, local vault, etc.).

See `docs/engineering/domains/vault-files.md`.
"""

from __future__ import annotations

import asyncio
import logging
import os
import time
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Dict, Literal, Optional

log = logging.getLogger(__name__)


class FilesProvider(ABC):
    """Contract for a storage provider.

    Concrete implementations in `local.py`, `onedrive.py`, etc.

    """

    name: str  # identificador curt: "local", "onedrive", ...
    _warmup_tasks: Dict[str, asyncio.Task[None]]
    _warmup_failures: dict[str, float]

    def warmup_status(self, container_path: Path) -> Literal["pending", "failed"] | None:
        """Expose completion instead of treating every retry as a new download.

        Failures are kept briefly, with a bounded number of paths. This lets
        clients stop polling a failed download while allowing a later retry.
        Queued jobs remain pending for their entire lifetime, not just while
        holding a provider's materialization semaphore.
        """
        key = str(container_path)
        task = getattr(self, "_warmup_tasks", {}).get(key)
        if task is not None and not task.done():
            return "pending"
        failures = getattr(self, "_warmup_failures", {})
        failed_at = failures.get(key)
        if failed_at is not None:
            if time.monotonic() - failed_at < 30:
                return "failed"
            failures.pop(key, None)
        return None

    @abstractmethod
    def is_online_only(
        self,
        container_path: Path,
        stat_result: Optional[os.stat_result] = None,
    ) -> bool:
        """Returns True if the file exists logically but is not
        downloaded to local disk. For providers that don't have "files
        on-demand" (local vault) it always returns False.

        The `container_path` parameter is the path as seen by the
        backend (typically inside `/vault` when running in Docker).

        If `stat_result` has already been computed by the caller, it can be passed in to
        avoid an additional stat() call. If not, the implementer will perform a
        new one; on error it returns False (we can't assert that it is
        online-only without the stat).

        """

    @abstractmethod
    async def materialize(self, container_path: Path) -> bool:
        """Asks the provider to download the file to local disk.

        Returns True if the file is available locally after
        the call; False if materialization failed (timeout, network
        error, file out of scope, etc.).

        For local-only providers, this is a no-op that returns True.

        """

    def schedule_warmup(self, container_path: Path) -> None:
        """Starts materialization in the BACKGROUND (fire-and-forget) and returns
        instantly.

        Image endpoints must not block the HTTP request until the
        provider downloads the file (OneDrive can take tens of seconds): with
        this, they respond 503 immediately and the client retries until a
        request finds the file already materialized. It's coalesced by path: multiple
        `<img>` tags for the same asset trigger a SINGLE download. Without an event loop
        running (sync context) it's a silent no-op."""
        key = str(container_path)
        if self.warmup_status(container_path) is not None:
            return
        tasks: Optional[Dict[str, asyncio.Task[None]]] = getattr(
            self,
            "_warmup_tasks",
            None,
        )
        if tasks is None:
            tasks = self._warmup_tasks = {}
        existing = tasks.get(key)
        if existing is not None and not existing.done():
            return
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            return
        task = loop.create_task(self._warmup_bg(container_path))
        tasks[key] = task

        def _cleanup(t: asyncio.Task[None]) -> None:
            if tasks.get(key) is t:
                tasks.pop(key, None)
            if not t.cancelled():
                t.exception()  # retrieves it to silence "exception never retrieved"

        task.add_done_callback(_cleanup)

    async def _warmup_bg(self, container_path: Path) -> None:
        """Wrapper around `materialize` for background warmup: swallows
        any exception (the request has already responded 503; the client will retry)."""
        try:
            success = await self.materialize(container_path)
        except Exception:
            success = False
            log.warning("Warmup en segon pla ha fallat per %s", container_path, exc_info=True)
        key = str(container_path)
        failures = getattr(self, "_warmup_failures", None)
        if failures is None:
            failures = self._warmup_failures = {}
        if success:
            failures.pop(key, None)
        else:
            failures[key] = time.monotonic()
            while len(failures) > 256:
                failures.pop(next(iter(failures)))
