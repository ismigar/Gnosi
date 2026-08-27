"""OneDrive adapter for the provider-neutral files-on-demand runtime."""

from __future__ import annotations

import asyncio
import logging
import os
import time
from typing import Optional

from .on_demand import (
    OnDemandFilesProvider,
    _default_warmup_mode,
    _default_warmup_url,
    _is_docker,
)

log = logging.getLogger(__name__)

__all__ = [
    "OneDriveProvider",
    "_default_warmup_mode",
    "_default_warmup_url",
    "_is_docker",
]


class OneDriveProvider(OnDemandFilesProvider):
    """macOS File Provider hydration with optional OneDrive-only recovery."""

    name = "onedrive"
    env_prefix = "ONEDRIVE"
    supports_vendor_recovery = True

    def __init__(
        self,
        warmup_url: Optional[str] = None,
        warmup_timeout_s: Optional[float] = None,
        vault_host_path: Optional[str] = None,
        container_root: str = "/vault",
        max_concurrent_warmups: int = 2,
    ) -> None:
        super().__init__(
            warmup_url=warmup_url,
            warmup_timeout_s=warmup_timeout_s,
            vault_host_path=vault_host_path,
            container_root=container_root,
            max_concurrent_warmups=max_concurrent_warmups,
        )
        self._auto_restart = os.environ.get(
            "ONEDRIVE_AUTO_RESTART",
            "1",
        ).strip().lower() not in ("0", "false", "no")
        self._restart_cooldown_s = float(os.environ.get("ONEDRIVE_RESTART_COOLDOWN", "300"))
        self._restart_wait_s = float(os.environ.get("ONEDRIVE_RESTART_WAIT", "30"))
        self._last_onedrive_restart = 0.0

    async def _recover_after_failed_warmup(self) -> bool:
        """Restart only OneDrive after a failed hydration, with cooldown."""
        if not self._auto_restart:
            return False
        now = time.monotonic()
        if now - self._last_onedrive_restart < self._restart_cooldown_s:
            return False
        self._last_onedrive_restart = now
        log.warning("☁️♻️ Materialització OneDrive encallada; reiniciant el client.")
        try:
            killer = await asyncio.create_subprocess_exec(
                "/usr/bin/killall",
                "-9",
                "OneDrive",
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.DEVNULL,
            )
            await killer.communicate()
            await asyncio.sleep(2.0)
            launcher = await asyncio.create_subprocess_exec(
                "/usr/bin/open",
                "-a",
                "OneDrive",
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.DEVNULL,
            )
            await launcher.communicate()
        except OSError as exc:
            log.warning("☁️ No s'ha pogut reiniciar OneDrive: %r", exc)
            return False
        await asyncio.sleep(self._restart_wait_s)
        log.info("☁️♻️ OneDrive reiniciat; reintentant la materialització.")
        return True
