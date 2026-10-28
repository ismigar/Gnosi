"""Retired sync settings remain data, without restoring routes or side effects."""

from __future__ import annotations

import asyncio
import copy
import json
from contextlib import nullcontext
from pathlib import Path

import httpx
from fastapi import FastAPI

from backend.api import vault_routes
from backend.domains.sites.transport_settings import website_transport_settings
from backend.domains.vault.pages.metadata_mutations import apply_metadata_patch
from backend.domains.vault.tables.contracts import TableUpsertRequest
from backend.domains.vault.tables.lifecycle import CreateTableDependencies, create_table
from backend.services import action_rules, option_catalogs


RETIRED_OPERATIONS = (
    ("GET", "/api/vault/drupal/content-types"),
    ("GET", "/api/vault/drupal/content-types/article/fields"),
    ("POST", "/api/vault/skills/sync-drupal-row"),
    ("POST", "/api/vault/skills/sync-drupal-rows"),
    ("POST", "/api/vault/skills/match-drupal-rows"),
)


def test_retired_routes_and_schemas_are_absent_even_with_old_configuration(monkeypatch) -> None:
    monkeypatch.setenv("DRUPAL_URL", "https://retired.invalid")
    monkeypatch.setenv("DRUPAL_ROOT_PASSWORD", "synthetic-retired-password")
    app = FastAPI()
    app.include_router(vault_routes.router, prefix="/api/vault")
    schema = app.openapi()
    assert not any("drupal" in path.lower() for path in schema["paths"])
    assert not any("drupal" in name.lower() for name in schema["components"]["schemas"])
    assert not any("drupal" in name for name in TableUpsertRequest.model_fields)
    assert not hasattr(vault_routes, "_do_sync_drupal_row")
    assert not hasattr(vault_routes, "match_drupal_rows")

    async def exercise() -> None:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            for method, path in RETIRED_OPERATIONS:
                response = await client.request(method, path)
                assert response.status_code == 404, (method, path, response.text)

    asyncio.run(exercise())


def test_table_save_reopen_keeps_historical_values_without_seeding_retired_features(tmp_path: Path) -> None:
    table = {
        "id": "historic-table", "name": "Articles", "folder": "Articles", "schema_revision": 2,
        "drupal_sync_enabled": True, "drupal_bundle": "article",
        "drupal_field_mapping": {"title": "title", "__body__": "body"},
        "extension": {"provider": "unrelated", "flags": [1, False, None]},
        "properties": [
            {"id": "title", "name": "Title", "type": "title"},
            {"id": "nid", "name": "Drupal NID", "type": "text", "config": {"system": True}},
            {"id": "status", "name": "Status", "type": "status", "config": {
                "role": "status", "option_groups": ["Inicial", "En curs", "Final"],
                "options": [{"name": "Publicat a Drupal", "color": "blue", "group": "Final"}],
            }},
        ],
    }
    unrelated = {"id": "other-table", "name": "Other", "extension": {"keep": ["all", "values"]}}
    path = tmp_path / "registry.json"
    initial = {"tables": [table, unrelated], "databases": [], "views": [], "extension": {"root": True}}
    path.write_text(json.dumps(initial), encoding="utf-8")
    dependencies = CreateTableDependencies(
        load_registry=lambda: json.loads(path.read_text(encoding="utf-8")),
        save_registry=lambda registry: path.write_text(json.dumps(registry), encoding="utf-8"),
        registry_mutation=nullcontext, configured_language=lambda: "en",
        ensure_system_dates=lambda *_: None, normalize_folder=lambda folder: folder or "",
        sanitize_folder=lambda value, **_: value, is_asset_property=lambda _: False,
        delete_asset_property=lambda *_: None, ensure_asset_directories=lambda *_: None,
        ensure_table_folder=lambda *_: None, ensure_table_seeds=option_catalogs.ensure_table_seeds,
        ensure_global_status_catalog=option_catalogs.ensure_global_status_catalog,
        ensure_action_rules=action_rules.ensure_action_rules,
    )
    payload = TableUpsertRequest.model_validate(copy.deepcopy(table)).registry_data()
    saved = asyncio.run(create_table(payload, dependencies))
    reopened = json.loads(path.read_text(encoding="utf-8"))
    assert reopened["tables"][0] == saved
    assert reopened["tables"][1] == unrelated
    assert reopened["extension"] == initial["extension"]
    for key in ("drupal_sync_enabled", "drupal_bundle", "drupal_field_mapping", "extension", "properties"):
        assert saved[key] == table[key]
    assert "sync_drupal" not in saved.get("action_rules", {})
    assert "sync_drupal" not in action_rules.DEFAULT_ACTION_RULES
    fresh = copy.deepcopy(table)
    fresh["properties"][2]["config"]["options"] = []
    option_catalogs.ensure_status_seed(fresh)
    assert fresh["properties"][2]["config"]["options"] == []


def test_page_edits_preserve_legacy_frontmatter_and_unrelated_values() -> None:
    metadata = {
        "title": "Original", "drupal_uuid": "old-id", "drupal_nid": 42,
        "drupal_url": "https://retired.invalid/node/42", "drupal_path": "/ca/old-path",
        "custom": {"nested": [False, None, 3]}, "tags": ["keep"],
    }
    result = apply_metadata_patch(metadata, {"title": "Edited"}, [])
    assert result == {**metadata, "title": "Edited"}
    assert metadata["title"] == "Original"


def test_shared_ssh_transport_normalizes_legacy_driver_settings_without_mutation() -> None:
    legacy = {
        "SSH_HOST": "staging.invalid", "SSH_USER": "operator", "SSH_PORT": "22",
        "SSH_PASSWORD": "synthetic-password", "SSH_SUWEB_PASSWORD": "synthetic-suweb",
        "DRUPAL_PATH": "/owned/site",
    }
    settings = website_transport_settings(legacy)
    assert settings == {**{key: value for key, value in legacy.items() if key != "DRUPAL_PATH"}, "WORKING_DIRECTORY": "/owned/site"}
    assert legacy["DRUPAL_PATH"] == "/owned/site"
    assert website_transport_settings({**legacy, "WORKING_DIRECTORY": "/owned/override"})["WORKING_DIRECTORY"] == "/owned/override"
