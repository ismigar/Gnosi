"""GoogleDriveProvider: vault sobre Google Drive (Drive for Desktop, macOS).

Des del 2023, Drive for Desktop a macOS utilitza el File Provider
framework igual que OneDrive i iCloud:
- Online-only marcat amb `st_blocks == 0`.
- Materialització disparada per `open()/read()`.
- Path típic: `~/Library/CloudStorage/GoogleDrive-<account>/...`.

Per tant, el daemon `sh/onedrive_warmup_daemon.py` és reutilizable
sense canvis. Aquesta classe només existeix per donar al log
(`FilesProvider actiu: gdrive`) i permetre env vars dedicades.

Notes:
- El **Drive File Stream antic** (versió < 2021) muntava un FUSE
  driver propi a `/Volumes/GoogleDrive/`. Google va migrar tots els
  usuaris al nou sistema; tractar el cas legacy no està suportat.
- A Windows, Google Drive usa Files-on-Demand del Cloud Filter API,
  que té una detecció diferent (xattr `OFFLINE`). Aquesta classe
  només cobreix macOS — Windows quedaria per a una fase posterior.

Vegeu `docs/dev_memory/directives/files_provider_abstraction.md`.
"""

from __future__ import annotations

import os
from typing import Optional

from .onedrive import OneDriveProvider


class GoogleDriveProvider(OneDriveProvider):
    """Google Drive (Drive for Desktop) a macOS, via File Provider.

    Reutilitza la lògica de `OneDriveProvider`; només canvia el `name`
    i prioritza env vars `GDRIVE_*` abans de caure a `ONEDRIVE_*`.
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
