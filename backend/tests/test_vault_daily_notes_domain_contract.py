"""Behavior and architecture contracts for the Vault daily-note domain."""

from __future__ import annotations

import asyncio
import json
import logging
from dataclasses import dataclass, replace
from pathlib import Path
from typing import cast

from backend.domains.vault.daily import service


@dataclass
class _Page:
    metadata: service.Metadata
    id: str


def _dependencies(tmp_path: Path) -> service.DailyNotesDependencies:
    templates = tmp_path / "Templates"
    daily = tmp_path / "Daily Notes"

    def parse_frontmatter(raw: str, _path: Path) -> tuple[service.Metadata, str]:
        payload = cast(service.Metadata, json.loads(raw))
        body = str(payload.pop("body", ""))
        return payload, body

    async def get_page(page_id: str) -> object:
        return {"id": page_id}

    async def create_page(
        title: str,
        _content: str,
        _metadata: service.Metadata,
        _background_tasks: object,
    ) -> object:
        return {"id": title, "title": title}

    return service.DailyNotesDependencies(
        templates_directory=lambda: templates,
        daily_directory=lambda: daily,
        parse_frontmatter=parse_frontmatter,
        plugin_state=lambda: {},
        table_by_id=lambda _table_id: None,
        pages_for_table=lambda _table_id: [],
        read_property=lambda metadata, prop: metadata.get(str(prop.get("name"))),
        effect_write_key=lambda _metadata, prop: str(prop.get("name") or "date"),
        source_config=lambda: (None, None),
        find_in_table=lambda _table, _prop, _date: None,
        find_in_folder=lambda _date: None,
        template_content=lambda: "",
        get_page=get_page,
        create_page=create_page,
        creation_lock=asyncio.Lock(),
        logger=logging.getLogger(__name__),
    )


def test_folder_inventory_and_template_content(tmp_path: Path) -> None:
    dependencies = _dependencies(tmp_path)
    templates = dependencies.templates_directory()
    daily = dependencies.daily_directory()
    templates.mkdir(parents=True)
    daily.mkdir(parents=True)
    (templates / "Daily.md").write_text(
        json.dumps({"is_daily_template": True, "body": "  Seed  "}),
        encoding="utf-8",
    )
    (daily / "2026-08-27.md").write_text(
        json.dumps(
            {
                "id": "older",
                "note_type": "daily",
                "date": "2026-08-27",
                "title": "Older",
            }
        ),
        encoding="utf-8",
    )
    (daily / "2026-08-28.md").write_text(
        json.dumps(
            {
                "id": "newer",
                "note_type": "daily",
                "date": "2026-08-28",
            }
        ),
        encoding="utf-8",
    )

    assert service.load_template_content(dependencies) == "Seed"
    assert service.find_folder_note_id("2026-08-28", dependencies) == "newer"
    assert asyncio.run(service.list_notes(dependencies)) == [
        {"id": "newer", "date": "2026-08-28", "title": "2026-08-28"},
        {"id": "older", "date": "2026-08-27", "title": "Older"},
    ]


def test_table_source_auto_detects_date_and_lists_rows(tmp_path: Path) -> None:
    dependencies = _dependencies(tmp_path)
    table: service.Metadata = {
        "id": "journal",
        "properties": [
            {"id": "headline", "name": "Title", "type": "text"},
            {"id": "day", "name": "Day", "type": "date"},
        ],
    }
    pages: list[object] = [
        _Page(
            {"id": "row-1", "Day": "2026-08-28T08:30:00", "title": "Today"},
            "row-1",
        ),
        _Page({"id": "template", "is_template": True, "Day": "2026-08-29"}, "t"),
    ]
    dependencies = replace(
        dependencies,
        plugin_state=lambda: {"settings": {"daily-notes": {"source_table_id": "journal"}}},
        table_by_id=lambda table_id: table if table_id == "journal" else None,
        pages_for_table=lambda _table_id: pages,
    )
    source = service.resolve_source(dependencies)
    dependencies = replace(dependencies, source_config=lambda: source)

    assert source[1] == {"id": "day", "name": "Day", "type": "date"}
    assert asyncio.run(service.list_notes(dependencies)) == [
        {"id": "row-1", "date": "2026-08-28", "title": "Today"}
    ]


def test_get_or_create_is_atomic_and_idempotent(tmp_path: Path) -> None:
    dependencies = _dependencies(tmp_path)
    existing: list[str] = []
    created: list[str] = []

    def find_in_folder(_date: str) -> str | None:
        return existing[0] if existing else None

    async def create_page(
        title: str,
        _content: str,
        _metadata: service.Metadata,
        _background_tasks: object,
    ) -> object:
        created.append(title)
        existing.append("daily-id")
        return {"id": "daily-id"}

    dependencies = replace(
        dependencies,
        find_in_folder=find_in_folder,
        create_page=create_page,
    )

    async def scenario() -> list[object]:
        return list(
            await asyncio.gather(
                service.get_or_create_note("2026-08-28", None, dependencies),
                service.get_or_create_note("2026-08-28", None, dependencies),
            )
        )

    assert asyncio.run(scenario()) == [{"id": "daily-id"}, {"id": "daily-id"}]
    assert created == ["2026-08-28"]


def test_daily_notes_domain_does_not_import_http_facade() -> None:
    source_path = Path(service.__file__ or "")
    assert source_path.is_file()
    assert "backend.api.vault_routes" not in source_path.read_text(encoding="utf-8")
