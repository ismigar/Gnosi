"""iCloudDriveProvider: vault over iCloud Drive with the macOS File Provider.

iCloud Drive uses the same pattern as OneDrive on macOS:
- Online-only files marked with `st_blocks == 0`.
- Materialization triggered by `open()/read()` (the File Provider
  framework handles the download transparently).

The configured host helper is provider-agnostic: it receives an absolute path
and performs a bounded read. iCloud uses only `ICLOUD_*` client settings.

If the user has a dedicated daemon for iCloud (for example, a different
port), they can define `ICLOUD_WARMUP_URL` and `ICLOUD_WARMUP_TIMEOUT`. If
not, the provider-neutral runtime default is used.

See `docs/engineering/domains/vault-files.md`.
"""

from __future__ import annotations

from typing import Optional

from .on_demand import OnDemandFilesProvider


class iCloudDriveProvider(OnDemandFilesProvider):
    """Detection + materialization for iCloud Drive (macOS File Provider).

    It shares provider-neutral hydration but has no OneDrive recovery behavior.

    """

    name = "icloud"
    env_prefix = "ICLOUD"

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
