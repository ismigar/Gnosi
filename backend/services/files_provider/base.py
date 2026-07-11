"""Base interface for cloud-on-demand storage providers.

Isolates the logic for detecting "online-only" files and materializing them
behind a uniform API, so product code doesn't need to
know the details of each provider (OneDrive, GDrive File Stream,
iCloud Drive, NextCloud, local vault, etc.).

See `docs/dev_memory/directives/files_provider_abstraction.md`.
"""

from __future__ import annotations

import asyncio
import logging
import os
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Dict, Optional

log = logging.getLogger(__name__)


class FilesProvider(ABC):
    """Contract for a storage provider.

    Concrete implementations in `local.py`, `onedrive.py`, etc.
    
    """

    name: str  # identificador curt: "local", "onedrive", ...

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
        tasks: Dict[str, asyncio.Task] = getattr(self, "_warmup_tasks", None)
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

        def _cleanup(t: asyncio.Task) -> None:
            tasks.pop(key, None)
            if not t.cancelled():
                t.exception()  # retrieves it to silence "exception never retrieved"

        task.add_done_callback(_cleanup)

    async def _warmup_bg(self, container_path: Path) -> None:
        """Wrapper around `materialize` for background warmup: swallows
        any exception (the request has already responded 503; the client will retry)."""
        try:
            await self.materialize(container_path)
        except Exception:
            log.warning("Warmup en segon pla ha fallat per %s", container_path, exc_info=True)
