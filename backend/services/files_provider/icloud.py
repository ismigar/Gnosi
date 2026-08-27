"""iCloudDriveProvider: vault over iCloud Drive with the macOS File Provider.

iCloud Drive uses the same pattern as OneDrive on macOS:
- Online-only files marked with `st_blocks == 0`.
- Materialization triggered by `open()/read()` (the File Provider
  framework handles the download transparently).

The `scripts/runtime/onedrive_warmup_daemon.py` daemon is provider-agnostic:
it only receives an absolute path and does `open()/read()`. So the same daemon
serves both OneDrive and iCloud — the only thing that changes is the provider
label (visible in the log) and, optionally, dedicated env vars.

If the user has a dedicated daemon for iCloud (for example, a different
port), they can define `ICLOUD_WARMUP_URL` and `ICLOUD_WARMUP_TIMEOUT`. If
not, it falls back to `ONEDRIVE_WARMUP_URL` / `ONEDRIVE_WARMUP_TIMEOUT` (default
`host.docker.internal:5009`).

See `docs/dev_memory/directives/files_provider_abstraction.md`.
"""

from __future__ import annotations

import os
from typing import Optional

from .onedrive import OneDriveProvider


class iCloudDriveProvider(OneDriveProvider):
    """Detection + materialization for iCloud Drive (macOS File Provider).

    Reuses all the logic of `OneDriveProvider`; it only changes the
    `name` (for logs/observability) and prioritizes `ICLOUD_*` env vars
    before falling back to `ONEDRIVE_*` for the HTTP daemon.
    
    """

    name = "icloud"

    def __init__(
        self,
        warmup_url: Optional[str] = None,
        warmup_timeout_s: Optional[float] = None,
        vault_host_path: Optional[str] = None,
        container_root: str = "/vault",
        max_concurrent_warmups: int = 2,
    ) -> None:
        warmup_url = warmup_url or os.environ.get("ICLOUD_WARMUP_URL")
        if warmup_timeout_s is None:
            env = os.environ.get("ICLOUD_WARMUP_TIMEOUT")
            if env is not None:
                warmup_timeout_s = float(env)
        super().__init__(
            warmup_url=warmup_url,
            warmup_timeout_s=warmup_timeout_s,
            vault_host_path=vault_host_path,
            container_root=container_root,
            max_concurrent_warmups=max_concurrent_warmups,
        )
