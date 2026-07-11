"""GoogleDriveProvider: vault over Google Drive (Drive for Desktop, macOS).

Since 2023, Drive for Desktop on macOS has used the File Provider
framework just like OneDrive and iCloud:
- Online-only marked with `st_blocks == 0`.
- Materialization triggered by `open()/read()`.
- Typical path: `~/Library/CloudStorage/GoogleDrive-<account>/...`.

Therefore, the `sh/onedrive_warmup_daemon.py` daemon is reusable
without changes. This class exists only to provide the log entry
(`FilesProvider actiu: gdrive`) and to allow dedicated env vars.

Notes:
- The **old Drive File Stream** (version < 2021) mounted its own FUSE
  driver at `/Volumes/GoogleDrive/`. Google migrated all
  users to the new system; handling the legacy case is not supported.
- On Windows, Google Drive uses Files-on-Demand from the Cloud Filter API,
  which has a different detection method (xattr `OFFLINE`). This class
  only covers macOS — Windows would be left for a later phase.

See `docs/dev_memory/directives/files_provider_abstraction.md`.
"""

from __future__ import annotations

import os
from typing import Optional

from .onedrive import OneDriveProvider


class GoogleDriveProvider(OneDriveProvider):
    """Google Drive (Drive for Desktop) on macOS, via File Provider.

    Reuses the logic of `OneDriveProvider`; it only changes the `name`
    and prioritizes `GDRIVE_*` env vars before falling back to `ONEDRIVE_*`.
    
    """

    name = "gdrive"

    def __init__(
        self,
        warmup_url: Optional[str] = None,
        warmup_timeout_s: Optional[float] = None,
        vault_host_path: Optional[str] = None,
        container_root: str = "/vault",
        max_concurrent_warmups: int = 2,
    ) -> None:
        warmup_url = warmup_url or os.environ.get("GDRIVE_WARMUP_URL")
        if warmup_timeout_s is None:
            env = os.environ.get("GDRIVE_WARMUP_TIMEOUT")
            if env is not None:
                warmup_timeout_s = float(env)
        super().__init__(
            warmup_url=warmup_url,
            warmup_timeout_s=warmup_timeout_s,
            vault_host_path=vault_host_path,
            container_root=container_root,
            max_concurrent_warmups=max_concurrent_warmups,
        )
