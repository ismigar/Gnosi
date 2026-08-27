"""LocalProvider: vault on pure local disk, without files-on-demand."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Optional

from .base import FilesProvider


class LocalProvider(FilesProvider):
    """Provider for vaults on local disk. No file is online-only;
    `materialize()` is a no-op.

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
