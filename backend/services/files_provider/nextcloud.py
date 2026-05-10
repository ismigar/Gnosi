"""NextCloudProvider: vault sobre NextCloud Virtual Files (EXPERIMENTAL).

A diferència d'OneDrive/iCloud/GoogleDrive a macOS, NextCloud no usa
el File Provider framework natiu. Cada client (Windows/macOS/Linux)
té el seu propi mecanisme:

- **Windows**: Cloud Filter API (similar a OneDrive Windows). Detecció
  per atribut `FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS` (no exposat
  directament a Python sense `pywin32`).
- **macOS / Linux**: el client NextCloud crea fitxers placeholder
  marcats amb un extended attribute `user.nextcloud.is-virtual-file`,
  o (segons versió) un fitxer amb extensió `.nc-virt`.

**Detecció** en aquesta implementació:
1. Si l'extensió del path coincideix amb `PLACEHOLDER_EXT` (default
   `.nc-virt`, configurable via env `NEXTCLOUD_PLACEHOLDER_EXT`).
2. Altrament, mira xattr `user.nextcloud.is-virtual-file`.

Si el filesystem no suporta xattrs (alguns bind-mounts), `is_online_only`
retornarà False per defecte — comportament prudent que no fa warmups
innecessaris.

**Materialització:** delega al daemon HTTP igual que OneDrive. La crida
`open()/read()` sobre un placeholder NextCloud dispara la baixada en
la majoria d'instal·lacions macOS/Linux. Si la teva versió no respon
a `open()`, configura un daemon dedicat amb `NEXTCLOUD_WARMUP_URL`
que executi una comanda CLI específica (per exemple
`nextcloudcmd --download <path>`).

**Estat:** Esquelet. Validat només amb tests d'unitat (xattr/extensió).
Cal validació amb una instal·lació real de NextCloud client.

Vegeu `docs/dev_memory/directives/files_provider_abstraction.md`.
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

    Sobreescriu només `is_online_only` per usar xattr / extensió en
    lloc de `st_blocks==0`. Reutilitza la materialització via daemon
    HTTP d'`OneDriveProvider`.
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
        """Detecta placeholder NextCloud per extensió o xattr.

        El paràmetre `stat_result` és ignorat aquí — no usem `st_blocks`,
        així que un stat previ no aporta info. L'acceptem per honorar
        el contracte de la base.
        """
        # Heurística 1: extensió. Configurable via NEXTCLOUD_PLACEHOLDER_EXT.
        if container_path.suffix == self.placeholder_ext:
            return True

        # Heurística 2: extended attribute. `os.listxattr` no està
        # disponible a Windows; fora de macOS/Linux es retorna False.
        listxattr = getattr(os, "listxattr", None)
        if listxattr is None:
            return False
        try:
            xattrs = listxattr(str(container_path))
        except OSError:
            # Path no existeix, FS no suporta xattr, etc. — prudent: False.
            return False
        return self.XATTR_KEY in xattrs
