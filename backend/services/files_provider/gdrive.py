"""GoogleDriveProvider: vault over Google Drive (Drive for Desktop, macOS).

Since 2023, Drive for Desktop on macOS has used the File Provider
framework just like OneDrive and iCloud:
- Online-only marked with `st_blocks == 0`.
- Materialization triggered by `open()/read()`.
- Typical path: `~/Library/CloudStorage/GoogleDrive-<account>/...`.

The configured host helper is provider-neutral. This class provides the log
identity and dedicated `GDRIVE_*` settings without inheriting OneDrive repair.

Notes:
- The **old Drive File Stream** (version < 2021) mounted its own FUSE
  driver at `/Volumes/GoogleDrive/`. Google migrated all
  users to the new system; handling the legacy case is not supported.
- On Windows, Google Drive uses Files-on-Demand from the Cloud Filter API,
  which has a different detection method (xattr `OFFLINE`). This class
  only covers macOS — Windows would be left for a later phase.

See `docs/engineering/domains/vault-files.md`.
"""

from __future__ import annotations

from typing import Optional

from .on_demand import OnDemandFilesProvider


class GoogleDriveProvider(OnDemandFilesProvider):
    """Google Drive (Drive for Desktop) on macOS, via File Provider.

    Shares provider-neutral hydration and has no OneDrive recovery behavior.

    """

    name = "gdrive"
    env_prefix = "GDRIVE"

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
