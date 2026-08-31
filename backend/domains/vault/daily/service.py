"""Provider-neutral daily-note discovery and atomic get-or-create workflows."""

from __future__ import annotations

import asyncio
import logging
import re
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from pathlib import Path

from backend.domains.vault.registry.records import is_record
from backend.domains.vault.registry.state import RegistryData

Metadata = RegistryData
DailySource = tuple[Metadata | None, Metadata | None]
DailyNote = dict[str, object]

_DAILY_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


@dataclass(frozen=True)
class DailyNotesDependencies:
    """Late-bound storage, table, page-command, and synchronization ports."""

    templates_directory: Callable[[], Path]
    daily_directory: Callable[[], Path]
    parse_frontmatter: Callable[[str, Path], tuple[Metadata, str]]
    plugin_state: Callable[[], Metadata]
    table_by_id: Callable[[str], Metadata | None]
    pages_for_table: Callable[[object], list[object]]
    read_property: Callable[[Metadata, Metadata], object]
    effect_write_key: Callable[[Metadata, Metadata], str | None]
    source_config: Callable[[], DailySource]
    find_in_table: Callable[[Metadata, Metadata, str], str | None]
    find_in_folder: Callable[[str], str | None]
    template_content: Callable[[], str]
    get_page: Callable[[str], Awaitable[object]]
    create_page: Callable[[str, str, Metadata, object], Awaitable[object]]
    creation_lock: asyncio.Lock
    logger: logging.Logger


def _metadata(page: object) -> Metadata:
    raw_metadata = getattr(page, "metadata", None)
    return raw_metadata if is_record(raw_metadata) else {}


def _page_id(page: object) -> object:
    return getattr(page, "id", None)


def load_template_content(dependencies: DailyNotesDependencies) -> str:
    """Return the configured daily template body, or an empty string."""
    try:
        templates_directory = dependencies.templates_directory()
        if not templates_directory.exists():
            return ""
        for file_path in templates_directory.glob("*.md"):
            try:
                metadata, body = dependencies.parse_frontmatter(
                    file_path.read_text(encoding="utf-8"),
                    file_path,
                )
            except Exception:
                continue
            if metadata.get("is_daily_template") is True:
                return (body or "").strip()
    except Exception as error:
        dependencies.logger.warning(
            "Could not load daily-note template: %s",
            error,
        )
    return ""


def find_folder_note_id(
    date: str,
    dependencies: DailyNotesDependencies,
) -> str | None:
    """Return the page identifier for one folder-backed daily note."""
    daily_directory = dependencies.daily_directory()
    if not daily_directory.exists():
        return None
    direct = daily_directory / f"{date}.md"
    if direct.exists():
        try:
            metadata, _body = dependencies.parse_frontmatter(
                direct.read_text(encoding="utf-8"),
                direct,
            )
            page_id = metadata.get("id")
            if page_id:
                return str(page_id)
        except Exception:
            pass
    for file_path in daily_directory.glob("*.md"):
        try:
            metadata, _body = dependencies.parse_frontmatter(
                file_path.read_text(encoding="utf-8"),
                file_path,
            )
        except Exception:
            continue
        if str(metadata.get("note_type") or "").lower() != "daily":
            continue
        if str(metadata.get("date") or "") != date:
            continue
        page_id = metadata.get("id")
        if page_id:
            return str(page_id)
    return None


def normalize_date(value: object) -> str:
    """Normalize a stored date or datetime to the daily-note day key."""
    normalized = str(value or "").strip()
    return normalized[:10] if _DAILY_DATE_RE.match(normalized[:10]) else normalized


def resolve_source(dependencies: DailyNotesDependencies) -> DailySource:
    """Resolve the optional table and date property backing daily notes."""
    try:
        state = dependencies.plugin_state()
        raw_settings = state.get("settings") or {}
        if not isinstance(raw_settings, dict):
            return None, None
        raw_config = raw_settings.get("daily-notes") or {}
        if not isinstance(raw_config, dict):
            return None, None
        table_id = str(raw_config.get("source_table_id") or "").strip()
        if not table_id:
            return None, None
        table = dependencies.table_by_id(table_id)
        if not table:
            return None, None
        raw_properties = table.get("properties") or []
        if not isinstance(raw_properties, list):
            return None, None
        properties = [item for item in raw_properties if isinstance(item, dict)]
        date_reference = str(raw_config.get("date_property") or "").strip()
        date_property: Metadata | None = None
        if date_reference:
            date_property = next(
                (
                    prop
                    for prop in properties
                    if prop.get("id") == date_reference or prop.get("name") == date_reference
                ),
                None,
            )
        if date_property is None:
            date_property = next(
                (prop for prop in properties if prop.get("type") == "date"),
                None,
            )
        return (table, date_property) if date_property else (None, None)
    except Exception as error:
        dependencies.logger.warning(
            "Could not resolve daily-notes source table: %s",
            error,
        )
        return None, None


def find_table_note_id(
    table: Metadata,
    date_property: Metadata,
    date: str,
    dependencies: DailyNotesDependencies,
) -> str | None:
    """Return the row identifier whose configured date equals the day key."""
    try:
        pages = dependencies.pages_for_table(table.get("id"))
    except Exception:
        return None
    for page in pages:
        metadata = _metadata(page)
        if metadata.get("is_template"):
            continue
        if normalize_date(dependencies.read_property(metadata, date_property)) != date:
            continue
        page_id = metadata.get("id") or _page_id(page)
        if page_id:
            return str(page_id)
    return None


async def list_notes(dependencies: DailyNotesDependencies) -> list[DailyNote]:
    """List configured table-backed or folder-backed daily notes newest first."""
    table, date_property = await asyncio.to_thread(dependencies.source_config)
    if table and date_property:
        try:
            pages = await asyncio.to_thread(
                dependencies.pages_for_table,
                table.get("id"),
            )
        except Exception:
            pages = []
        notes: list[DailyNote] = []
        for page in pages:
            metadata = _metadata(page)
            if metadata.get("is_template"):
                continue
            date = normalize_date(
                dependencies.read_property(metadata, date_property),
            )
            if not _DAILY_DATE_RE.match(date):
                continue
            notes.append(
                {
                    "id": str(metadata.get("id") or _page_id(page) or ""),
                    "date": date,
                    "title": metadata.get("title") or date,
                }
            )
        notes.sort(key=lambda note: str(note["date"]), reverse=True)
        return notes

    notes = []
    daily_directory = dependencies.daily_directory()
    if daily_directory.exists():
        for file_path in daily_directory.glob("*.md"):
            try:
                metadata, _body = dependencies.parse_frontmatter(
                    file_path.read_text(encoding="utf-8"),
                    file_path,
                )
            except Exception:
                continue
            if str(metadata.get("note_type") or "").lower() != "daily":
                continue
            date = str(metadata.get("date") or file_path.stem)
            notes.append(
                {
                    "id": str(metadata.get("id") or ""),
                    "date": date,
                    "title": metadata.get("title") or date,
                }
            )
    notes.sort(key=lambda note: str(note["date"]), reverse=True)
    return notes


async def get_or_create_note(
    date: str,
    background_tasks: object,
    dependencies: DailyNotesDependencies,
) -> object:
    """Atomically retrieve or create one table-backed or folder-backed note."""
    async with dependencies.creation_lock:
        table, date_property = await asyncio.to_thread(dependencies.source_config)
        if table and date_property:
            existing_id = await asyncio.to_thread(
                dependencies.find_in_table,
                table,
                date_property,
                date,
            )
            if existing_id:
                return await dependencies.get_page(existing_id)
            content = await asyncio.to_thread(dependencies.template_content)
            write_key = (
                dependencies.effect_write_key({}, date_property)
                or str(date_property.get("name") or "")
                or str(date_property.get("id") or "")
            )
            return await dependencies.create_page(
                date,
                content,
                {
                    "database_table_id": table.get("id"),
                    write_key: date,
                },
                background_tasks,
            )

        existing_id = await asyncio.to_thread(dependencies.find_in_folder, date)
        if existing_id:
            return await dependencies.get_page(existing_id)
        content = await asyncio.to_thread(dependencies.template_content)
        return await dependencies.create_page(
            date,
            content,
            {"note_type": "daily", "date": date},
            background_tasks,
        )


def valid_date(value: str) -> bool:
    """Return whether a client day key has the stable ISO date shape."""
    return _DAILY_DATE_RE.match(value) is not None


__all__ = [
    "DailyNote",
    "DailyNotesDependencies",
    "DailySource",
    "Metadata",
    "find_folder_note_id",
    "find_table_note_id",
    "get_or_create_note",
    "list_notes",
    "load_template_content",
    "normalize_date",
    "resolve_source",
    "valid_date",
]
