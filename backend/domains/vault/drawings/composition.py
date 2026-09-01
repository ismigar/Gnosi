"""Narrow, lazy compatibility collaborators for drawing and history routes."""

from __future__ import annotations

import importlib
import logging
import shutil
import time
from datetime import datetime
from pathlib import Path
from typing import Protocol, cast

from backend.domains.vault.drawings.service import DrawingDependencies


class DrawingVaultPort(Protocol):
    """Only the legacy collaborators not yet independently composed.

    Methods stay late-bound so historical plugin/test overrides still apply.
    This transitional port must disappear when the remaining vault composition
    owns these providers; it is not a substitute for typing the entire facade.
    """

    def get_p(self, key: str) -> Path: ...

    def _move_page_to_trash(self, page_id: str, file_path: Path) -> dict[str, object]: ...

    def _trash_entry_dir(self, page_id: str) -> Path: ...

    def _validate_safe_page_id(self, page_id: str) -> str: ...

    def _validate_history_timestamp(self, timestamp: str) -> str: ...

    def parse_frontmatter(
        self, content: str, file_path: Path | None = None, render_snapshots: bool = False,
    ) -> tuple[dict[str, object], str]: ...

    def find_page_path(self, page_id: str, *, allow_full_scan: bool = True) -> Path | None: ...

    def get_table_id(self, metadata: dict[str, object]) -> str | None: ...

    def _recompute_cross_record_formulas_for_table(
        self, table_id: str, exclude_page_id: str | None = None,
    ) -> object: ...

    def safe_write_json(
        self, path: Path, payload: object, *, indent: int = 2, ensure_ascii: bool = False,
    ) -> None: ...


# The compatibility facade resolves exports dynamically during ordered startup.
# Contain its dynamic type once, in an explicit port with no Any members. Route
# code and domain services see only checked arguments/results through this port.
vault = cast(DrawingVaultPort, importlib.import_module("backend.api.vault_routes"))


def drawing_dependencies() -> DrawingDependencies:
    """Compose typed persistence callbacks without capturing mutable providers."""
    return DrawingDependencies(
        drawings_directory=lambda: vault.get_p("DIBUIXOS"),
        vault_root=lambda: vault.get_p("VAULT"),
        move_to_trash=lambda page_id, path: vault._move_page_to_trash(page_id, path),
        trash_entry_directory=lambda page_id: vault._trash_entry_dir(page_id),
        write_drawing_json=lambda path, payload: vault.safe_write_json(
            path, payload, indent=2, ensure_ascii=False,
        ),
        write_trash_json=lambda path, payload: vault.safe_write_json(path, payload, indent=2),
        copy_file=lambda source, target: shutil.copy2(source, target),
        current_time=time.time,
        timestamp_label=lambda: datetime.now().strftime("%Y%m%d_%H%M%S"),
        modified_iso=lambda timestamp: datetime.fromtimestamp(timestamp).isoformat(),
        logger=logging.getLogger("backend.api.vault_routes"),
    )
