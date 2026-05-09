"""LocalProvider: vault sobre disc local pur, sense files-on-demand."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Optional

from .base import FilesProvider


class LocalProvider(FilesProvider):
    """Proveïdor per a vaults sobre disc local. Cap fitxer és online-only;
    `materialize()` és un no-op.
    """

    name = "local"

    def is_online_only(
        self,
        container_path: Path,
        stat_result: Optional[os.stat_result] = None,
    ) -> bool:
        return False

    async def materialize(self, container_path: Path) -> bool:
        return True
