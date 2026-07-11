"""NextCloudProvider: vault over NextCloud Virtual Files (EXPERIMENTAL).

Unlike OneDrive/iCloud/GoogleDrive on macOS, NextCloud does not use
the native File Provider framework. Each client (Windows/macOS/Linux)
has its own mechanism:

- **Windows**: Cloud Filter API (similar to OneDrive Windows). Detection
  via the `FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS` attribute (not exposed
  directly in Python without `pywin32`).
- **macOS / Linux**: the NextCloud client creates placeholder files
  marked with an extended attribute `user.nextcloud.is-virtual-file`,
  or (depending on version) a file with the `.nc-virt` extension.

**Detection** in this implementation:
1. If the path extension matches `PLACEHOLDER_EXT` (default
   `.nc-virt`, configurable via env `NEXTCLOUD_PLACEHOLDER_EXT`).
2. Otherwise, check the `user.nextcloud.is-virtual-file` xattr.

If the filesystem doesn't support xattrs (some bind-mounts), `is_online_only`
will return False by default — cautious behavior that avoids unnecessary
warmups.

**Materialization:** delegates to the HTTP daemon just like OneDrive. The
`open()/read()` call on a NextCloud placeholder triggers the download in
most macOS/Linux installations. If your version doesn't respond
to `open()`, configure a dedicated daemon with `NEXTCLOUD_WARMUP_URL`
that runs a specific CLI command (for example
`nextcloudcmd --download <path>`).

**Status:** Skeleton. Validated only with unit tests (xattr/extension).
Needs validation with a real NextCloud client installation.

See `docs/dev_memory/directives/files_provider_abstraction.md`.
"""

from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Optional

from .onedrive import OneDriveProvider

log = logging.getLogger(__name__)


class NextCloudProvider(OneDriveProvider):
    """NextCloud Virtual Files (EXPERIMENTAL).

    Overrides only `is_online_only` to use xattr / extension instead
    of `st_blocks==0`. Reuses materialization via the HTTP daemon
    from `OneDriveProvider`.
    
    """

    name = "nextcloud"

    XATTR_KEY = "user.nextcloud.is-virtual-file"

    def __init__(
        self,
        warmup_url: Optional[str] = None,
        warmup_timeout_s: Optional[float] = None,
        vault_host_path: Optional[str] = None,
        container_root: str = "/vault",
        max_concurrent_warmups: int = 2,
        placeholder_ext: Optional[str] = None,
    ) -> None:
        warmup_url = warmup_url or os.environ.get("NEXTCLOUD_WARMUP_URL")
        if warmup_timeout_s is None:
            env = os.environ.get("NEXTCLOUD_WARMUP_TIMEOUT")
            if env is not None:
                warmup_timeout_s = float(env)
        self.placeholder_ext = (
            placeholder_ext
            or os.environ.get("NEXTCLOUD_PLACEHOLDER_EXT", ".nc-virt")
        )
        super().__init__(
            warmup_url=warmup_url,
            warmup_timeout_s=warmup_timeout_s,
            vault_host_path=vault_host_path,
            container_root=container_root,
            max_concurrent_warmups=max_concurrent_warmups,
        )

    def is_online_only(
        self,
        container_path: Path,
        stat_result: Optional[os.stat_result] = None,
    ) -> bool:
        """Detects a NextCloud placeholder by extension or xattr.

        The `stat_result` parameter is ignored here — we don't use `st_blocks`,
        so a previous stat doesn't provide useful info. We accept it to honor
        the base contract.
        
        """
        # Heuristic 1: extension. Configurable via NEXTCLOUD_PLACEHOLDER_EXT.
        if container_path.suffix == self.placeholder_ext:
            return True

        # Heuristic 2: extended attribute. `os.listxattr` is not
        # available on Windows; outside macOS/Linux it returns False.
        listxattr = getattr(os, "listxattr", None)
        if listxattr is None:
            return False
        try:
            xattrs = listxattr(str(container_path))
        except OSError:
            # Path doesn't exist, FS doesn't support xattr, etc. — cautious: False.
            return False
        return self.XATTR_KEY in xattrs
