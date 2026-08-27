"""Unit tests for the table system-date schema and stamping contract."""

from types import SimpleNamespace

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


def test_ensure_keeps_system_dates_last_without_touching_ordinary_dates():
    table = {
        "id": "table-1",
        "properties": [
            {"id": "modified", "name": "Last edited", "type": "last_edited_time"},
            {"id": "title", "name": "Title", "type": "title"},
            {"id": "event", "name": "Event date", "type": "date"},
            {"id": "created", "name": "Created at", "type": "created_time"},
        ],
    }

    ensure_system_date_properties(table, "en")

    assert [prop["name"] for prop in table["properties"]] == [
        "Title",
        "Event date",
        "Creation date",
        "Last modified",
    ]
    event_date = next(
        prop for prop in table["properties"] if prop["name"] == "Event date"
    )
    assert event_date["type"] == "date"


def test_ensure_preserves_internal_authorship_date_properties():
    table = {
        "id": "table-1",
        "properties": [
            {"id": "title", "name": "Title", "type": "title"},
            {"id": "created-at", "name": "created_at", "type": "date"},
            {"id": "edited-at", "name": "last_edited_at", "type": "date"},
        ],
    }

    ensure_system_date_properties(table, "en")

    props = {prop["name"]: prop for prop in table["properties"]}
    assert props["created_at"]["type"] == "date"
    assert props["last_edited_at"]["type"] == "date"
    assert props["Creation date"]["type"] == "created_time"
    assert props["Last modified"]["type"] == "last_edited_time"


def test_table_creation_uses_interface_language_from_settings(monkeypatch, tmp_path):
    monkeypatch.setenv("GNOSI_DATA_DIR", str(tmp_path / "local-data"))
    monkeypatch.setenv("DIGITAL_BRAIN_VAULT_PATH", str(tmp_path / "vault"))
    from backend.api import vault_routes

    registry = {
        "databases": [{"id": "db-1", "name": "Test"}],
        "tables": [],
        "views": [],
    }
    monkeypatch.setattr(vault_routes, "load_registry", lambda: registry)
    monkeypatch.setattr(vault_routes, "save_registry", lambda value: None)
    monkeypatch.setattr(
        vault_routes,
        "load_params",
        lambda strict_env=False: SimpleNamespace(settings={"language": "fr"}),
    )
    monkeypatch.setattr(
        vault_routes, "_ensure_asset_dirs_for_table_entry", lambda *args: None
    )
    monkeypatch.setattr(
        vault_routes, "_ensure_table_vault_folder", lambda *args: None
    )
    monkeypatch.setattr(
        vault_routes.option_catalogs_service,
        "ensure_table_seeds",
        lambda *args: None,
    )
    monkeypatch.setattr(
        vault_routes.action_rules_service,
        "ensure_action_rules",
        lambda *args: None,
    )

    table = vault_routes._create_table_locked({
        "id": "table-1",
        "database_id": "db-1",
        "name": "Example",
        "properties": [{"id": "title", "name": "Title", "type": "title"}],
    })

    assert [prop["name"] for prop in table["properties"][-2:]] == [
        "Date de création",
        "Dernière modification",
    ]
