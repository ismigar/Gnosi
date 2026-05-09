"""OneDriveProvider: vault sobre OneDrive amb Files On-Demand.

Encapsula la detecció de fitxers online-only i la crida al daemon que
viu al host (`sh/onedrive_warmup_daemon.py`) per disparar la baixada
del File Provider de macOS.

Vegeu `docs/dev_memory/directives/files_provider_abstraction.md`.
"""

from __future__ import annotations

import asyncio
import logging
import os
from pathlib import Path
from typing import Dict, Optional

from .base import FilesProvider

log = logging.getLogger(__name__)


class OneDriveProvider(FilesProvider):
    """Detecció + materialització per a OneDrive (File Provider macOS)."""

    name = "onedrive"

    def __init__(
        self,
        warmup_url: Optional[str] = None,
        warmup_timeout_s: Optional[float] = None,
        vault_host_path: Optional[str] = None,
        container_root: str = "/vault",
        max_concurrent_warmups: int = 2,
    ) -> None:
        self.warmup_url = warmup_url or os.environ.get(
            "ONEDRIVE_WARMUP_URL",
            "http://host.docker.internal:5009/warmup",
        )
        self.warmup_timeout_s = (
            warmup_timeout_s
            if warmup_timeout_s is not None
            else float(os.environ.get("ONEDRIVE_WARMUP_TIMEOUT", "100"))
        )
        self.vault_host_path = vault_host_path or os.environ.get("VAULT_HOST_PATH")
        self.container_root = Path(container_root)

        # Serialitzem warmups: OneDrive baixa més de pressa quan no rep
        # peticions concurrents, i evitem que un sol client (50 thumbs
        # alhora) sature el daemon.
        self._semaphore = asyncio.Semaphore(max_concurrent_warmups)
        # Coalesce: si dues peticions volen el mateix fitxer alhora,
        # només cridem el daemon una vegada.
        self._inflight: Dict[str, asyncio.Future] = {}

    def is_online_only(
        self,
        container_path: Path,
        stat_result: Optional[os.stat_result] = None,
    ) -> bool:
        """True si el fitxer existeix però `st_blocks == 0` (placeholder
        del File Provider de macOS no materialitzat)."""
        if stat_result is None:
            try:
                stat_result = container_path.stat()
            except OSError:
                return False
        # `getattr` amb default 1 perquè en sistemes que no exposen
        # st_blocks (p. ex. alguns FUSE) no volem disparar warmup.
        return getattr(stat_result, "st_blocks", 1) == 0

    async def materialize(self, container_path: Path) -> bool:
        """Crida al daemon del host (`sh/onedrive_warmup_daemon.py`) per
        forçar la baixada del fitxer. Retorna True si el daemon respon
        `materialized`."""
        if not self.vault_host_path:
            log.debug("VAULT_HOST_PATH no configurat: warmup desactivat")
            return False
        try:
            rel = container_path.relative_to(self.container_root)
        except ValueError:
            log.debug(
                "Path fora de %s, no es pot warmup: %s",
                self.container_root, container_path,
            )
            return False
        host_path = str(Path(self.vault_host_path) / rel)

        inflight = self._inflight.get(host_path)
        if inflight is not None:
            try:
                return await inflight
            except Exception:
                return False

        fut: asyncio.Future = asyncio.get_event_loop().create_future()
        self._inflight[host_path] = fut
        try:
            async with self._semaphore:
                try:
                    import httpx
                    async with httpx.AsyncClient(timeout=self.warmup_timeout_s) as cli:
                        r = await cli.get(self.warmup_url, params={"path": host_path})
                    body = (
                        r.json()
                        if r.headers.get("content-type", "").startswith("application/json")
                        else {}
                    )
                    ok = r.status_code == 200 and body.get("status") == "materialized"
                    if ok:
                        log.info(
                            "☁️→💾 Materialitzat OneDrive %s (blocks=%s, %.1fs)",
                            rel, body.get("blocks"), body.get("elapsed", 0),
                        )
                    else:
                        log.warning(
                            "☁️ Warmup ha fallat per %s: HTTP %s %s",
                            rel, r.status_code, body,
                        )
                    fut.set_result(ok)
                    return ok
                except Exception as e:
                    log.warning("☁️ Warmup ha llançat excepció per %s: %r", rel, e)
                    fut.set_result(False)
                    return False
        finally:
            self._inflight.pop(host_path, None)
