"""Interfície base per a proveïdors d'emmagatzematge cloud-on-demand.

Aïlla la lògica de detecció de fitxers "online-only" i materialització
darrere d'una API uniforme, perquè el codi de producte no hagi de
conèixer els detalls de cada proveïdor (OneDrive, GDrive File Stream,
iCloud Drive, NextCloud, vault local, etc.).

Vegeu `docs/dev_memory/directives/files_provider_abstraction.md`.
"""

from __future__ import annotations

import os
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Optional


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
