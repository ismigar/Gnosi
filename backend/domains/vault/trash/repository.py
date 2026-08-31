"""Filesystem repository for soft-deleted vault pages."""

from __future__ import annotations

import json
import logging
import shutil
from collections.abc import Callable
from datetime import datetime, timezone
from pathlib import Path
from typing import Protocol

from backend.domains.vault.pages.foundation_values import PageMetadata
from backend.domains.vault.registry.records import is_record

FrontmatterParser = Callable[[str, Path | None], tuple[PageMetadata, str]]
TrashMetadata = dict[object, object]


class JsonWriter(Protocol):
    """Atomic JSON writer supplied by the platform boundary."""

    def __call__(self, path: Path, obj: object, **dumps_kwargs: object) -> None: ...


log = logging.getLogger(__name__)


class TrashRepository:
    """Move, restore and list trash entries below one vault root."""

    def __init__(
        self,
        vault_root: Path,
        *,
        retention_days: int,
        parse_frontmatter: FrontmatterParser,
        write_json: JsonWriter,
    ) -> None:
        self.vault_root = vault_root
        self.retention_days = retention_days
        self.parse_frontmatter = parse_frontmatter
        self.write_json = write_json

    def root(self) -> Path:
        root = self.vault_root / ".trash"
        root.mkdir(parents=True, exist_ok=True)
        return root

    def entry_dir(self, page_id: str) -> Path:
        normalized = str(page_id or "").strip()
        if (
            not normalized
            or normalized in {".", ".."}
            or "/" in normalized
            or "\\" in normalized
            or "\x00" in normalized
        ):
            raise ValueError(f"Unsafe trash entry id: {page_id!r}")
        return self.root() / normalized

    def move_page(self, page_id: str, file_path: Path) -> TrashMetadata:
        entry_dir = self.entry_dir(page_id)
        sidecar_path = entry_dir / "_trash.json"
        if sidecar_path.exists():
            if not file_path.exists():
                try:
                    data: object = json.loads(sidecar_path.read_text(encoding="utf-8"))
                    if is_record(data):
                        return data
                except (OSError, json.JSONDecodeError):
                    pass
            else:
                log.warning(
                    "Trash slot %s already occupied while trashing %s; "
                    "overwriting the stale entry.",
                    page_id,
                    file_path,
                )
                shutil.rmtree(entry_dir, ignore_errors=True)

        entry_dir.mkdir(parents=True, exist_ok=True)
        title = ""
        table_id: object = None
        original_parent_id: object = None
        try:
            raw_content = file_path.read_text(encoding="utf-8")
            metadata, _ = self.parse_frontmatter(raw_content, file_path)
            title = str(metadata.get("title") or "")
            table_id = metadata.get("table_id") or metadata.get("database_table_id")
            original_parent_id = metadata.get("parent_id")
        except (OSError, ValueError, TypeError) as exc:
            log.warning("Could not read frontmatter for %s: %s", page_id, exc)

        try:
            original_path = str(file_path.relative_to(self.vault_root))
        except ValueError as exc:
            raise RuntimeError(
                f"Page file {file_path} is outside the Vault root {self.vault_root}"
            ) from exc

        try:
            size_bytes = file_path.stat().st_size
        except OSError:
            size_bytes = 0

        shutil.move(str(file_path), str(entry_dir / "page.md"))
        sidecar: TrashMetadata = {
            "id": page_id,
            "title": title,
            "deleted_at": datetime.now(tz=timezone.utc).isoformat(),
            "original_path": original_path,
            "original_parent_id": original_parent_id,
            "table_id": table_id,
            "size_bytes": size_bytes,
            "extension": file_path.suffix or ".md",
        }
        self.write_json(sidecar_path, sidecar, indent=2)
        return sidecar

    def restore_page(self, page_id: str) -> TrashMetadata:
        vault_root_resolved = self.vault_root.resolve()
        entry_dir = self.entry_dir(page_id)
        sidecar_path = entry_dir / "_trash.json"
        if not sidecar_path.exists():
            raise FileNotFoundError(f"No trash entry for {page_id}")

        loaded: object = json.loads(sidecar_path.read_text(encoding="utf-8"))
        if not is_record(loaded):
            raise ValueError(f"Invalid trash sidecar for {page_id}")
        sidecar = dict(loaded)
        original_path = str(sidecar.get("original_path") or f"{page_id}.md")
        target = (self.vault_root / original_path).resolve()
        if not target.is_relative_to(vault_root_resolved):
            raise PermissionError(f"original_path escapes Vault: {original_path}")
        if target.exists():
            raise FileExistsError(str(target))

        target.parent.mkdir(parents=True, exist_ok=True)
        source = entry_dir / "page.md"
        if not source.exists():
            candidates = [
                path
                for path in entry_dir.iterdir()
                if path.is_file() and path.suffix in {".md", ".json"} and path.name != "_trash.json"
            ]
            if not candidates:
                raise FileNotFoundError(f"page.md missing in {entry_dir}")
            source = candidates[0]

        shutil.move(str(source), str(target))
        shutil.rmtree(entry_dir, ignore_errors=True)
        sidecar["restored_path"] = str(target.relative_to(vault_root_resolved))
        return sidecar

    def list_entries(self) -> list[TrashMetadata]:
        entries: list[TrashMetadata] = []
        now_utc = datetime.now(tz=timezone.utc)
        for entry_dir in self.root().iterdir():
            if not entry_dir.is_dir():
                continue
            sidecar_path = entry_dir / "_trash.json"
            if sidecar_path.exists():
                try:
                    loaded: object = json.loads(sidecar_path.read_text(encoding="utf-8"))
                    data = dict(loaded) if is_record(loaded) else {}
                except (OSError, json.JSONDecodeError) as exc:
                    log.warning("Corrupt sidecar at %s: %s", entry_dir, exc)
                    data = {
                        "id": entry_dir.name,
                        "title": "(corrupt)",
                        "deleted_at": None,
                    }
            else:
                data = {
                    "id": entry_dir.name,
                    "title": "(sense metadades)",
                    "deleted_at": None,
                }

            days_remaining: int | None = None
            if data.get("deleted_at"):
                try:
                    deleted_at = datetime.fromisoformat(str(data["deleted_at"]))
                    if deleted_at.tzinfo is None:
                        deleted_at = deleted_at.replace(tzinfo=timezone.utc)
                    days_remaining = max(
                        0,
                        self.retention_days - (now_utc - deleted_at).days,
                    )
                except ValueError:
                    pass
            data["days_remaining"] = days_remaining
            entries.append(data)
        entries.sort(key=lambda item: str(item.get("deleted_at") or ""), reverse=True)
        return entries


__all__ = ["FrontmatterParser", "JsonWriter", "TrashMetadata", "TrashRepository"]
