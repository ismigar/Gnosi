"""Unit tests for the table system-date schema and stamping contract."""

from backend.services.table_system_dates import (
    ensure_system_date_properties,
    stamp_system_dates,
)


def test_ensure_creates_localized_read_only_system_properties():
    table = {"id": "table-1", "properties": [{"id": "title", "name": "Title", "type": "title"}]}

    ensure_system_date_properties(table, "en-US")

    props = {prop["name"]: prop for prop in table["properties"]}
    assert props["Creation date"]["type"] == "created_time"
    assert props["Creation date"]["read_only"] is True
    assert props["Last modified"]["type"] == "last_edited_time"
    assert props["Last modified"]["system_date_role"] == "modified"


def test_ensure_absorbs_legacy_duplicate_and_preserves_value_alias():
    table = {
        "id": "table-1",
        "properties": [
            {"id": "old-created", "name": "Date Added", "type": "created_time"},
            {"id": "new-created", "name": "Data de creació", "type": "created_time"},
            {"id": "old-modified", "name": "Última edició", "type": "last_edited_time"},
        ],
    }

    ensure_system_date_properties(table, "ca")

    names = [prop["name"] for prop in table["properties"]]
    assert names.count("Data de creació") == 1
    assert names.count("Última modificació") == 1
    assert "Date Added" in next(p for p in table["properties"] if p["name"] == "Data de creació")["aliases"]
    assert "Última edició" in next(p for p in table["properties"] if p["name"] == "Última modificació")["aliases"]
    assert "new-created" not in {prop.get("id") for prop in table["properties"]}


def test_stamp_preserves_creation_and_refreshes_modification():
    table = {"id": "table-1", "properties": []}
    ensure_system_date_properties(table, "ca")
    metadata = {"Data de creació": "2024-01-01T00:00:00+00:00"}

    stamp_system_dates(
        metadata,
        table,
        is_create=False,
        now="2026-08-08T10:00:00+00:00",
    )

    assert metadata["Data de creació"] == "2024-01-01T00:00:00+00:00"
    assert metadata["Última modificació"] == "2026-08-08T10:00:00+00:00"
