"""Typed response contracts consumed by NotionImportSettings."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any, get_type_hints

from fastapi.routing import APIRoute
from pydantic import ValidationError
import pytest

from backend.api import notion_oauth_routes, notion_routes
from backend.services import notion_importer, notion_mcp, notion_schema_config


def _route(router: Any, method: str, path: str) -> APIRoute:
    return next(
        route
        for route in router.routes
        if isinstance(route, APIRoute) and route.path == path and method in (route.methods or set())
    )


def test_import_settings_routes_publish_typed_json_contracts() -> None:
    expected = {
        ("POST", "/notion/token"): notion_routes.NotionTokenResponse,
        ("GET", "/notion/status"): notion_routes.NotionStatusResponse,
        ("DELETE", "/notion/token"): notion_routes.NotionMutationResponse,
        ("GET", "/notion/import-config"): notion_routes.NotionImportConfigResponse,
        ("PUT", "/notion/import-config"): notion_routes.NotionMutationResponse,
        ("GET", "/notion/databases"): notion_routes.NotionDatabasesResponse,
        (
            "GET",
            "/notion/databases/{db_id}/schema",
        ): notion_routes.NotionDatabaseSchemaResponse,
        (
            "GET",
            "/notion/linked-databases",
        ): notion_routes.NotionLinkedDatabasesResponse,
        ("GET", "/notion/loose-pages"): notion_routes.NotionLoosePagesResponse,
        (
            "GET",
            "/notion/clone/progress",
        ): notion_routes.NotionCloneProgressResponse,
        ("POST", "/notion/clone/abort"): notion_routes.NotionCloneAbortResponse,
        ("POST", "/notion/clone"): notion_routes.NotionCloneResponse,
        (
            "POST",
            "/notion/verify-clone",
        ): notion_routes.NotionVerificationResponse,
    }

    for (method, path), response_model in expected.items():
        route = _route(notion_routes.router, method, path)
        assert route.status_code is None
        assert route.response_model is response_model

    oauth_status = _route(notion_oauth_routes.router, "GET", "/notion-oauth/status")
    assert oauth_status.response_model is notion_oauth_routes.NotionOAuthStatusResponse

    import_config_put = _route(
        notion_routes.router,
        "PUT",
        "/notion/import-config",
    )
    assert import_config_put.body_field is not None
    assert (
        get_type_hints(import_config_put.endpoint)["payload"]
        is notion_routes.NotionImportConfigRequest
    )


def test_import_config_request_names_current_fields_and_allows_future_json() -> None:
    schema = notion_routes.NotionImportConfigRequest.model_json_schema()
    assert set(schema["properties"]) == {
        "cloneVaultId",
        "databases",
        "loosePages",
        "loosePageTypes",
        "looseSelected",
        "newVaultName",
        "schemaOverrides",
        "selected",
    }
    assert schema["additionalProperties"] == {"$ref": "#/$defs/JsonValue"}

    payload = {
        "databases": [{"id": "db-1", "title": "Research"}],
        "selected": ["db-1"],
        "schemaOverrides": {"db-1": {"Status": "select"}},
        "loosePages": True,
        "loosePageTypes": {"page-1": "wiki"},
        "looseSelected": ["page-1"],
        "cloneVaultId": "vault-1",
        "newVaultName": "Imported",
        "futureField": {"nested": [1, 2.5, True, None]},
    }
    model = notion_routes.NotionImportConfigRequest.model_validate(payload)
    assert model.model_dump(exclude_unset=True) == payload


def test_import_config_request_preserves_malformed_legacy_values_and_omission() -> None:
    payload = {
        "databases": "legacy-not-a-list",
        "selected": {"legacy": "mapping"},
        "loosePages": None,
        "cloneVaultId": 17,
        "futureScalar": False,
    }
    model = notion_routes.NotionImportConfigRequest.model_validate(payload)

    assert model.model_dump(exclude_unset=True) == payload
    assert "newVaultName" not in model.model_dump(exclude_unset=True)


@pytest.mark.parametrize("payload", [None, [], "legacy", 17, True])
def test_import_config_request_keeps_object_root_validation(payload: object) -> None:
    with pytest.raises(ValidationError):
        notion_routes.NotionImportConfigRequest.model_validate(payload)


def test_models_preserve_dynamic_config_discovery_clone_and_verification_json() -> None:
    config = {
        "databases": [{"id": "db-1", "title": "Research"}],
        "selected": ["db-1"],
        "schemaOverrides": {"db-1": {"Status": "select"}},
        "extension": {"future": True},
    }
    config_payload = {"config": config}
    assert (
        notion_routes.NotionImportConfigResponse.model_validate(config_payload).model_dump(
            exclude_unset=True
        )
        == config_payload
    )

    linked_payload = {
        "linked": [
            {
                "title": "Linked tasks",
                "page_title": "Dashboard",
                "kind": "linked",
                "extension": {"source": "future"},
            }
        ],
        "scanned": 4,
        "capped": False,
    }
    assert (
        notion_routes.NotionLinkedDatabasesResponse.model_validate(linked_payload).model_dump(
            exclude_unset=True
        )
        == linked_payload
    )

    schema_payload = {
        "name": "Research",
        "schema": {"Title": "title", "field_config": {"Title": {}}},
    }
    schema_model = notion_routes.NotionDatabaseSchemaResponse.model_validate(schema_payload)
    assert schema_model.schema_ == schema_payload["schema"]
    assert schema_model.model_dump(by_alias=True, exclude_unset=True) == schema_payload
    assert "schema" in notion_routes.NotionDatabaseSchemaResponse.model_json_schema()["properties"]
    assert (
        "schema_"
        not in notion_routes.NotionDatabaseSchemaResponse.model_json_schema()["properties"]
    )

    progress_payload = {
        "running": True,
        "phase": "pages",
        "done": 3,
        "total": 8,
        "pages": 3,
        "tables": 1,
        "views": 2,
        "attachments": 4,
        "collected": 8,
        "tables_total": 2,
        "pages_total": 8,
        "vault_id": "vault-1",
        "scan_done": 1,
        "scan_total": 2,
        "extension": {"heartbeat": True},
    }
    assert (
        notion_routes.NotionCloneProgressResponse.model_validate(progress_payload).model_dump(
            exclude_unset=True
        )
        == progress_payload
    )

    clone_payload = {
        "status": "success",
        "tables": 2,
        "pages": 8,
        "views": 3,
        "attachments": 5,
        "errors": [{"page": "page-8", "stage": "asset", "error": "missing"}],
        "warnings": ["Orphan rows were preserved"],
        "truncated": False,
        "collected": 8,
        "tables_total": 2,
        "pages_total": 8,
        "orphan_rows_pruned": 0,
        "extension": {"duration_ms": 12},
    }
    assert (
        notion_routes.NotionCloneResponse.model_validate(clone_payload).model_dump(
            exclude_unset=True
        )
        == clone_payload
    )

    verification_payload = {
        "status": "success",
        "summary": {
            "healthy": False,
            "tables_ok": 1,
            "tables_total": 2,
            "pages": 8,
            "empty_bodies": 1,
            "views": 3,
            "orphan_relations": 1,
            "missing_assets": 1,
        },
        "tables": [
            {
                "table_id": "table-1",
                "notion": 5,
                "clone": 4,
                "ok": False,
                "missing": 1,
            }
        ],
        "empty_bodies": ["page-1"],
        "orphan_relations": [{"page": "page-2", "rel": "page-missing"}],
        "missing_assets": [{"page": "page-3", "asset": "Assets/missing.png"}],
        "extension": {"checked_at": "now"},
    }
    assert (
        notion_routes.NotionVerificationResponse.model_validate(verification_payload).model_dump(
            exclude_unset=True
        )
        == verification_payload
    )


def test_import_config_round_trip_keeps_free_form_server_state(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    config_path = tmp_path / "system" / "notion_import_config.json"
    monkeypatch.setattr(notion_routes, "_import_cfg_path", lambda: config_path)
    payload = {
        "databases": [{"id": "db-1", "title": "Research"}],
        "selected": ["db-1"],
        "loosePageTypes": {"page-1": "wiki"},
        "futureField": {"nested": [1, True, None]},
    }

    missing = asyncio.run(notion_routes.get_import_config())
    request = notion_routes.NotionImportConfigRequest.model_validate(payload)
    saved = asyncio.run(notion_routes.put_import_config(request))
    loaded = asyncio.run(notion_routes.get_import_config())

    assert missing == {"config": None}
    assert saved == {"status": "success"}
    assert loaded == {"config": payload}
    assert json.loads(config_path.read_text(encoding="utf-8")) == payload

    config_path.write_text("[]", encoding="utf-8")
    assert asyncio.run(notion_routes.get_import_config()) == {"config": None}


def test_connection_and_discovery_handlers_keep_historical_mapping(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class FakeClient:
        def search_databases(self) -> list[dict[str, Any]]:
            return [
                {
                    "id": "db-1",
                    "title": [{"plain_text": "Research"}],
                }
            ]

        def get_database(self, db_id: str) -> dict[str, Any]:
            return {"id": db_id, "title": [], "properties": {}}

    fake_client = FakeClient()
    monkeypatch.setattr(notion_routes, "_get_token", lambda: "secret")
    monkeypatch.setattr(notion_routes, "NotionClient", lambda _token: fake_client)
    monkeypatch.setattr(
        notion_importer,
        "map_database_schema",
        lambda database: {"name": f"Schema {database['id']}", "properties": []},
    )
    monkeypatch.setattr(
        notion_schema_config,
        "notion_props_to_modal_schema",
        lambda _properties: {"Title": "title", "field_config": {"Title": {}}},
    )
    monkeypatch.setattr(
        notion_routes,
        "_find_linked_databases",
        lambda _token: {
            "linked": [{"title": "Tasks", "page_title": "Home", "kind": "linked"}],
            "scanned": 2,
            "capped": False,
        },
    )
    monkeypatch.setattr(
        notion_routes,
        "_collect_loose_pages",
        lambda _token: [{"id": "page-1", "title": "Loose page"}],
    )

    databases = asyncio.run(notion_routes.list_databases())
    schema = asyncio.run(notion_routes.database_schema("db-1"))
    linked = asyncio.run(notion_routes.list_linked_databases())
    loose = asyncio.run(notion_routes.list_loose_pages())

    assert databases == {"databases": [{"id": "db-1", "title": "Research"}]}
    assert schema == {
        "name": "Schema db-1",
        "schema": {"Title": "title", "field_config": {"Title": {}}},
    }
    assert linked == {
        "linked": [{"title": "Tasks", "page_title": "Home", "kind": "linked"}],
        "scanned": 2,
        "capped": False,
    }
    assert loose == {"pages": [{"id": "page-1", "title": "Loose page"}]}


def test_clone_poll_abort_verify_and_oauth_status_keep_runtime_semantics(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    original_progress = dict(notion_routes._CLONE_PROGRESS)
    original_cancel = dict(notion_routes._CLONE_CANCEL)
    clone_report = {
        "tables": 2,
        "pages": 8,
        "views": 3,
        "attachments": 5,
        "collected": 8,
        "tables_total": 2,
        "pages_total": 8,
        "errors": [],
        "warnings": [],
        "truncated": False,
        "orphan_rows_pruned": 0,
    }
    verify_report = {
        "summary": {
            "healthy": True,
            "tables_ok": 2,
            "tables_total": 2,
            "pages": 8,
            "empty_bodies": 0,
            "views": 3,
            "orphan_relations": 0,
            "missing_assets": 0,
        },
        "tables": [
            {
                "table_id": "table-1",
                "notion": 4,
                "clone": 4,
                "ok": True,
                "missing": 0,
            }
        ],
        "empty_bodies": [],
        "orphan_relations": [],
        "missing_assets": [],
    }

    monkeypatch.setattr(notion_routes, "_destination_vault_exists", lambda _id: True)
    monkeypatch.setattr(notion_mcp, "is_connected", lambda: True)
    monkeypatch.setattr(notion_mcp, "healthcheck", lambda: (True, "ok"))
    monkeypatch.setattr(notion_routes, "_run_clone_sync", lambda *_args: clone_report)
    monkeypatch.setattr(notion_routes, "_clear_clone_heartbeat", lambda: None)
    monkeypatch.setattr(notion_routes, "_get_token", lambda: "secret")
    monkeypatch.setattr(notion_routes, "_run_verify_sync", lambda *_args: verify_report)
    monkeypatch.setattr(
        notion_oauth_routes,
        "_stored_object",
        lambda key: {"token": "oauth"} if key == "notion_mcp" else {},
    )

    try:
        cloned = asyncio.run(
            notion_routes.run_clone(
                notion_routes.ClonePayload(database_ids=["db-1", "db-2"]),
                x_vault_id="vault-1",
            )
        )
        progress = asyncio.run(notion_routes.clone_progress())
        idle_abort = asyncio.run(notion_routes.clone_abort())
        notion_routes._CLONE_PROGRESS["running"] = True
        active_abort = asyncio.run(notion_routes.clone_abort())
        verified = asyncio.run(
            notion_routes.verify_clone_route(
                notion_routes.VerifyPayload(database_ids=["db-1", "db-2"])
            )
        )
        oauth = asyncio.run(notion_oauth_routes.status())
    finally:
        notion_routes._CLONE_PROGRESS.clear()
        notion_routes._CLONE_PROGRESS.update(original_progress)
        notion_routes._CLONE_CANCEL.clear()
        notion_routes._CLONE_CANCEL.update(original_cancel)

    assert cloned == {"status": "success", **clone_report}
    assert progress["running"] is False
    assert progress["vault_id"] == "vault-1"
    assert idle_abort == {"status": "idle", "detail": "No clone is running"}
    assert active_abort == {"status": "aborting"}
    assert verified == {"status": "success", **verify_report}
    assert oauth == {"connected": True}
