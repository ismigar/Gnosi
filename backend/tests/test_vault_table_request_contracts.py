"""Explicit request contracts for the historical vault table mutations."""

from __future__ import annotations

import asyncio
from types import SimpleNamespace

from fastapi import FastAPI
import pytest

from backend.domains.vault.tables import api, lifecycle, options, routes
from backend.domains.vault.tables.contracts import (
    DatabaseUpsertRequest,
    TableOptionRemoveRequest,
    TableOptionRenameRequest,
    TableRenameRequest,
    TableUpsertRequest,
)


REQUEST_MODELS = {
    ("/api/vault/databases", "post"): DatabaseUpsertRequest,
    ("/api/vault/tables", "post"): TableUpsertRequest,
    ("/api/vault/tables/{table_id}", "put"): TableRenameRequest,
    (
        "/api/vault/tables/{table_id}/options/remove",
        "post",
    ): TableOptionRemoveRequest,
    (
        "/api/vault/tables/{table_id}/options/rename",
        "post",
    ): TableOptionRenameRequest,
}


def _schema() -> dict[str, object]:
    app = FastAPI()
    app.include_router(routes.router, prefix="/api/vault")
    return app.openapi()


def test_target_routes_reference_named_request_models() -> None:
    schema = _schema()
    paths = schema["paths"]
    assert isinstance(paths, dict)

    for (path, method), request_model in REQUEST_MODELS.items():
        operation = paths[path][method]
        body_schema = operation["requestBody"]["content"]["application/json"]["schema"]
        assert body_schema == {
            "$ref": f"#/components/schemas/{request_model.__name__}",
        }


def test_request_models_publish_the_historical_consumed_fields() -> None:
    schema = _schema()
    components = schema["components"]
    assert isinstance(components, dict)
    models = components["schemas"]

    expected_properties = {
        "DatabaseUpsertRequest": {"id", "name", "folder"},
        "TableUpsertRequest": {
            "id",
            "name",
            "folder",
            "database_id",
            "properties",
            "locale",
            "language",
            "schema_revision",
        },
        "TableRenameRequest": {"name", "folder"},
        "TableOptionRenameRequest": {"field_id", "field", "old", "new"},
        "TableOptionRemoveRequest": {
            "field_id",
            "field",
            "value",
            "reassign_to",
        },
    }
    for model_name, property_names in expected_properties.items():
        model_schema = models[model_name]
        assert property_names <= set(model_schema["properties"])


def test_full_registry_upserts_preserve_unknown_extension_keys() -> None:
    database_payload = {
        "id": "db-legacy",
        "name": "Legacy",
        "extension_settings": {"provider": "plugin", "enabled": True},
    }
    table_payload = {
        "id": "table-legacy",
        "name": "Legacy",
        "properties": [],
        "plugin_contract": {"version": 2, "flags": ["a", "b"]},
    }

    assert (
        DatabaseUpsertRequest.model_validate(database_payload).registry_data() == database_payload
    )
    assert TableUpsertRequest.model_validate(table_payload).registry_data() == table_payload


def test_command_bodies_ignore_unknown_keys_like_the_2x_handlers() -> None:
    rename = TableRenameRequest.model_validate(
        {"name": "Renamed", "folder": None, "ignored": {"nested": True}}
    )
    option_rename = TableOptionRenameRequest.model_validate(
        {"field": "Status", "old": 1, "new": ["open"], "ignored": "value"}
    )
    option_remove = TableOptionRemoveRequest.model_validate(
        {"field_id": "status", "value": False, "reassign_to": 0, "ignored": 7}
    )

    assert rename.registry_data() == {"name": "Renamed", "folder": None}
    assert option_rename.registry_data() == {
        "field": "Status",
        "old": 1,
        "new": ["open"],
    }
    assert option_remove.registry_data() == {
        "field_id": "status",
        "value": False,
        "reassign_to": 0,
    }


def test_absent_and_explicit_null_remain_distinct_at_service_boundary() -> None:
    assert TableRenameRequest.model_validate({}).registry_data() == {}
    assert TableRenameRequest.model_validate({"name": None}).registry_data() == {"name": None}


def test_option_field_selector_retains_2x_string_boundary() -> None:
    assert options._legacy_field_reference({"field_id": "  status  "}) == "status"
    assert options._legacy_field_reference({"field": "  Estat  "}) == "Estat"
    with pytest.raises(
        AttributeError,
        match="'list' object has no attribute 'strip'",
    ):
        options._legacy_field_reference({"field_id": ["status"]})


def test_handlers_forward_only_the_historical_payload(monkeypatch: pytest.MonkeyPatch) -> None:
    dependencies = SimpleNamespace(
        collections=object(),
        create_table=object(),
        rename_table=object(),
        options=object(),
    )
    monkeypatch.setattr(routes, "_configured", lambda: dependencies)
    received: list[tuple[str, object, object]] = []

    async def create_database(payload: object, dependency: object) -> dict[str, str]:
        received.append(("database", payload, dependency))
        return {"status": "ok"}

    async def create_table(payload: object, dependency: object) -> dict[str, str]:
        received.append(("table", payload, dependency))
        return {"status": "ok"}

    async def rename_table(
        table_id: str,
        payload: object,
        dependency: object,
    ) -> dict[str, str]:
        received.append((table_id, payload, dependency))
        return {"status": "success"}

    async def mutate_option(
        table_id: str,
        payload: object,
        dependency: object,
    ) -> dict[str, str]:
        received.append((table_id, payload, dependency))
        return {"status": "ok"}

    monkeypatch.setattr(api, "create_database", create_database)
    monkeypatch.setattr(lifecycle, "create_table", create_table)
    monkeypatch.setattr(lifecycle, "rename_table", rename_table)
    monkeypatch.setattr(options, "rename_table_option", mutate_option)
    monkeypatch.setattr(options, "remove_table_option", mutate_option)

    async def exercise() -> None:
        await routes.create_database(
            DatabaseUpsertRequest.model_validate({"name": "DB", "plugin": {"v": 2}})
        )
        await routes.create_table(
            TableUpsertRequest.model_validate({"name": "Table", "plugin": {"v": 2}})
        )
        await routes.rename_table(
            "table",
            TableRenameRequest.model_validate({"name": "New", "ignored": True}),
        )
        await routes.rename_table_option(
            "table",
            TableOptionRenameRequest.model_validate(
                {"field": "Status", "old": "A", "new": "B", "ignored": True}
            ),
        )
        await routes.remove_table_option(
            "table",
            TableOptionRemoveRequest.model_validate(
                {"field_id": "status", "value": "B", "ignored": True}
            ),
        )

    asyncio.run(exercise())

    assert received == [
        ("database", {"name": "DB", "plugin": {"v": 2}}, dependencies.collections),
        ("table", {"name": "Table", "plugin": {"v": 2}}, dependencies.create_table),
        ("table", {"name": "New"}, dependencies.rename_table),
        (
            "table",
            {"field": "Status", "old": "A", "new": "B"},
            dependencies.options,
        ),
        ("table", {"field_id": "status", "value": "B"}, dependencies.options),
    ]
