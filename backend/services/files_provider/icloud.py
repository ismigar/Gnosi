"""iCloudDriveProvider: vault sobre iCloud Drive amb el File Provider macOS.

iCloud Drive utilitza el mateix patró que OneDrive a macOS:
- Fitxers online-only marcats amb `st_blocks == 0`.
- Materialització disparada per `open()/read()` (el File Provider
  framework gestiona la baixada de manera transparent).

El daemon `sh/onedrive_warmup_daemon.py` és agnòstic al proveïdor:
només rep un path absolut i fa `open()/read()`. Així el mateix daemon
serveix per OneDrive i per iCloud — l'únic que canvia és l'etiqueta
del provider (visible al log) i, opcionalment, env vars dedicades.

Si l'usuari té un daemon dedicat per iCloud (per exemple, un altre
port), pot definir `ICLOUD_WARMUP_URL` i `ICLOUD_WARMUP_TIMEOUT`. Si
no, es cau a `ONEDRIVE_WARMUP_URL` / `ONEDRIVE_WARMUP_TIMEOUT` (default
`host.docker.internal:5009`).

Vegeu `docs/dev_memory/directives/files_provider_abstraction.md`.
"""

from __future__ import annotations

import os
from typing import Optional

from .onedrive import OneDriveProvider


class iCloudDriveProvider(OneDriveProvider):
    """Detecció + materialització per a iCloud Drive (File Provider macOS).

    Reutilitza tota la lògica de `OneDriveProvider`; només canvia el
    `name` (per logs/observabilitat) i prioritza env vars `ICLOUD_*`
    abans de caure a `ONEDRIVE_*` per al daemon HTTP.
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
