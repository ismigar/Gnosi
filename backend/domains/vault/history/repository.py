"""Filesystem repository for forward-only vault page history."""

from __future__ import annotations

import logging
import os
import shutil
import stat
import time
from datetime import datetime, timedelta
from pathlib import Path
from backend.utils.metadata_io import read_vault_text, vault_file_snapshot

log = logging.getLogger(__name__)


class HistoryRepository:
    """Persist and restore immutable Markdown snapshots under one vault."""

    cooldown_seconds = 600

    def __init__(self, vault_root: Path) -> None:
        self.vault_root = vault_root

    def page_root(self, page_id: str) -> Path:
        return self.vault_root / ".history" / page_id

    def _copy_source(self, source: Path, destination: Path) -> None:
        with vault_file_snapshot(source, root=self.vault_root) as snapshot:
            if not snapshot.is_private:
                shutil.copy2(snapshot.path, destination)
            else:
                shutil.copyfile(snapshot.path, destination)
                info = snapshot.stat_result
                os.chmod(destination, stat.S_IMODE(info.st_mode))
                os.utime(destination, ns=(info.st_atime_ns, info.st_mtime_ns))

    def create_file_version(
        self,
        page_id: str,
        file_path: Path,
        *,
        force: bool = False,
    ) -> None:
        if not file_path or not file_path.exists():
            return

        history_root = self.page_root(page_id)
        history_root.mkdir(parents=True, exist_ok=True)
        versions = sorted(history_root.glob("*.md"))
        if versions and not force:
            try:
                if time.time() - versions[-1].stat().st_mtime < self.cooldown_seconds:
                    return
            except OSError:
                pass

        timestamp = datetime.now()
        version_path = history_root / f"{timestamp.strftime('%Y%m%d_%H%M%S')}.md"
        while version_path.exists():
            timestamp += timedelta(seconds=1)
            version_path = history_root / f"{timestamp.strftime('%Y%m%d_%H%M%S')}.md"
        try:
            self._copy_source(file_path, version_path)
            log.info("Page version created: %s", version_path)
        except OSError as exc:
            log.warning("Could not create version for %s: %s", page_id, exc)

    def create_content_version(self, page_id: str, original_content: str) -> None:
        if not original_content:
            return
        history_root = self.page_root(page_id)
        try:
            history_root.mkdir(parents=True, exist_ok=True)
        except OSError:
            return

        versions = sorted(history_root.glob("*.md"))
        if versions:
            try:
                if time.time() - versions[-1].stat().st_mtime < self.cooldown_seconds:
                    return
            except OSError:
                pass

        version_path = history_root / f"{datetime.now().strftime('%Y%m%d_%H%M%S')}.md"
        try:
            version_path.write_text(original_content, encoding="utf-8")
            log.info("Page version created (bg): %s", version_path)
        except OSError as exc:
            log.warning("Could not create version (bg) for %s: %s", page_id, exc)

    def list_versions(self, page_id: str) -> list[dict[str, object]]:
        """Return snapshots newest first with the historical response shape."""
        history_root = self.page_root(page_id)
        if not history_root.exists():
            return []
        versions: list[dict[str, object]] = []
        for path in sorted(
            history_root.glob("*.md"),
            key=lambda item: item.name,
            reverse=True,
        ):
            timestamp = path.stem
            try:
                readable = datetime.strptime(timestamp, "%Y%m%d_%H%M%S").strftime(
                    "%Y-%m-%d %H:%M:%S"
                )
            except ValueError:
                readable = timestamp
            versions.append(
                {
                    "id": timestamp,
                    "timestamp": readable,
                    "size": path.stat().st_size,
                }
            )
        return versions

    def version_path(self, page_id: str, timestamp: str) -> Path:
        """Resolve one already-validated snapshot path."""
        return self.page_root(page_id) / f"{timestamp}.md"

    def read_version(self, page_id: str, timestamp: str) -> str:
        """Read one snapshot as UTF-8 Markdown."""
        return read_vault_text(self.version_path(page_id, timestamp), root=self.vault_root)

    def restore_version(
        self,
        page_id: str,
        timestamp: str,
        current_path: Path,
    ) -> None:
        """Replace a current page with one immutable snapshot."""
        self._copy_source(self.version_path(page_id, timestamp), current_path)

    def purge(self, page_id: str) -> bool:
        """Delete all snapshots and report whether a history root existed."""
        history_root = self.page_root(page_id)
        if not history_root.exists():
            return False
        shutil.rmtree(history_root)
        return True


__all__ = ["HistoryRepository"]
