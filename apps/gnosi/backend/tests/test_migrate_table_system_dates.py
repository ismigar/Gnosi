"""Tests for system-date schema migration and Notion timestamp backfill."""

from pathlib import Path

import yaml

from backend.services.notion_clone import clone_page_id, clone_table_id
from backend.services.table_system_dates import ensure_system_date_properties
from pipeline.scripts.migrate_table_system_dates import (
    _migrate_page,
    build_notion_timestamp_index,
    migrate_registry,
)


class _FakeNotionClient:
    def __init__(self, rows_by_database):
        self.rows_by_database = rows_by_database

    def query_database(self, database_id):
        return iter(self.rows_by_database[database_id])


def _frontmatter(path: Path):
    text = path.read_text(encoding="utf-8")
    return yaml.safe_load(text.split("---", 2)[1])


def test_build_notion_timestamp_index_uses_deterministic_clone_ids():
    database_id = "1dd268e5-2714-8010-8b93-efdb677bf55f"
    page_id = "102268e5-2714-80ec-a429-f8423a32b0ad"
    client = _FakeNotionClient({
        database_id: [{
            "id": page_id,
            "created_time": "2024-01-02T03:04:05.000Z",
            "last_edited_time": "2026-07-08T09:10:11.000Z",
        }],
    })

    index, report = build_notion_timestamp_index(
        client,
        {"databases": [{"id": database_id, "title": "Cinema"}]},
    )

    assert index[clone_table_id(database_id)][clone_page_id(page_id)] == {
        "created": "2024-01-02T03:04:05.000Z",
        "modified": "2026-07-08T09:10:11.000Z",
    }
    assert report == {
        "notion_databases": 1,
        "notion_source_rows": 1,
        "notion_rows_without_dates": 0,
    }


def test_build_notion_timestamp_index_reports_incomplete_audit_dates():
    database_id = "1dd268e5-2714-8010-8b93-efdb677bf55f"
    client = _FakeNotionClient({
        database_id: [{
            "id": "102268e5-2714-80ec-a429-f8423a32b0ad",
            "created_time": "2024-01-02T03:04:05.000Z",
            "last_edited_time": "",
        }],
    })

    _, report = build_notion_timestamp_index(
        client,
        {"databases": [{"id": database_id, "title": "Cinema"}]},
    )

    assert report["notion_rows_without_dates"] == 1


def test_migrate_page_prefers_notion_dates_and_preserves_other_date_fields(tmp_path):
    table = {
        "id": "table-1",
        "properties": [
            {"id": "title", "name": "Title", "type": "title"},
            {"id": "contact", "name": "Data de l'últim contacte", "type": "date"},
            {"id": "created-at", "name": "created_at", "type": "date"},
            {"id": "legacy-created", "name": "Date Added", "type": "created_time"},
            {"id": "legacy-modified", "name": "Last edited", "type": "last_edited_time"},
        ],
    }
    ensure_system_date_properties(table, "ca")
    page_id = "page-1"
    page = tmp_path / "row.md"
    page.write_text(
        "---\n"
        f"id: {page_id}\n"
        "Data de l'últim contacte: 2025-05-06\n"
        "created_at: 2023-01-01\n"
        "Date Added: 2022-01-01\n"
        "Last edited: 2022-02-02\n"
        "---\nBody\n",
        encoding="utf-8",
    )
    backup_root = tmp_path / "backup"

    result, matched, migrated_page_id = _migrate_page(
        page,
        table,
        "ca",
        False,
        notion_dates_by_page={
            page_id: {
                "created": "2020-03-04T05:06:07.000Z",
                "modified": "2026-08-09T10:11:12.000Z",
            },
        },
        vault=tmp_path,
        backup_root=backup_root,
    )

    metadata = _frontmatter(page)
    assert (result, matched, migrated_page_id) == ("migrated", True, page_id)
    assert metadata["Data de creació"] == "2020-03-04T05:06:07.000Z"
    assert metadata["Última modificació"] == "2026-08-09T10:11:12.000Z"
    assert str(metadata["Data de l'últim contacte"]) == "2025-05-06"
    assert str(metadata["created_at"]) == "2023-01-01"
    assert "Date Added" not in metadata
    assert "Last edited" not in metadata
    assert (backup_root / "row.md").exists()


def test_migrate_registry_keeps_unrelated_date_and_places_system_dates_last():
    registry = {
        "tables": [{
            "id": "table-1",
            "properties": [
                {"id": "title", "name": "Name", "type": "title"},
                {"id": "contact", "name": "Data de l'últim contacte", "type": "date"},
            ],
        }],
        "views": [],
    }

    migrated, report = migrate_registry(registry, "ca")

    properties = migrated["tables"][0]["properties"]
    assert [prop["name"] for prop in properties] == [
        "Name",
        "Data de l'últim contacte",
        "Data de creació",
        "Última modificació",
    ]
    assert properties[1]["type"] == "date"
    assert report["tables"] == 1
