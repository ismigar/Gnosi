"""Interfície base per a proveïdors d'emmagatzematge cloud-on-demand.

Aïlla la lògica de detecció de fitxers "online-only" i materialització
darrere d'una API uniforme, perquè el codi de producte no hagi de
conèixer els detalls de cada proveïdor (OneDrive, GDrive File Stream,
iCloud Drive, NextCloud, vault local, etc.).

Vegeu `docs/dev_memory/directives/files_provider_abstraction.md`.
"""

from __future__ import annotations

import asyncio
import logging
import os
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Dict, Optional

log = logging.getLogger(__name__)


class FilesProvider(ABC):
    """Contracte per a un proveïdor d'emmagatzematge.

    Implementacions concretes a `local.py`, `onedrive.py`, etc.
    """

    name: str  # identificador curt: "local", "onedrive", ...

    @abstractmethod
    def is_online_only(
        self,
        container_path: Path,
        stat_result: Optional[os.stat_result] = None,
    ) -> bool:
        """Retorna True si el fitxer existeix lògicament però no està
        descarregat al disc local. Per a proveïdors que no tenen "files
        on-demand" (vault local) sempre retorna False.

        El paràmetre `container_path` és el path tal com el veu el
        backend (típicament dins de `/vault` quan corre a Docker).

        Si `stat_result` ja s'ha calculat al cridador, es pot passar per
        evitar un stat() addicional. Si no, l'implementador en farà un
        de nou; en cas d'error retorna False (no podem afirmar que sigui
        online-only sense el stat).
        """

    @abstractmethod
    async def materialize(self, container_path: Path) -> bool:
        """Demana al proveïdor que baixi el fitxer al disc local.

        Retorna True si el fitxer està disponible localment després de
        la crida; False si la materialització ha fallat (timeout, error
        de xarxa, fitxer fora de l'àmbit, etc.).

        Per a proveïdors local-only, és un no-op que retorna True.
        """

    def schedule_warmup(self, container_path: Path) -> None:
        """Engega la materialització en SEGON PLA (fire-and-forget) i retorna a
        l'instant.

        Els endpoints d'imatge no han de bloquejar la petició HTTP fins que el
        proveïdor baixa el fitxer (OneDrive pot trigar desenes de segons): amb
        això responen 503 immediatament i el client reintenta fins que una
        petició troba el fitxer ja materialitzat. Es coalesça per ruta: múltiples
        `<img>` del mateix asset disparen UNA sola baixada. Sense event loop en
        marxa (context síncron) és un no-op silenciós."""
        key = str(container_path)
        tasks: Dict[str, asyncio.Task] = getattr(self, "_warmup_tasks", None)
        if tasks is None:
            tasks = self._warmup_tasks = {}
        existing = tasks.get(key)
        if existing is not None and not existing.done():
            return
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            return
        task = loop.create_task(self._warmup_bg(container_path))
        tasks[key] = task

        def _cleanup(t: asyncio.Task) -> None:
            tasks.pop(key, None)
            if not t.cancelled():
                t.exception()  # recupera per silenciar "exception never retrieved"

        task.add_done_callback(_cleanup)

    async def _warmup_bg(self, container_path: Path) -> None:
        """Embolcall del `materialize` per al warmup en segon pla: engoleix
        qualsevol excepció (la petició ja ha respost 503; el client reintentarà)."""
        try:
            await self.materialize(container_path)
        except Exception:
            log.warning("Warmup en segon pla ha fallat per %s", container_path, exc_info=True)
